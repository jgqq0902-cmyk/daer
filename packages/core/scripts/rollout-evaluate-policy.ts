import { getActivePolicyArtifact } from '../src/ai/policy-artifact';
import {
  attachOracleToSamples,
  evaluateLearnedVsHeuristic,
  evaluatePolicyGate,
  type OfflineSample,
  type OfflineTrainingOptions,
} from '../src/ai/rollout-offline';
import { DEFAULT_BENCHMARK_CORPUS_VERSION, type BenchmarkCorpusFile } from '../src/ai/benchmark-fixtures';
import type { PolicyArtifact, PolicyEvaluationSample } from '../src/shared/types/ai';
import { createHeartbeatLogger, parseArgs, readJsonFile, writeJsonFile } from './_common';

interface EvaluateScriptConfig {
  datasetFile: string;
  artifactFile: string;
  outputFile: string;
  rolloutCountPerAction: number;
  rolloutSeed: number;
  maxRolloutSteps: number;
  winRateWeight: number;
  expectedScoreWeight: number;
  failOnRegression: boolean;
  minSamples: number;
  minWinRateDelta: number;
  minExpectedScoreDelta: number;
  minLearnedOracleMatchRate?: number;
  minOracleMatchRateDelta?: number;
  minCategoryWinRateDelta?: Record<string, number>;
  minCategoryOracleMatchRateDelta?: Record<string, number>;
  minActionFamilyWinRateDelta?: Record<string, number>;
  minActionFamilyOracleMatchRateDelta?: Record<string, number>;
  requiredBenchmarkVersion?: string;
}

function getNumberArg(value: string | boolean | number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function getStringArg(value: string | boolean | number | undefined, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}

function parseThresholdMap(
  value: string | boolean | number | undefined,
  flagName: string,
): Record<string, number> | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const output: Record<string, number> = {};
  const chunks = value.split(',').map((item) => item.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const [nameRaw, thresholdRaw] = chunk.split(':');
    const name = (nameRaw || '').trim();
    const threshold = Number((thresholdRaw || '').trim());
    if (!name || !Number.isFinite(threshold)) {
      throw new Error(
        `invalid ${flagName} format: "${chunk}", expected "<name>:<number>"`,
      );
    }
    output[name] = threshold;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildConfig(): EvaluateScriptConfig {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = getStringArg(args.outputDir, 'artifacts/learned-policy');
  const benchmarkCorpusFile = `benchmarks/${DEFAULT_BENCHMARK_CORPUS_VERSION}/corpus.json`;
  return {
    datasetFile: getStringArg(args.datasetFile, benchmarkCorpusFile),
    artifactFile: getStringArg(args.artifactFile, `${outputDir}/policy-artifact.json`),
    outputFile: getStringArg(args.outputFile, `${outputDir}/policy-evaluation.gate.json`),
    rolloutCountPerAction: getNumberArg(args.rolloutCountPerAction, 36),
    rolloutSeed: getNumberArg(args.seed, 20260328),
    maxRolloutSteps: getNumberArg(args.maxRolloutSteps, 320),
    winRateWeight: getNumberArg(args.winRateWeight, 100),
    expectedScoreWeight: getNumberArg(args.expectedScoreWeight, 1),
    failOnRegression: args.failOnRegression === true,
    minSamples: getNumberArg(args.minSamples, 300),
    minWinRateDelta: getNumberArg(args.minWinRateDelta, 0.005),
    minExpectedScoreDelta: getNumberArg(args.minExpectedScoreDelta, -0.05),
    minLearnedOracleMatchRate: typeof args.minLearnedOracleMatchRate === 'number'
      ? args.minLearnedOracleMatchRate
      : 0.18,
    minOracleMatchRateDelta: typeof args.minOracleMatchRateDelta === 'number'
      ? args.minOracleMatchRateDelta
      : undefined,
    minCategoryWinRateDelta: parseThresholdMap(
      args.minCategoryWinRateDelta,
      'minCategoryWinRateDelta',
    ) ?? {
      opening: 0,
      midgame: 0,
    },
    minCategoryOracleMatchRateDelta: parseThresholdMap(
      args.minCategoryOracleMatchRateDelta,
      'minCategoryOracleMatchRateDelta',
    ),
    minActionFamilyWinRateDelta: parseThresholdMap(
      args.minActionFamilyWinRateDelta,
      'minActionFamilyWinRateDelta',
    ),
    minActionFamilyOracleMatchRateDelta: parseThresholdMap(
      args.minActionFamilyOracleMatchRateDelta,
      'minActionFamilyOracleMatchRateDelta',
    ) ?? {
      discard: -0.02,
      response: -0.03,
    },
    requiredBenchmarkVersion: getStringArg(args.requiredBenchmarkVersion, DEFAULT_BENCHMARK_CORPUS_VERSION),
  };
}

function hasOracle(samples: PolicyEvaluationSample[]): boolean {
  return samples.some((sample) => !!sample.oracle && sample.oracle.candidates.length > 0);
}

function canAttachOracle(samples: PolicyEvaluationSample[]): samples is OfflineSample[] {
  return samples.every((sample) => {
    const offlineSample = sample as OfflineSample;
    return typeof offlineSample.state === 'object'
      && Array.isArray(offlineSample.remainingDeck);
  });
}

function extractSamples(
  input: PolicyEvaluationSample[] | BenchmarkCorpusFile,
): PolicyEvaluationSample[] {
  return Array.isArray(input) ? input : input.samples;
}

function extractBenchmarkVersion(
  input: PolicyEvaluationSample[] | BenchmarkCorpusFile,
): string | undefined {
  return Array.isArray(input) ? undefined : input.version;
}

async function maybeAttachOracle(
  samples: PolicyEvaluationSample[],
  config: EvaluateScriptConfig,
): Promise<PolicyEvaluationSample[]> {
  if (hasOracle(samples)) {
    return samples;
  }

  if (!canAttachOracle(samples)) {
    throw new Error('dataset has no oracle labels and cannot be recomputed without serialized game state and remaining deck snapshot');
  }

  console.warn('[offline-eval] dataset has no oracle labels, recomputing...');
  const rolloutOptions: OfflineTrainingOptions = {
    selfPlayGames: 0,
    rolloutCountPerAction: config.rolloutCountPerAction,
    rolloutSeed: config.rolloutSeed,
    maxRolloutSteps: config.maxRolloutSteps,
    winRateWeight: config.winRateWeight,
    expectedScoreWeight: config.expectedScoreWeight,
  };
  return attachOracleToSamples(samples, rolloutOptions);
}

async function main(): Promise<void> {
  const config = buildConfig();
  const heartbeat = createHeartbeatLogger({ label: 'offline-eval' });
  try {
    heartbeat.update('loading artifact and dataset');
    const artifact = readJsonFile<PolicyArtifact>(config.artifactFile);
    const fallbackArtifact = getActivePolicyArtifact();
    const rawInput = readJsonFile<PolicyEvaluationSample[] | BenchmarkCorpusFile>(config.datasetFile);
    heartbeat.update('attaching oracle when needed');
    const samples = await maybeAttachOracle(extractSamples(rawInput), config);
    const benchmarkVersion = extractBenchmarkVersion(rawInput);

    heartbeat.update('evaluating learned policy vs heuristic');
    const report = evaluateLearnedVsHeuristic(samples, artifact || fallbackArtifact, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
    });
    const reportWithBenchmark = {
      ...report,
      benchmarkVersion,
    };
    const finalReport = {
      ...reportWithBenchmark,
      gate: evaluatePolicyGate(reportWithBenchmark, {
        minSamples: config.minSamples,
        minWinRateDelta: config.minWinRateDelta,
        minExpectedScoreDelta: config.minExpectedScoreDelta,
        minLearnedOracleMatchRate: config.minLearnedOracleMatchRate,
        minOracleMatchRateDelta: config.minOracleMatchRateDelta,
        minCategoryWinRateDelta: config.minCategoryWinRateDelta,
        minCategoryOracleMatchRateDelta: config.minCategoryOracleMatchRateDelta,
        minActionFamilyWinRateDelta: config.minActionFamilyWinRateDelta,
        minActionFamilyOracleMatchRateDelta: config.minActionFamilyOracleMatchRateDelta,
        requiredBenchmarkVersion: config.requiredBenchmarkVersion,
      }),
    };

    heartbeat.update('writing evaluation output');
    writeJsonFile(config.outputFile, finalReport);
    console.log('[offline-eval] done');
    console.log(`[offline-eval] policyVersion: ${finalReport.policyVersion}`);
    console.log(`[offline-eval] benchmarkVersion: ${finalReport.benchmarkVersion || 'adhoc-dataset'}`);
    console.log(`[offline-eval] totalSamples: ${finalReport.totalSamples}`);
    console.log(`[offline-eval] winRateDelta: ${finalReport.winRateDelta}`);
    console.log(`[offline-eval] expectedScoreDelta: ${finalReport.expectedScoreDelta}`);
    console.log(`[offline-eval] learnedOracleMatchRate: ${finalReport.learnedOracleMatchRate ?? 0}`);
    console.log(`[offline-eval] heuristicOracleMatchRate: ${finalReport.heuristicOracleMatchRate ?? 0}`);
    finalReport.benchmarkSummary.forEach((entry) => {
      console.log(
        `[offline-eval] category=${entry.name} samples=${entry.sampleCount} winRateDelta=${entry.winRateDelta} expectedScoreDelta=${entry.expectedScoreDelta} learnedMatch=${(entry.learnedOracleMatchRate * 100).toFixed(1)}% heuristicMatch=${(entry.heuristicOracleMatchRate * 100).toFixed(1)}%`,
      );
    });
    (finalReport.actionFamilySummary || []).forEach((entry) => {
      console.log(
        `[offline-eval] family=${entry.name} samples=${entry.sampleCount} winRateDelta=${entry.winRateDelta} expectedScoreDelta=${entry.expectedScoreDelta} learnedMatch=${(entry.learnedOracleMatchRate * 100).toFixed(1)}% heuristicMatch=${(entry.heuristicOracleMatchRate * 100).toFixed(1)}%`,
      );
    });
    console.log(`[offline-eval] gate: ${finalReport.gate.passed ? 'PASS' : 'FAIL'}`);
    if (!finalReport.gate.passed) {
      finalReport.gate.reasons.forEach((reason) => console.log(`[offline-eval] gate reason: ${reason}`));
    }
    console.log(`[offline-eval] output: ${config.outputFile}`);

    if (config.failOnRegression && !finalReport.gate.passed) {
      throw new Error(`offline eval gate failed: ${finalReport.gate.reasons.join('; ')}`);
    }
  } finally {
    heartbeat.stop();
  }
}

main().catch((error) => {
  console.error('[offline-eval] failed:', error);
  process.exitCode = 1;
});
