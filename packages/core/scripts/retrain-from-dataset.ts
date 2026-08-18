/**
 * 从已有 selfplay-dataset.json 直接重训 policy artifact，跳过 Phase 1 (sampling) + Phase 2 (oracle)。
 * 用途：调整训练超参（如 midgame 权重）后快速迭代，无需重跑耗时的 rollout。
 *
 * 用法：
 *   pnpm --dir packages/core exec tsx scripts/retrain-from-dataset.ts \
 *     --datasetFile=artifacts/learned-policy/selfplay-dataset.json \
 *     --outputDir=artifacts/learned-policy-retrain
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  trainPolicyArtifactFromSamples,
  evaluateLearnedVsHeuristic,
  toPolicyEvaluationSamples,
  evaluatePolicyGate,
  type OfflineSample,
} from '../src/ai/rollout-offline';
import { buildBenchmarkFixturesFromSamples } from '../src/ai/benchmark-fixtures';
import { getActivePolicyArtifact } from '../src/ai/policy-artifact';
import { inferPolicyStage } from '../src/ai/policy-feature-builder';
import { createHeartbeatLogger, readJsonFile, writeJsonFile, parseArgs } from './_common';
import type { PolicyActionFamily, PolicyStage } from '../src/shared/types/ai';

function getSampleFamily(sample: OfflineSample): PolicyActionFamily {
  return sample.phase === 'response_collecting' ? 'response' : 'discard';
}

function getSampleStage(sample: OfflineSample): PolicyStage {
  return inferPolicyStage(sample.turnCount || 0, sample.remainingDeckCards || 0);
}

function parseList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const allowedSet = new Set<string>(allowed);
  const parsed = value.split(',').map((item) => item.trim()).filter(Boolean);
  for (const item of parsed) {
    if (!allowedSet.has(item)) {
      throw new Error(`invalid filter value: ${item}`);
    }
  }
  return parsed as T[];
}

function buildConfig() {
  const args = parseArgs(process.argv.slice(2));

  const getStr = (v: unknown, def: string) =>
    typeof v === 'string' && v.length > 0 ? v : def;
  const getNum = (v: unknown, def: number) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : def; }
    return def;
  };

  const outputDir = resolve(getStr(args.outputDir, 'artifacts/learned-policy-retrain'));
  // Support comma-separated list of dataset files: --datasetFiles=a.json,b.json
  const datasetFiles: string[] = [];
  const rawFiles = getStr(args.datasetFiles, '');
  if (rawFiles.length > 0) {
    for (const f of rawFiles.split(',')) {
      datasetFiles.push(resolve(f.trim()));
    }
  }
  // Fallback to single --datasetFile
  if (datasetFiles.length === 0) {
    datasetFiles.push(resolve(getStr(args.datasetFile, 'artifacts/learned-policy/selfplay-dataset.json')));
  }

  return {
    datasetFiles,
    outputDir,
    artifactFile: resolve(outputDir, 'policy-artifact.json'),
    datasetOutFile: resolve(outputDir, 'selfplay-dataset.json'),
    reportFile: resolve(outputDir, 'policy-evaluation.json'),
    fixturesFile: resolve(outputDir, 'benchmark-fixtures.json'),
    families: parseList(args.family ?? args.families, ['discard', 'response'] as const),
    stages: parseList(args.stage ?? args.stages, ['opening', 'midgame', 'endgame'] as const),
    maxInputSamples: getNum(args.maxInputSamples, 0),
    winRateWeight: getNum(args.winRateWeight, 100),
    expectedScoreWeight: getNum(args.expectedScoreWeight, 1),
    maxResponseToDiscardRatio: typeof args.maxResponseToDiscardRatio === 'number'
      ? args.maxResponseToDiscardRatio
      : undefined,
    discardSampleWeight: typeof args.discardSampleWeight === 'number'
      ? args.discardSampleWeight
      : undefined,
    discardStageMinShare: typeof args.discardStageMinShare === 'number'
      ? args.discardStageMinShare
      : undefined,
    discardOpeningWeight: typeof args.discardOpeningWeight === 'number'
      ? args.discardOpeningWeight
      : undefined,
    discardMidgameWeight: typeof args.discardMidgameWeight === 'number'
      ? args.discardMidgameWeight
      : undefined,
    openingHeuristicDisagreementWeight: typeof args.openingHeuristicDisagreementWeight === 'number'
      ? args.openingHeuristicDisagreementWeight
      : undefined,
    midgameHeuristicDisagreementWeight: typeof args.midgameHeuristicDisagreementWeight === 'number'
      ? args.midgameHeuristicDisagreementWeight
      : undefined,
    hardExampleWeight: typeof args.hardExampleWeight === 'number'
      ? args.hardExampleWeight
      : undefined,
    // gate thresholds
    minSamples: getNum(args.minSamples, 300),
    minWinRateDelta: getNum(args.minWinRateDelta, 0.005),
    minExpectedScoreDelta: getNum(args.minExpectedScoreDelta, -0.05),
    minLearnedOracleMatchRate: getNum(args.minLearnedOracleMatchRate, 0.18),
  };
}

async function main() {
  const config = buildConfig();
  const heartbeat = createHeartbeatLogger({ label: 'retrain' });

  try {

    heartbeat.update('validating input datasets');
    for (const f of config.datasetFiles) {
      if (!existsSync(f)) {
        throw new Error(`Dataset file not found: ${f}`);
      }
    }
    mkdirSync(config.outputDir, { recursive: true });

    heartbeat.update('loading dataset files');
    const loadedSamples: OfflineSample[] = [];
    for (const f of config.datasetFiles) {
      console.log(`[retrain] loading dataset from ${f}...`);
      const batch = readJsonFile<OfflineSample[]>(f);
      console.log(`[retrain]   loaded ${batch.length} samples`);
      loadedSamples.push(...batch);
    }
    console.log(`[retrain] total merged samples: ${loadedSamples.length}`);

    let samples = loadedSamples.filter((sample) => {
      const familyMatches = !config.families || config.families.includes(getSampleFamily(sample));
      const stageMatches = !config.stages || config.stages.includes(getSampleStage(sample));
      return familyMatches && stageMatches;
    });
    if (config.maxInputSamples > 0 && samples.length > config.maxInputSamples) {
      samples = samples.slice(0, config.maxInputSamples);
    }
    console.log(`[retrain] selected samples after filters: ${samples.length}`);
    if (samples.length === 0) {
      throw new Error('No samples selected after retrain filters');
    }

  // Patch: dataset中的样本是 PolicyEvaluationSample 格式（无 state 字段），
  // 但 trainPolicyArtifactFromSamples 内部调用 toPolicyEvaluationSample 需要 sample.state.remainingDeckCards。
  // 用顶级 remainingDeckCards 补一个最小 state 桩。
  for (const s of samples) {
    const raw = s as unknown as Record<string, unknown>;
    if (!raw.state) {
      raw.state = { remainingDeckCards: s.remainingDeckCards ?? 0 };
    }
  }

  // Stage distribution
  const stages: Record<string, number> = {};
  for (const s of samples) {
    const tc = s.turnCount || 0;
    const rd = s.remainingDeckCards || 0;
    let stage: string;
    if (tc <= 4) stage = 'opening';
    else if (rd <= 10 || tc >= 12) stage = 'endgame';
    else stage = 'midgame';
    stages[stage] = (stages[stage] || 0) + 1;
  }
  console.log(`[retrain] stage distribution: ${JSON.stringify(stages)}`);

    heartbeat.update('fitting learned policy artifact');
    console.log('[retrain] fitting learned policy artifact...');
    const baselineArtifact = getActivePolicyArtifact();
    const artifact = trainPolicyArtifactFromSamples(samples, baselineArtifact, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
      maxResponseToDiscardRatio: config.maxResponseToDiscardRatio,
      discardSampleWeight: config.discardSampleWeight,
      discardStageMinShare: config.discardStageMinShare,
      discardOpeningWeight: config.discardOpeningWeight,
      discardMidgameWeight: config.discardMidgameWeight,
      openingHeuristicDisagreementWeight: config.openingHeuristicDisagreementWeight,
      midgameHeuristicDisagreementWeight: config.midgameHeuristicDisagreementWeight,
      hardExampleWeight: config.hardExampleWeight,
    });
    artifact.trainingMeta = {
      ...artifact.trainingMeta,
      sampledDecisionCount: samples.length,
    };

    heartbeat.update('evaluating learned policy gate');
    const report = evaluateLearnedVsHeuristic(samples, artifact, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
    });
    const gate = evaluatePolicyGate(report, {
      minSamples: config.minSamples,
      minWinRateDelta: config.minWinRateDelta,
      minExpectedScoreDelta: config.minExpectedScoreDelta,
      minLearnedOracleMatchRate: config.minLearnedOracleMatchRate,
      minCategoryWinRateDelta: { opening: 0, midgame: -0.05 },
      minActionFamilyOracleMatchRateDelta: { discard: -0.03, response: -0.03 },
    });

    const finalReport = { ...report, gate };

    heartbeat.update('writing outputs');
    const evaluationSamples = toPolicyEvaluationSamples(samples);
    const fixtures = buildBenchmarkFixturesFromSamples(evaluationSamples);

    writeJsonFile(config.datasetOutFile, evaluationSamples);
    writeJsonFile(config.artifactFile, artifact);
    writeJsonFile(config.reportFile, finalReport);
    writeJsonFile(config.fixturesFile, fixtures);

    heartbeat.update('completed');
    console.log('[retrain] done');
    console.log(`[retrain] artifact: ${config.artifactFile}`);
    console.log(`[retrain] gate: ${gate.passed ? 'PASS' : 'FAIL'}`);
    console.log(`[retrain] winRateDelta: ${report.winRateDelta}`);
    console.log(`[retrain] expectedScoreDelta: ${report.expectedScoreDelta}`);
    console.log(`[retrain] learnedOracleMatchRate: ${report.learnedOracleMatchRate}`);
    console.log(`[retrain] heuristicOracleMatchRate: ${report.heuristicOracleMatchRate}`);
    for (const entry of report.benchmarkSummary || []) {
      console.log(
        `[retrain] category=${entry.name} samples=${entry.sampleCount} winRateDelta=${entry.winRateDelta} learnedMatch=${(entry.learnedOracleMatchRate * 100).toFixed(1)}% heuristicMatch=${(entry.heuristicOracleMatchRate * 100).toFixed(1)}%`,
      );
    }
    if (!gate.passed) {
      for (const r of gate.reasons) {
        console.log(`[retrain] gate reason: ${r}`);
      }
    }
  } finally {
    heartbeat.stop();
  }
}

main().catch((err) => {
  console.error('[retrain] failed:', err);
  process.exitCode = 1;
});
