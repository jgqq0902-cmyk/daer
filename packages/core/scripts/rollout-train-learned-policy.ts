import {
  attachOracleToSamples,
  evaluateLearnedVsHeuristic,
  evaluatePolicyGate,
  sampleSelfPlayDiscardStates,
  summarizeOracleSignal,
  toPolicyEvaluationSamples,
  trainPolicyArtifactFromSamples,
  type OfflineTrainingOptions,
  type OracleCheckpoint,
  type OfflineSample,
} from '../src/ai/rollout-offline';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildReplayFeedbackPreferenceSamples,
  evaluatePolicyFeedbackReward,
} from '../src/ai/replay-feedback';
import { getActivePolicyArtifact } from '../src/ai/policy-artifact';
import { buildBenchmarkFixturesFromSamples } from '../src/ai/benchmark-fixtures';
import type { ReplayFeedbackRewardReport } from '../src/shared/types/ai';
import { createHeartbeatLogger, parseArgs, readJsonFile, writeJsonFileAtomic } from './_common';
import { createJobId, createTrainingJobTracker } from './training-job';

interface TrainScriptConfig extends OfflineTrainingOptions {
  resume: boolean;
  jobId: string;
  jobName: string;
  outputDir: string;
  configFile?: string;
  artifactFile: string;
  datasetFile: string;
  reportFile: string;
  fixturesFile: string;
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
  feedbackFile?: string;
  maxFeedbackSamples: number;
  feedbackTopK: number;
}

type RawTrainScriptConfig = Record<string, string | boolean | number | undefined>;

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

function getSamplePhaseArg(
  value: string | boolean | number | undefined,
  fallback: 'discard' | 'response' | 'all',
): 'discard' | 'response' | 'all' {
  if (value === 'discard' || value === 'response' || value === 'all') {
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

function mergeCountMaps(
  ...maps: Array<Record<string, number> | undefined>
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      if (!Number.isFinite(value)) {
        continue;
      }
      merged[key] = (merged[key] || 0) + value;
    }
  }
  return merged;
}

export function buildConfig(argv = process.argv.slice(2)): TrainScriptConfig {
  const cliArgs = parseArgs(argv) as RawTrainScriptConfig & { configFile?: string };
  const fileArgs = typeof cliArgs.configFile === 'string' && cliArgs.configFile.length > 0
    ? readJsonFile<RawTrainScriptConfig>(cliArgs.configFile)
    : {};
  const args = {
    ...fileArgs,
    ...cliArgs,
  };
  const outputDir = getStringArg(args.outputDir, 'artifacts/learned-policy');
  const jobId = getStringArg(args.jobId, createJobId());
  return {
    selfPlayGames: getNumberArg(args.selfPlayGames, 120),
    maxTurnsPerGame: getNumberArg(args.maxTurnsPerGame, 28),
    maxSamples: getNumberArg(args.maxSamples, 1200),
    samplePhase: getSamplePhaseArg(args.samplePhase, 'all'),
    rolloutCountPerAction: getNumberArg(args.rolloutCountPerAction, 16),
    rolloutSeed: getNumberArg(args.seed ?? args.rolloutSeed, 20260328),
    winRateWeight: getNumberArg(args.winRateWeight, 100),
    expectedScoreWeight: getNumberArg(args.expectedScoreWeight, 1),
    maxRolloutSteps: getNumberArg(args.maxRolloutSteps, 120),
    oracleTopK: getNumberArg(args.oracleTopK, 6),
    earlyStopDelta: getNumberArg(args.earlyStopDelta, 0.25),
    oracleChunkSize: getNumberArg(args.oracleChunkSize, 8),
    oracleParallelism: getNumberArg(args.oracleParallelism, 4),
    maxSampleResponseToDiscardRatio: typeof args.maxSampleResponseToDiscardRatio === 'number'
      ? args.maxSampleResponseToDiscardRatio
      : undefined,
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
    resume: args.resume === true,
    jobId,
    jobName: getStringArg(args.jobName, 'learned-policy-winrate'),
    outputDir,
    configFile: typeof args.configFile === 'string' ? args.configFile : undefined,
    artifactFile: getStringArg(args.artifactFile, `${outputDir}/policy-artifact.json`),
    datasetFile: getStringArg(args.datasetFile, `${outputDir}/selfplay-dataset.json`),
    reportFile: getStringArg(args.reportFile, `${outputDir}/policy-evaluation.json`),
    fixturesFile: getStringArg(args.fixturesFile, `${outputDir}/benchmark-fixtures.json`),
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
    feedbackFile: typeof args.feedbackFile === 'string' && args.feedbackFile.length > 0
      ? args.feedbackFile
      : undefined,
    maxFeedbackSamples: getNumberArg(args.maxFeedbackSamples, 120),
    feedbackTopK: Math.max(1, Math.floor(getNumberArg(args.feedbackTopK, 3))),
  };
}

async function main(): Promise<void> {
  const config = buildConfig();
  const heartbeat = createHeartbeatLogger({ label: 'offline-train' });
  mkdirSync(config.outputDir, { recursive: true });
  const samplingCheckpoint = resolve(config.outputDir, 'checkpoint-sampling.json');
  const oracleCheckpoint = resolve(config.outputDir, 'checkpoint-oracle.json');
  const oracleCompleteFile = resolve(config.outputDir, 'checkpoint-oracle-complete.json');
  const tracker = createTrainingJobTracker({
    outputDir: config.outputDir,
    jobId: config.jobId,
    name: config.jobName,
    configFile: config.configFile,
    pid: process.pid,
    initialPhase: 'starting',
  });

  try {
    let sampled: OfflineSample[] = [];
    let oracleResumeCompleted: OfflineSample[] | undefined;
    let samplesWithOracle: OfflineSample[] | undefined;

    if (config.resume && existsSync(oracleCompleteFile)) {
      heartbeat.update('resuming completed oracle snapshot');
      tracker.update({ phase: 'oracle', message: 'resuming completed oracle snapshot' });
      samplesWithOracle = readJsonFile<OfflineSample[]>(oracleCompleteFile);
      sampled = samplesWithOracle;
      tracker.update({
        phase: 'oracle',
        message: `completed oracle snapshot loaded: ${samplesWithOracle.length}`,
        progress: {
          sampledDecisionCount: samplesWithOracle.length,
          oracleCompletedSamples: samplesWithOracle.length,
          oracleTotalSamples: samplesWithOracle.length,
        },
      });
      console.log(`[offline-train] loaded completed oracle snapshot: ${samplesWithOracle.length} samples`);
    } else if (config.resume && existsSync(oracleCheckpoint)) {
      heartbeat.update('resuming oracle checkpoint');
      tracker.update({ phase: 'oracle', message: 'resuming oracle checkpoint' });
      console.log('[offline-train] resuming from oracle checkpoint...');
      const ckpt: OracleCheckpoint = JSON.parse(readFileSync(oracleCheckpoint, 'utf8'));
      sampled = [...ckpt.completedSamples, ...ckpt.pendingSamples];
      oracleResumeCompleted = ckpt.completedSamples;
      tracker.update({
        phase: 'oracle',
        message: `oracle checkpoint loaded: ${ckpt.completedSamples.length}/${sampled.length}`,
        progress: {
          sampledDecisionCount: sampled.length,
          oracleCompletedSamples: ckpt.completedSamples.length,
          oracleTotalSamples: sampled.length,
        },
      });
      console.log(`[offline-train] oracle checkpoint: ${ckpt.completedSamples.length} done, ${ckpt.pendingSamples.length} pending`);
    } else if (config.resume && existsSync(samplingCheckpoint)) {
      heartbeat.update('resuming sampling checkpoint');
      tracker.update({ phase: 'sampling', message: 'resuming sampling checkpoint' });
      console.log('[offline-train] resuming from sampling checkpoint...');
      sampled = JSON.parse(readFileSync(samplingCheckpoint, 'utf8'));
      tracker.update({
        phase: 'sampling',
        message: `sampling checkpoint loaded: ${sampled.length}`,
        progress: {
          sampledDecisionCount: sampled.length,
          samplingTargetSamples: config.maxSamples,
        },
      });
      console.log(`[offline-train] loaded ${sampled.length} sampled states from checkpoint`);
    } else {
      heartbeat.update('sampling self-play discard states');
      tracker.update({ phase: 'sampling', message: 'sampling self-play states' });
      console.log('[offline-train] sampling self-play discard states...');
      sampled = await sampleSelfPlayDiscardStates({
        ...config,
        onSamplingProgress: (progress) => {
          tracker.update({
            phase: 'sampling',
            message: `sampling self-play states ${progress.sampledDecisionCount}/${progress.targetSamples ?? '?'}`,
            progress: {
              sampledDecisionCount: progress.sampledDecisionCount,
              samplingTargetSamples: progress.targetSamples,
            },
          });
          tracker.assertNotCancelled();
        },
      });
      tracker.assertNotCancelled();
      console.log(`[offline-train] sampled ${sampled.length} states`);
      writeJsonFileAtomic(samplingCheckpoint, sampled);
      tracker.update({
        phase: 'sampling',
        message: `sampling checkpoint saved: ${sampled.length}`,
        progress: {
          sampledDecisionCount: sampled.length,
          samplingTargetSamples: config.maxSamples,
        },
      });
      console.log(`[offline-train] sampling checkpoint saved: ${sampled.length} states`);
    }

    if (!samplesWithOracle) {
      heartbeat.update('evaluating rollout oracle');
      tracker.update({
        phase: 'oracle',
        message: 'evaluating rollout oracle',
        progress: {
          sampledDecisionCount: sampled.length,
          oracleCompletedSamples: oracleResumeCompleted?.length || 0,
          oracleTotalSamples: sampled.length,
        },
      });
      console.log('[offline-train] evaluating rollout oracle for legal candidates...');
      samplesWithOracle = await attachOracleToSamples(sampled, config, {
        completedSamples: oracleResumeCompleted,
        checkpointFile: oracleCheckpoint,
        onProgress: (progress) => {
          tracker.update({
            phase: 'oracle',
            message: `oracle progress ${progress.completedSamples}/${progress.totalSamples}`,
            progress: {
              oracleCompletedSamples: progress.completedSamples,
              oracleTotalSamples: progress.totalSamples,
            },
          });
          tracker.assertNotCancelled();
        },
      });

      writeJsonFileAtomic(oracleCompleteFile, samplesWithOracle);
      const durableEvaluationSamples = toPolicyEvaluationSamples(samplesWithOracle);
      writeJsonFileAtomic(config.datasetFile, durableEvaluationSamples);
      tracker.update({
        phase: 'oracle',
        message: 'oracle completed; durable snapshots saved',
        progress: {
          sampledDecisionCount: samplesWithOracle.length,
          oracleCompletedSamples: samplesWithOracle.length,
          oracleTotalSamples: samplesWithOracle.length,
        },
        outputs: {
          datasetFile: config.datasetFile,
        },
      });
      console.log(`[offline-train] completed oracle snapshot: ${oracleCompleteFile}`);
      console.log(`[offline-train] durable dataset saved: ${config.datasetFile}`);
    } else {
      const durableEvaluationSamples = toPolicyEvaluationSamples(samplesWithOracle);
      writeJsonFileAtomic(config.datasetFile, durableEvaluationSamples);
      tracker.update({
        phase: 'oracle',
        message: 'using completed oracle snapshot; durable dataset refreshed',
        progress: {
          sampledDecisionCount: samplesWithOracle.length,
          oracleCompletedSamples: samplesWithOracle.length,
          oracleTotalSamples: samplesWithOracle.length,
        },
        outputs: {
          datasetFile: config.datasetFile,
        },
      });
      console.log(`[offline-train] durable dataset refreshed: ${config.datasetFile}`);
    }

    tracker.update({
      phase: 'oracle',
      message: 'oracle data ready; checkpoints retained for safety',
      progress: {
        sampledDecisionCount: samplesWithOracle.length,
        oracleCompletedSamples: samplesWithOracle.length,
        oracleTotalSamples: samplesWithOracle.length,
      },
    });
    console.log('[offline-train] checkpoints retained for safe resume');
    const baselineArtifact = getActivePolicyArtifact();
    const signalSummary = summarizeOracleSignal(samplesWithOracle, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
    });
    console.log(
      `[offline-train] oracle low-signal ratio: ${(signalSummary.lowSignalRatio * 100).toFixed(1)}% (${signalSummary.lowSignalSamples}/${signalSummary.totalSamples})`,
    );

    const trainingSamples = [...samplesWithOracle];
    console.log(`[offline-train] total training samples: ${trainingSamples.length}`);

    heartbeat.update('fitting learned policy artifact');
    tracker.update({ phase: 'fitting', message: 'fitting learned policy artifact' });
    console.log('[offline-train] fitting learned policy artifact...');
    const artifact = trainPolicyArtifactFromSamples(trainingSamples, baselineArtifact, {
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
      selfPlayGames: config.selfPlayGames,
      sampledDecisionCount: trainingSamples.length,
      rolloutCountPerAction: config.rolloutCountPerAction,
      seed: config.rolloutSeed,
      maxSampleResponseToDiscardRatio: config.maxSampleResponseToDiscardRatio,
      maxResponseToDiscardRatio: config.maxResponseToDiscardRatio,
      discardSampleWeight: config.discardSampleWeight,
      discardStageMinShare: config.discardStageMinShare,
      discardOpeningWeight: config.discardOpeningWeight,
      discardMidgameWeight: config.discardMidgameWeight,
      openingHeuristicDisagreementWeight: config.openingHeuristicDisagreementWeight,
      midgameHeuristicDisagreementWeight: config.midgameHeuristicDisagreementWeight,
      hardExampleWeight: config.hardExampleWeight,
    };

    let feedbackReward: ReplayFeedbackRewardReport | undefined;
    if (config.feedbackFile) {
      heartbeat.update('processing replay feedback');
      tracker.update({ phase: 'feedback', message: 'processing replay feedback' });
      console.log(`[offline-train] loading replay feedback from ${config.feedbackFile}...`);
      const feedbackInput = readJsonFile<unknown>(config.feedbackFile);
      const feedbackSamples = buildReplayFeedbackPreferenceSamples(feedbackInput, {
        maxSamples: config.maxFeedbackSamples,
      });
      console.log(`[offline-train] accepted feedback samples: ${feedbackSamples.accepted}`);
      console.log(`[offline-train] skipped feedback samples: ${feedbackSamples.skipped}`);
      Object.entries(feedbackSamples.skippedByReason).forEach(([reason, count]) => {
        console.log(`[offline-train] feedback sample skip ${reason}: ${count}`);
      });

      if (feedbackSamples.samples.length > 0) {
        const rewardConfig = {
          topK: config.feedbackTopK,
          winRateWeight: config.winRateWeight,
          expectedScoreWeight: config.expectedScoreWeight,
        };
        const baselineReward = evaluatePolicyFeedbackReward(
          feedbackSamples.samples,
          baselineArtifact,
          rewardConfig,
        );
        const learnedReward = evaluatePolicyFeedbackReward(
          feedbackSamples.samples,
          artifact,
          rewardConfig,
        );
        feedbackReward = {
          sampleCount: feedbackSamples.accepted,
          skippedByReason: mergeCountMaps(
            feedbackSamples.skippedByReason,
            baselineReward.skippedByReason,
            learnedReward.skippedByReason,
          ),
          baseline: baselineReward.metrics,
          learned: learnedReward.metrics,
          delta: {
            rewardScoreDelta: learnedReward.metrics.rewardScore - baselineReward.metrics.rewardScore,
            top1MatchRateDelta: learnedReward.metrics.top1MatchRate - baselineReward.metrics.top1MatchRate,
            topKMatchRateDelta: learnedReward.metrics.topKMatchRate - baselineReward.metrics.topKMatchRate,
            meanReciprocalRankDelta: learnedReward.metrics.meanReciprocalRank - baselineReward.metrics.meanReciprocalRank,
            meanPreferredRankImprovement: baselineReward.metrics.meanPreferredRank - learnedReward.metrics.meanPreferredRank,
            meanPreferredObjectiveGapImprovement:
              learnedReward.metrics.meanPreferredObjectiveGap - baselineReward.metrics.meanPreferredObjectiveGap,
          },
        };

        artifact.trainingMeta = {
          ...artifact.trainingMeta,
          feedbackSampleCount: feedbackSamples.accepted,
          feedbackEvaluationSampleCount: learnedReward.sampleCount,
          feedbackRewardScore: learnedReward.metrics.rewardScore,
          feedbackRewardDelta: feedbackReward.delta.rewardScoreDelta,
        };
      }
    }

    heartbeat.update('evaluating learned policy gate');
    tracker.update({ phase: 'evaluating', message: 'evaluating learned policy gate' });
    const report = evaluateLearnedVsHeuristic(trainingSamples, artifact, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
    });
    const finalReport = {
      ...report,
      feedbackReward,
      gate: evaluatePolicyGate(report, {
        minSamples: config.minSamples,
        minWinRateDelta: config.minWinRateDelta,
        minExpectedScoreDelta: config.minExpectedScoreDelta,
        minLearnedOracleMatchRate: config.minLearnedOracleMatchRate,
        minOracleMatchRateDelta: config.minOracleMatchRateDelta,
        minCategoryWinRateDelta: config.minCategoryWinRateDelta,
        minCategoryOracleMatchRateDelta: config.minCategoryOracleMatchRateDelta,
        minActionFamilyWinRateDelta: config.minActionFamilyWinRateDelta,
        minActionFamilyOracleMatchRateDelta: config.minActionFamilyOracleMatchRateDelta,
      }),
    };
    const evaluationSamples = toPolicyEvaluationSamples(trainingSamples);
    heartbeat.update('writing outputs');
    tracker.update({
      phase: 'writing',
      message: 'writing training outputs',
      progress: {
        retainedSampleCount: artifact.trainingMeta?.retainedSampleCount,
        filteredSampleCount: artifact.trainingMeta?.filteredSampleCount,
      },
    });
    const fixtures = buildBenchmarkFixturesFromSamples(evaluationSamples);

    writeJsonFileAtomic(config.datasetFile, evaluationSamples);
    writeJsonFileAtomic(config.artifactFile, artifact);
    writeJsonFileAtomic(config.reportFile, finalReport);
    writeJsonFileAtomic(config.fixturesFile, fixtures);

    heartbeat.update('completed');
    tracker.complete({
      message: `training completed with gate ${finalReport.gate.passed ? 'PASS' : 'FAIL'}`,
      outputs: {
        artifactFile: config.artifactFile,
        datasetFile: config.datasetFile,
        reportFile: config.reportFile,
        fixturesFile: config.fixturesFile,
      },
      gate: finalReport.gate,
      progress: {
        sampledDecisionCount: trainingSamples.length,
        oracleCompletedSamples: trainingSamples.length,
        oracleTotalSamples: trainingSamples.length,
        retainedSampleCount: artifact.trainingMeta?.retainedSampleCount,
        filteredSampleCount: artifact.trainingMeta?.filteredSampleCount,
      },
    });
    console.log('[offline-train] done');
    console.log(`[offline-train] artifact: ${config.artifactFile}`);
    console.log(`[offline-train] dataset: ${config.datasetFile}`);
    console.log(`[offline-train] report: ${config.reportFile}`);
    console.log(`[offline-train] fixtures: ${config.fixturesFile}`);
    console.log(`[offline-train] gate: ${finalReport.gate.passed ? 'PASS' : 'FAIL'}`);
    console.log(`[offline-train] learnedOracleMatchRate: ${finalReport.learnedOracleMatchRate ?? 0}`);
    console.log(`[offline-train] heuristicOracleMatchRate: ${finalReport.heuristicOracleMatchRate ?? 0}`);
    finalReport.benchmarkSummary.forEach((entry) => {
      console.log(
        `[offline-train] category=${entry.name} samples=${entry.sampleCount} winRateDelta=${entry.winRateDelta} expectedScoreDelta=${entry.expectedScoreDelta} learnedMatch=${(entry.learnedOracleMatchRate * 100).toFixed(1)}% heuristicMatch=${(entry.heuristicOracleMatchRate * 100).toFixed(1)}%`,
      );
    });
    (finalReport.actionFamilySummary || []).forEach((entry) => {
      console.log(
        `[offline-train] family=${entry.name} samples=${entry.sampleCount} winRateDelta=${entry.winRateDelta} expectedScoreDelta=${entry.expectedScoreDelta} learnedMatch=${(entry.learnedOracleMatchRate * 100).toFixed(1)}% heuristicMatch=${(entry.heuristicOracleMatchRate * 100).toFixed(1)}%`,
      );
    });
    if (artifact.trainingMeta) {
      console.log(`[offline-train] retainedSampleCount: ${artifact.trainingMeta.retainedSampleCount ?? 0}`);
      console.log(`[offline-train] filteredSampleCount: ${artifact.trainingMeta.filteredSampleCount ?? 0}`);
      console.log(`[offline-train] pairwiseRowCount: ${artifact.trainingMeta.pairwiseRowCount ?? 0}`);
      console.log(`[offline-train] lowSignalRatio: ${artifact.trainingMeta.lowSignalRatio ?? 0}`);
    }
    if (feedbackReward) {
      console.log(`[offline-train] feedbackReward.score: ${feedbackReward.learned.rewardScore}`);
      console.log(`[offline-train] feedbackReward.delta: ${feedbackReward.delta.rewardScoreDelta}`);
      console.log(`[offline-train] feedbackReward.top1Delta: ${feedbackReward.delta.top1MatchRateDelta}`);
      console.log(`[offline-train] feedbackReward.topKDelta: ${feedbackReward.delta.topKMatchRateDelta}`);
      console.log(`[offline-train] feedbackReward.rankImprove: ${feedbackReward.delta.meanPreferredRankImprovement}`);
    }
    if (!finalReport.gate.passed) {
      finalReport.gate.reasons.forEach((reason) => console.log(`[offline-train] gate reason: ${reason}`));
    }

    if (config.failOnRegression && !finalReport.gate.passed) {
      throw new Error(`offline train gate failed: ${finalReport.gate.reasons.join('; ')}`);
    }
  } catch (error) {
    tracker.fail(error);
    throw error;
  } finally {
    heartbeat.stop();
  }
}

if (process.env.VITEST !== 'true') {
  main().catch((error) => {
    console.error('[offline-train] failed:', error);
    process.exitCode = 1;
  });
}
