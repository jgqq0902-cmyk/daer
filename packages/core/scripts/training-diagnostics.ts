import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, readJsonFile } from './_common';
import { getTrainingJobPaths, readTrainingJobStatus, type TrainingJobStatus } from './training-job';
import type { PolicyEvaluationReport } from '../src/shared/types/ai';

export interface TrainingMetricDiagnostic {
  name: string;
  value: number;
  threshold?: number;
  passed: boolean;
  message: string;
}

export interface TrainingSegmentDiagnostic {
  scope: 'category' | 'actionFamily';
  name: string;
  sampleCount: number;
  winRateDelta: number;
  expectedScoreDelta: number;
  learnedOracleMatchRate: number;
  heuristicOracleMatchRate: number;
  oracleMatchRateDelta: number;
  issues: string[];
}

export interface TrainingDiagnostics {
  outputDir: string;
  status?: Pick<TrainingJobStatus, 'state' | 'phase' | 'lastMessage' | 'completedAt'>;
  reportFile?: string;
  gatePassed?: boolean;
  headline: string;
  metrics: TrainingMetricDiagnostic[];
  segments: TrainingSegmentDiagnostic[];
  gateReasons: string[];
  recommendations: string[];
}

type GateThresholds = {
  minWinRateDelta?: number;
  minExpectedScoreDelta?: number;
  minLearnedOracleMatchRate?: number;
  minCategoryWinRateDelta?: Record<string, number>;
  minCategoryOracleMatchRateDelta?: Record<string, number>;
  minActionFamilyWinRateDelta?: Record<string, number>;
  minActionFamilyOracleMatchRateDelta?: Record<string, number>;
};

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function getGate(status?: TrainingJobStatus, report?: PolicyEvaluationReport): GateThresholds & { passed?: boolean; reasons?: string[] } {
  return {
    ...((report?.gate || {}) as GateThresholds),
    ...((status?.gate || {}) as GateThresholds),
    passed: status?.gate?.passed ?? report?.gate?.passed,
    reasons: status?.gate?.reasons ?? report?.gate?.reasons ?? [],
  };
}

function metricDiagnostic(name: string, value: number, threshold: number | undefined, direction: 'min'): TrainingMetricDiagnostic {
  const passed = threshold === undefined || value >= threshold;
  const comparator = direction === 'min' ? '>=' : '';
  return {
    name,
    value: roundMetric(value),
    threshold,
    passed,
    message: threshold === undefined
      ? `${name}=${roundMetric(value)}`
      : `${name}=${roundMetric(value)} ${passed ? '满足' : '低于'} ${comparator} ${threshold}`,
  };
}

function diagnoseSegments(report: PolicyEvaluationReport | undefined, gate: GateThresholds): TrainingSegmentDiagnostic[] {
  if (!report) return [];

  const categorySegments = report.benchmarkSummary.map((entry) => {
    const issues: string[] = [];
    const winThreshold = gate.minCategoryWinRateDelta?.[entry.name];
    const matchThreshold = gate.minCategoryOracleMatchRateDelta?.[entry.name];
    const oracleMatchRateDelta = entry.learnedOracleMatchRate - entry.heuristicOracleMatchRate;
    if (winThreshold !== undefined && entry.winRateDelta < winThreshold) {
      issues.push(`winRateDelta ${roundMetric(entry.winRateDelta)} < ${winThreshold}`);
    }
    if (matchThreshold !== undefined && oracleMatchRateDelta < matchThreshold) {
      issues.push(`oracleMatchRateDelta ${roundMetric(oracleMatchRateDelta)} < ${matchThreshold}`);
    }
    return {
      scope: 'category' as const,
      name: entry.name,
      sampleCount: entry.sampleCount,
      winRateDelta: roundMetric(entry.winRateDelta),
      expectedScoreDelta: roundMetric(entry.expectedScoreDelta),
      learnedOracleMatchRate: roundMetric(entry.learnedOracleMatchRate),
      heuristicOracleMatchRate: roundMetric(entry.heuristicOracleMatchRate),
      oracleMatchRateDelta: roundMetric(oracleMatchRateDelta),
      issues,
    };
  });

  const familySegments = (report.actionFamilySummary || []).map((entry) => {
    const issues: string[] = [];
    const winThreshold = gate.minActionFamilyWinRateDelta?.[entry.name];
    const matchThreshold = gate.minActionFamilyOracleMatchRateDelta?.[entry.name];
    const oracleMatchRateDelta = entry.learnedOracleMatchRate - entry.heuristicOracleMatchRate;
    if (winThreshold !== undefined && entry.winRateDelta < winThreshold) {
      issues.push(`winRateDelta ${roundMetric(entry.winRateDelta)} < ${winThreshold}`);
    }
    if (matchThreshold !== undefined && oracleMatchRateDelta < matchThreshold) {
      issues.push(`oracleMatchRateDelta ${roundMetric(oracleMatchRateDelta)} < ${matchThreshold}`);
    }
    return {
      scope: 'actionFamily' as const,
      name: entry.name,
      sampleCount: entry.sampleCount,
      winRateDelta: roundMetric(entry.winRateDelta),
      expectedScoreDelta: roundMetric(entry.expectedScoreDelta),
      learnedOracleMatchRate: roundMetric(entry.learnedOracleMatchRate),
      heuristicOracleMatchRate: roundMetric(entry.heuristicOracleMatchRate),
      oracleMatchRateDelta: roundMetric(oracleMatchRateDelta),
      issues,
    };
  });

  return [...categorySegments, ...familySegments]
    .filter((segment) => segment.issues.length > 0)
    .sort((left, right) => {
      const leftSeverity = Math.min(left.winRateDelta, left.oracleMatchRateDelta);
      const rightSeverity = Math.min(right.winRateDelta, right.oracleMatchRateDelta);
      return leftSeverity - rightSeverity;
    });
}

function buildRecommendations(report: PolicyEvaluationReport | undefined, segments: TrainingSegmentDiagnostic[]): string[] {
  if (!report) {
    return ['尚未找到评估报告；先等待训练完成，或确认 reportFile 指向 policy-evaluation.json。'];
  }

  const recommendations: string[] = [];
  const discard = report.actionFamilySummary?.find((entry) => entry.name === 'discard');
  const response = report.actionFamilySummary?.find((entry) => entry.name === 'response');
  const totalFamilySamples = (discard?.sampleCount || 0) + (response?.sampleCount || 0);
  const responseRatio = totalFamilySamples > 0 ? (response?.sampleCount || 0) / totalFamilySamples : 0;

  if (discard && discard.learnedOracleMatchRate + 0.03 < discard.heuristicOracleMatchRate) {
    recommendations.push('优先修复出牌阶段：discard oracle 匹配率明显低于 heuristic，下一轮应提高 discard/opening 样本占比，或单独用现有数据重训 discard head。');
  }
  if (responseRatio > 0.65) {
    recommendations.push(`当前 response 样本占比约 ${(responseRatio * 100).toFixed(1)}%，容易压过出牌主任务；建议下轮降低 response 上限或补充 discard 样本。`);
  }
  if (segments.some((segment) => segment.scope === 'category' && segment.name === 'opening')) {
    recommendations.push('opening gate 回退：建议补开局出牌样本，并检查 inferPolicyStage 边界和开局特征是否让 learned 过早偏向响应/风险信号。');
  }
  if (report.expectedScoreDelta < -0.05) {
    recommendations.push('expectedScoreDelta 已低于保护线：下一轮不要只追 oracle 命中率，应同时检查期望分回归权重和胡息跨档特征。');
  }
  if (recommendations.length === 0) {
    recommendations.push('未发现明确单点回退；可以扩大 holdout 分桶或增加样本量后复验。');
  }
  return recommendations;
}

export function buildTrainingDiagnostics(outputDir: string): TrainingDiagnostics {
  const resolvedOutputDir = resolve(outputDir);
  const paths = getTrainingJobPaths(resolvedOutputDir);
  const status = existsSync(paths.statusFile) ? readTrainingJobStatus(paths.statusFile) : undefined;
  const reportFile = status?.outputs?.reportFile || resolve(resolvedOutputDir, 'policy-evaluation.json');
  const report = existsSync(reportFile) ? readJsonFile<PolicyEvaluationReport>(reportFile) : undefined;
  const gate = getGate(status, report);
  const metrics = report
    ? [
      metricDiagnostic('winRateDelta', report.winRateDelta, gate.minWinRateDelta, 'min'),
      metricDiagnostic('expectedScoreDelta', report.expectedScoreDelta, gate.minExpectedScoreDelta, 'min'),
      metricDiagnostic('learnedOracleMatchRate', report.learnedOracleMatchRate ?? 0, gate.minLearnedOracleMatchRate, 'min'),
    ]
    : [];
  const segments = diagnoseSegments(report, gate);
  const gatePassed = gate.passed;
  const headline = report
    ? gatePassed
      ? '训练完成，gate 通过。'
      : '训练完成，但 gate 未通过；不要发布该策略产物。'
    : status
      ? `任务状态：${status.state}，阶段：${status.phase}。`
      : '尚未创建训练任务。';

  return {
    outputDir: resolvedOutputDir,
    status: status
      ? {
        state: status.state,
        phase: status.phase,
        lastMessage: status.lastMessage,
        completedAt: status.completedAt,
      }
      : undefined,
    reportFile: existsSync(reportFile) ? reportFile : undefined,
    gatePassed,
    headline,
    metrics,
    segments,
    gateReasons: gate.reasons || [],
    recommendations: buildRecommendations(report, segments),
  };
}

export function formatTrainingDiagnostics(diagnostics: TrainingDiagnostics): string {
  const lines = [
    `[train-diagnostics] ${diagnostics.headline}`,
    `[train-diagnostics] outputDir=${diagnostics.outputDir}`,
  ];
  for (const metric of diagnostics.metrics) {
    lines.push(`[train-diagnostics] ${metric.passed ? 'PASS' : 'FAIL'} ${metric.message}`);
  }
  for (const reason of diagnostics.gateReasons) {
    lines.push(`[train-diagnostics] gate reason: ${reason}`);
  }
  for (const segment of diagnostics.segments) {
    lines.push(
      `[train-diagnostics] ${segment.scope}:${segment.name} samples=${segment.sampleCount} `
      + `winRateDelta=${segment.winRateDelta} oracleMatchDelta=${segment.oracleMatchRateDelta} `
      + `issues=${segment.issues.join('; ')}`,
    );
  }
  diagnostics.recommendations.forEach((item, index) => {
    lines.push(`[train-diagnostics] next ${index + 1}: ${item}`);
  });
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = typeof args.outputDir === 'string' ? args.outputDir : 'artifacts/learned-policy-winrate-v1';
  process.stdout.write(formatTrainingDiagnostics(buildTrainingDiagnostics(outputDir)));
}

const entryHref = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entryHref === import.meta.url) {
  main().catch((error) => {
    console.error('[train-diagnostics] failed:', error);
    process.exitCode = 1;
  });
}
