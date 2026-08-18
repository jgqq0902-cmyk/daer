import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeJsonFile } from '../scripts/_common';
import {
  buildTrainingDiagnostics,
  formatTrainingDiagnostics,
} from '../scripts/training-diagnostics';
import { createTrainingJobTracker } from '../scripts/training-job';
import type { PolicyEvaluationReport } from '../src/shared/types/ai';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'daer-train-diagnostics-'));
  tempDirs.push(dir);
  return dir;
}

function writeFailedReport(outputDir: string): void {
  const report: PolicyEvaluationReport = {
    policyVersion: 'test-policy',
    baselinePolicyVersion: 'baseline',
    benchmarkVersion: 'discard-holdout-v2',
    totalSamples: 300,
    winRateDelta: -0.004,
    expectedScoreDelta: -0.07,
    learnedOracleMatchRate: 0.7,
    heuristicOracleMatchRate: 0.76,
    benchmarkSummary: [
      {
        name: 'opening',
        sampleCount: 100,
        learnedTop: 'S1',
        heuristicTop: 'S2',
        oracleTop: 'S2',
        winRateDelta: -0.01,
        expectedScoreDelta: -0.03,
        learnedOracleMatchRate: 0.64,
        heuristicOracleMatchRate: 0.68,
      },
    ],
    actionFamilySummary: [
      {
        name: 'discard',
        sampleCount: 90,
        winRateDelta: -0.01,
        expectedScoreDelta: -0.08,
        learnedOracleMatchRate: 0.24,
        heuristicOracleMatchRate: 0.37,
      },
      {
        name: 'response',
        sampleCount: 210,
        winRateDelta: 0,
        expectedScoreDelta: -0.06,
        learnedOracleMatchRate: 0.84,
        heuristicOracleMatchRate: 0.87,
      },
    ],
    gate: {
      passed: false,
      minSamples: 300,
      minWinRateDelta: 0.005,
      minExpectedScoreDelta: -0.05,
      minLearnedOracleMatchRate: 0.18,
      minCategoryWinRateDelta: { opening: 0 },
      minActionFamilyOracleMatchRateDelta: { discard: -0.03, response: -0.03 },
      reasons: ['winRateDelta -0.004 < minWinRateDelta 0.005'],
    },
  };
  writeJsonFile(resolve(outputDir, 'policy-evaluation.json'), report);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('training diagnostics', () => {
  it('summarizes failed gate reasons and actionable weak segments', () => {
    const outputDir = makeTempDir();
    const tracker = createTrainingJobTracker({ outputDir, jobId: 'diag-job' });
    writeFailedReport(outputDir);
    tracker.complete({
      message: 'training completed with gate FAIL',
      outputs: { reportFile: resolve(outputDir, 'policy-evaluation.json') },
      gate: {
        passed: false,
        reasons: ['winRateDelta -0.004 < minWinRateDelta 0.005'],
      },
    });

    const diagnostics = buildTrainingDiagnostics(outputDir);
    const formatted = formatTrainingDiagnostics(diagnostics);

    expect(diagnostics.gatePassed).toBe(false);
    expect(diagnostics.headline).toContain('gate 未通过');
    expect(diagnostics.metrics.some((metric) => metric.name === 'winRateDelta' && !metric.passed)).toBe(true);
    expect(diagnostics.segments.some((segment) => segment.scope === 'actionFamily' && segment.name === 'discard')).toBe(true);
    expect(diagnostics.recommendations.join('\n')).toContain('优先修复出牌阶段');
    expect(formatted).toContain('train-diagnostics');
  });
});
