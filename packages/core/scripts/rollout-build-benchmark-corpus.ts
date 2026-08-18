import {
  attachOracleToSamples,
  sampleSelfPlayDiscardStates,
  summarizeOracleSignal,
  toPolicyEvaluationSamples,
  type OfflineSample,
  type OfflineTrainingOptions,
} from '../src/ai/rollout-offline';
import {
  buildBenchmarkFixturesFromSamples,
  DEFAULT_BENCHMARK_CORPUS_VERSION,
  inferBenchmarkCategoryFromSample,
  selectSamplesByBenchmarkFixtures,
  type BenchmarkCategory,
  type BenchmarkCorpusFile,
} from '../src/ai/benchmark-fixtures';
import { createHeartbeatLogger, parseArgs, readJsonFile, writeJsonFile, hashString } from './_common';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { PolicyEvaluationSample } from '../src/shared/types/ai';

interface BuildBenchmarkCorpusConfig extends OfflineTrainingOptions {
  outputFile: string;
  maxPerCategory: number;
  resume: boolean;
  maxBatches: number;
  batchSelfPlayGames: number;
  batchMaxSamples: number;
  targetSamples: number;
  maxResponseToDiscardRatio: number;
  minDiscardSamples: number;
  maxNearTieRatio: number;
  oracleChunkSize: number;
  samplePhase: 'all' | 'discard' | 'response';
}

const BENCHMARK_CATEGORY_ORDER: BenchmarkCategory[] = ['midgame', 'opening', 'endgame'];
const DEFAULT_ORACLE_BUDGET_MULTIPLIER = 2;

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

function buildConfig(): BuildBenchmarkCorpusConfig {
  const args = parseArgs(process.argv.slice(2));
  const benchmarkDir = `benchmarks/${DEFAULT_BENCHMARK_CORPUS_VERSION}`;
  const selfPlayGames = getNumberArg(args.selfPlayGames, 240);
  const maxSamples = getNumberArg(args.maxSamples, 4200);
  const maxPerCategory = getNumberArg(args.maxPerCategory, 140);
  const targetSamples = Math.max(1, Math.floor(getNumberArg(args.targetSamples, Math.min(3 * maxPerCategory, 360))));
  const defaultMinDiscardSamples = Math.max(8, Math.floor(targetSamples * 0.25));
  const phaseRaw = typeof args.samplePhase === 'string'
    ? args.samplePhase.trim().toLowerCase()
    : 'all';
  const samplePhase: 'all' | 'discard' | 'response' = phaseRaw === 'discard'
    ? 'discard'
    : phaseRaw === 'response'
      ? 'response'
      : 'all';
  return {
    selfPlayGames,
    maxTurnsPerGame: getNumberArg(args.maxTurnsPerGame, 24),
    maxSamples,
    rolloutCountPerAction: getNumberArg(args.rolloutCountPerAction, 36),
    rolloutSeed: getNumberArg(args.seed, 20260328),
    winRateWeight: getNumberArg(args.winRateWeight, 100),
    expectedScoreWeight: getNumberArg(args.expectedScoreWeight, 1),
    maxRolloutSteps: getNumberArg(args.maxRolloutSteps, 320),
    maxPerCategory,
    outputFile: getStringArg(args.outputFile, `${benchmarkDir}/corpus.json`),
    resume: args.resume === true,
    maxBatches: Math.max(1, Math.floor(getNumberArg(args.maxBatches, 1))),
    batchSelfPlayGames: Math.max(1, Math.floor(getNumberArg(args.batchSelfPlayGames, selfPlayGames))),
    batchMaxSamples: Math.max(1, Math.floor(getNumberArg(args.batchMaxSamples, maxSamples))),
    targetSamples,
    maxResponseToDiscardRatio: Math.max(0, getNumberArg(args.maxResponseToDiscardRatio, 2.5)),
    minDiscardSamples: Math.max(0, Math.floor(getNumberArg(args.minDiscardSamples, defaultMinDiscardSamples))),
    maxNearTieRatio: Math.max(0, Math.min(1, getNumberArg(args.maxNearTieRatio, 0.3))),
    oracleChunkSize: Math.max(1, Math.floor(getNumberArg(args.oracleChunkSize, 24))),
    samplePhase,
  };
}

function sampleSignal(sample: PolicyEvaluationSample, winRateWeight: number, expectedScoreWeight: number): number {
  const candidates = sample.oracle?.candidates || [];
  if (candidates.length < 2) {
    return 0;
  }
  const sorted = [...candidates].sort((left, right) => {
    const leftObjective = left.predictedWinRate * winRateWeight + left.predictedExpectedScore * expectedScoreWeight;
    const rightObjective = right.predictedWinRate * winRateWeight + right.predictedExpectedScore * expectedScoreWeight;
    return rightObjective - leftObjective;
  });
  const top = sorted[0];
  const second = sorted[1];
  const topObjective = top.predictedWinRate * winRateWeight + top.predictedExpectedScore * expectedScoreWeight;
  const secondObjective = second.predictedWinRate * winRateWeight + second.predictedExpectedScore * expectedScoreWeight;
  return Math.max(0, topObjective - secondObjective);
}

function buildSampleIdentity(sample: PolicyEvaluationSample): string {
  const policyFeatureFingerprint = Object.entries(sample.policyFeaturesByAction || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionKey, features]) => {
      const featureFingerprint = Object.entries(features || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([featureKey, value]) => `${featureKey}:${Number.isFinite(value) ? Number(value).toFixed(4) : 0}`)
        .join(',');
      return `${actionKey}[${featureFingerprint}]`;
    })
    .join('|');
  return [
    sample.stateSignature,
    sample.playerId,
    sample.turnCount,
    sample.phase,
    sample.remainingDeckCards,
    sample.heuristicTopOption || '',
    [...(sample.legalDiscards || [])].sort().join(','),
    policyFeatureFingerprint,
  ].join('|');
}

function computeNearTieRatio(
  samples: PolicyEvaluationSample[],
  winRateWeight: number,
  expectedScoreWeight: number,
  nearTieThreshold = 0.15,
): number {
  if (samples.length === 0) {
    return 0;
  }
  let nearTieCount = 0;
  for (const sample of samples) {
    const candidates = sample.oracle?.candidates || [];
    if (candidates.length < 2) {
      nearTieCount += 1;
      continue;
    }
    const ranked = [...candidates].sort((left, right) => {
      const leftObjective = left.predictedWinRate * winRateWeight + left.predictedExpectedScore * expectedScoreWeight;
      const rightObjective = right.predictedWinRate * winRateWeight + right.predictedExpectedScore * expectedScoreWeight;
      return rightObjective - leftObjective;
    });
    const top = ranked[0];
    const second = ranked[1];
    const topObjective = top.predictedWinRate * winRateWeight + top.predictedExpectedScore * expectedScoreWeight;
    const secondObjective = second.predictedWinRate * winRateWeight + second.predictedExpectedScore * expectedScoreWeight;
    if ((topObjective - secondObjective) <= nearTieThreshold) {
      nearTieCount += 1;
    }
  }
  return nearTieCount / samples.length;
}

function buildUniqueSampleId(identity: string, usedIds: Set<string>): string {
  const base = `sample_${hashString(identity).toString(16)}`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let suffix = 1;
  while (usedIds.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  const value = `${base}_${suffix}`;
  usedIds.add(value);
  return value;
}

function mergeSamples(
  existing: PolicyEvaluationSample[],
  incoming: PolicyEvaluationSample[],
  winRateWeight: number,
  expectedScoreWeight: number,
): PolicyEvaluationSample[] {
  const byIdentity = new Map<string, PolicyEvaluationSample>();
  const usedIds = new Set<string>();

  const push = (sample: PolicyEvaluationSample) => {
    const identity = buildSampleIdentity(sample);
    const current = byIdentity.get(identity);
    const preferredSampleId = sample.sampleId && !usedIds.has(sample.sampleId)
      ? sample.sampleId
      : undefined;
    const assignedSampleId = preferredSampleId || buildUniqueSampleId(identity, usedIds);
    usedIds.add(assignedSampleId);
    const normalized: PolicyEvaluationSample = {
      ...sample,
      sampleId: assignedSampleId,
    };
    if (!current) {
      byIdentity.set(identity, normalized);
      return;
    }
    const currentSignal = sampleSignal(current, winRateWeight, expectedScoreWeight);
    const nextSignal = sampleSignal(normalized, winRateWeight, expectedScoreWeight);
    if (nextSignal > currentSignal) {
      byIdentity.set(identity, {
        ...normalized,
        sampleId: current.sampleId,
      });
    }
  };

  existing.forEach(push);
  incoming.forEach(push);
  return [...byIdentity.values()];
}

function readExistingCorpus(outputFile: string): BenchmarkCorpusFile | undefined {
  if (!existsSync(outputFile)) {
    return undefined;
  }
  try {
    return readJsonFile<BenchmarkCorpusFile>(outputFile);
  } catch {
    return undefined;
  }
}

function isResponseSample(sample: PolicyEvaluationSample): boolean {
  return sample.phase === 'response_collecting';
}

function countByFamily(samples: PolicyEvaluationSample[]): { discard: number; response: number } {
  let discard = 0;
  let response = 0;
  for (const sample of samples) {
    if (isResponseSample(sample)) {
      response += 1;
    } else {
      discard += 1;
    }
  }
  return { discard, response };
}

function filterSamplesByPhase(
  samples: OfflineSample[],
  samplePhase: BuildBenchmarkCorpusConfig['samplePhase'],
): OfflineSample[] {
  if (samplePhase === 'discard') {
    return samples.filter((sample) => sample.phase !== 'response_collecting');
  }
  if (samplePhase === 'response') {
    return samples.filter((sample) => sample.phase === 'response_collecting');
  }
  return samples;
}

function countSamplesByCategory(
  samples: Array<Pick<PolicyEvaluationSample, 'turnCount' | 'remainingDeckCards'>>,
): Record<BenchmarkCategory, number> {
  const counts: Record<BenchmarkCategory, number> = {
    opening: 0,
    midgame: 0,
    endgame: 0,
  };
  for (const sample of samples) {
    counts[inferBenchmarkCategoryFromSample(sample as PolicyEvaluationSample)] += 1;
  }
  return counts;
}

function buildCategoryTargets(
  config: Pick<BuildBenchmarkCorpusConfig, 'targetSamples' | 'maxPerCategory'>,
): Record<BenchmarkCategory, number> {
  const cappedTarget = Math.max(0, Math.min(config.targetSamples, config.maxPerCategory * 3));
  const baseTarget = Math.floor(cappedTarget / 3);
  const remainder = cappedTarget % 3;
  const targets: Record<BenchmarkCategory, number> = {
    opening: baseTarget,
    midgame: baseTarget,
    endgame: baseTarget,
  };
  for (let index = 0; index < remainder; index += 1) {
    targets[BENCHMARK_CATEGORY_ORDER[index]] += 1;
  }
  return targets;
}

export function getOracleLabelBudget(
  sampleCount: number,
  selectedSamples: PolicyEvaluationSample[],
  config: Pick<BuildBenchmarkCorpusConfig, 'targetSamples'>,
): number {
  const remainingTarget = Math.max(0, config.targetSamples - selectedSamples.length);
  if (remainingTarget <= 0) {
    return Math.min(sampleCount, 1);
  }
  return Math.min(sampleCount, Math.max(1, remainingTarget * DEFAULT_ORACLE_BUDGET_MULTIPLIER));
}

function compareCategoryPriority(
  left: BenchmarkCategory,
  right: BenchmarkCategory,
  deficits: Record<BenchmarkCategory, number>,
  targets: Record<BenchmarkCategory, number>,
): number {
  const leftRatio = targets[left] > 0 ? deficits[left] / targets[left] : 0;
  const rightRatio = targets[right] > 0 ? deficits[right] / targets[right] : 0;
  if (rightRatio !== leftRatio) {
    return rightRatio - leftRatio;
  }
  if (deficits[right] !== deficits[left]) {
    return deficits[right] - deficits[left];
  }
  return BENCHMARK_CATEGORY_ORDER.indexOf(left) - BENCHMARK_CATEGORY_ORDER.indexOf(right);
}

export function prioritizeSamplesForOracle(
  samples: OfflineSample[],
  selectedSamples: PolicyEvaluationSample[],
  config: Pick<BuildBenchmarkCorpusConfig, 'targetSamples' | 'maxPerCategory'>,
): OfflineSample[] {
  if (samples.length <= 1) {
    return samples;
  }

  const targets = buildCategoryTargets(config);
  const selectedCounts = countSamplesByCategory(selectedSamples);
  const deficits: Record<BenchmarkCategory, number> = {
    opening: Math.max(0, targets.opening - selectedCounts.opening),
    midgame: Math.max(0, targets.midgame - selectedCounts.midgame),
    endgame: Math.max(0, targets.endgame - selectedCounts.endgame),
  };

  return [...samples].sort((left, right) => {
    const leftCategory = inferBenchmarkCategoryFromSample(left);
    const rightCategory = inferBenchmarkCategoryFromSample(right);
    const categoryPriority = compareCategoryPriority(leftCategory, rightCategory, deficits, targets);
    if (categoryPriority !== 0) {
      return categoryPriority;
    }
    if (right.turnCount !== left.turnCount) {
      return right.turnCount - left.turnCount;
    }
    return left.sampleId.localeCompare(right.sampleId);
  });
}

export function filterUnseenSamples(
  samples: OfflineSample[],
  existing: Array<Pick<PolicyEvaluationSample, 'stateSignature' | 'playerId' | 'turnCount' | 'phase' | 'remainingDeckCards' | 'heuristicTopOption' | 'legalDiscards'>>,
): OfflineSample[] {
  const seen = new Set(existing.map((sample) => buildSampleIdentity(sample as PolicyEvaluationSample)));
  const output: OfflineSample[] = [];
  for (const sample of samples) {
    const identity = buildSampleIdentity(sample);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    output.push(sample);
  }
  return output;
}

function rebalanceSelectedSamplesByFamily(
  selectedSamples: PolicyEvaluationSample[],
  mergedSamples: PolicyEvaluationSample[],
  config: Pick<BuildBenchmarkCorpusConfig, 'maxResponseToDiscardRatio' | 'minDiscardSamples' | 'winRateWeight' | 'expectedScoreWeight'>,
): PolicyEvaluationSample[] {
  if (selectedSamples.length === 0) {
    return selectedSamples;
  }

  const winRateWeight = config.winRateWeight ?? 100;
  const expectedScoreWeight = config.expectedScoreWeight ?? 1;
  const selectedById = new Map<string, PolicyEvaluationSample>();
  for (const sample of selectedSamples) {
    selectedById.set(sample.sampleId, sample);
  }

  let discardSelected = [...selectedById.values()].filter((sample) => !isResponseSample(sample));
  const minDiscardTarget = Math.max(0, config.minDiscardSamples);
  if (discardSelected.length < minDiscardTarget) {
    const need = minDiscardTarget - discardSelected.length;
    const extraDiscard = mergedSamples
      .filter((sample) => !isResponseSample(sample) && !selectedById.has(sample.sampleId))
      .sort((left, right) => sampleSignal(right, winRateWeight, expectedScoreWeight)
        - sampleSignal(left, winRateWeight, expectedScoreWeight)
        || left.sampleId.localeCompare(right.sampleId))
      .slice(0, need);
    for (const sample of extraDiscard) {
      selectedById.set(sample.sampleId, sample);
    }
    discardSelected = [...selectedById.values()].filter((sample) => !isResponseSample(sample));
  }

  const responseSelected = [...selectedById.values()].filter(isResponseSample);
  const maxResponse = config.maxResponseToDiscardRatio > 0
    ? Math.floor(discardSelected.length * config.maxResponseToDiscardRatio)
    : 0;
  if (responseSelected.length > maxResponse) {
    const keepResponse = responseSelected
      .sort((left, right) => sampleSignal(right, winRateWeight, expectedScoreWeight)
        - sampleSignal(left, winRateWeight, expectedScoreWeight)
        || left.sampleId.localeCompare(right.sampleId))
      .slice(0, Math.max(0, maxResponse));
    return [...discardSelected, ...keepResponse];
  }

  return [...discardSelected, ...responseSelected];
}

async function main(): Promise<void> {
  const config = buildConfig();
  const heartbeat = createHeartbeatLogger({ label: 'benchmark-build' });
  const existingCorpus = config.resume ? readExistingCorpus(config.outputFile) : undefined;
  let mergedSamples = existingCorpus?.samples || [];
  let totalSelfPlayGames = existingCorpus?.config.selfPlayGames || 0;
  let lastFixtures = existingCorpus?.fixtures || [];
  let selectedSamples: PolicyEvaluationSample[] = [];

  if (mergedSamples.length > 0) {
    const fixtureSet = buildBenchmarkFixturesFromSamples(mergedSamples, config.maxPerCategory);
    lastFixtures = fixtureSet.fixtures;
    selectedSamples = rebalanceSelectedSamplesByFamily(
      selectSamplesByBenchmarkFixtures(mergedSamples, fixtureSet),
      mergedSamples,
      config,
    );
  }

  for (let batchIndex = 0; batchIndex < config.maxBatches; batchIndex += 1) {
    if (selectedSamples.length >= config.targetSamples) {
      break;
    }

    const batchSeed = config.rolloutSeed + batchIndex * 9973;
    heartbeat.update(`batch ${batchIndex + 1}/${config.maxBatches} sampling holdout states`);
    console.log(`[benchmark-build] batch ${batchIndex + 1}/${config.maxBatches} sampling holdout states...`);
    const sampled = await sampleSelfPlayDiscardStates({
      ...config,
      selfPlayGames: config.batchSelfPlayGames,
      maxSamples: config.batchMaxSamples,
      rolloutSeed: batchSeed,
    });
    const sampledFiltered = filterSamplesByPhase(sampled, config.samplePhase);
    const sampledUnseen = filterUnseenSamples(sampledFiltered, mergedSamples);
    const prioritizedUnseen = prioritizeSamplesForOracle(sampledUnseen, selectedSamples, config);
    const oracleBudget = getOracleLabelBudget(prioritizedUnseen.length, selectedSamples, config);
    const sampledForOracle = prioritizedUnseen.slice(0, oracleBudget);
    const selectedCategoryCounts = countSamplesByCategory(selectedSamples);
    console.log(
      `[benchmark-build] batch ${batchIndex + 1} sampled ${sampled.length} states (phase=${config.samplePhase} kept=${sampledFiltered.length} unseen=${sampledUnseen.length} oracleBudget=${sampledForOracle.length} selectedOpening=${selectedCategoryCounts.opening} selectedMidgame=${selectedCategoryCounts.midgame} selectedEndgame=${selectedCategoryCounts.endgame})`,
    );

    heartbeat.update(`batch ${batchIndex + 1}/${config.maxBatches} evaluating oracle labels`);
    console.log(`[benchmark-build] batch ${batchIndex + 1} evaluating oracle labels in chunks...`);
    const chunkSize = Math.max(1, config.oracleChunkSize);
    const totalChunks = Math.max(1, Math.ceil(sampledForOracle.length / chunkSize));
    for (let offset = 0; offset < sampledForOracle.length; offset += chunkSize) {
      const chunkIndex = Math.floor(offset / chunkSize);
      heartbeat.update(`batch ${batchIndex + 1}/${config.maxBatches} chunk ${chunkIndex + 1}/${totalChunks} oracle labeling`);
      const sampledChunk = sampledForOracle.slice(offset, Math.min(sampledForOracle.length, offset + chunkSize));
      const withOracleChunk = await attachOracleToSamples(sampledChunk, {
        ...config,
        selfPlayGames: sampledChunk.length,
        maxSamples: sampledChunk.length,
        rolloutSeed: batchSeed + chunkIndex,
      });
      const evaluationSamples = toPolicyEvaluationSamples(withOracleChunk);
      mergedSamples = mergeSamples(
        mergedSamples,
        evaluationSamples,
        config.winRateWeight ?? 100,
        config.expectedScoreWeight ?? 1,
      );

      const fullSignalChunk = summarizeOracleSignal(mergedSamples, {
        winRateWeight: config.winRateWeight,
        expectedScoreWeight: config.expectedScoreWeight,
      });
      const fixturesChunk = buildBenchmarkFixturesFromSamples(mergedSamples, config.maxPerCategory);
      selectedSamples = rebalanceSelectedSamplesByFamily(
        selectSamplesByBenchmarkFixtures(mergedSamples, fixturesChunk),
        mergedSamples,
        config,
      );
      lastFixtures = fixturesChunk.fixtures;
      const selectedSignalChunk = summarizeOracleSignal(selectedSamples, {
        winRateWeight: config.winRateWeight,
        expectedScoreWeight: config.expectedScoreWeight,
      });
      const selectedNearTieRatioChunk = computeNearTieRatio(
        selectedSamples,
        config.winRateWeight ?? 100,
        config.expectedScoreWeight ?? 1,
      );
      const selectedFamilyChunk = countByFamily(selectedSamples);
      const selectedCategoryChunk = countSamplesByCategory(selectedSamples);
      const chunkCorpus: BenchmarkCorpusFile = {
        version: DEFAULT_BENCHMARK_CORPUS_VERSION,
        generatedAt: new Date().toISOString(),
        source: 'selfplay-holdout',
        config: {
          seed: config.rolloutSeed,
          selfPlayGames: totalSelfPlayGames + config.batchSelfPlayGames,
          maxTurnsPerGame: config.maxTurnsPerGame ?? 18,
          maxSamples: config.batchMaxSamples * Math.max(1, batchIndex + 1),
          rolloutCountPerAction: config.rolloutCountPerAction,
          maxRolloutSteps: config.maxRolloutSteps ?? 120,
          maxPerCategory: config.maxPerCategory,
        },
        fixtures: lastFixtures,
        samples: selectedSamples,
      };
      writeJsonFile(config.outputFile, chunkCorpus);
      console.log(
        `[benchmark-build] batch ${batchIndex + 1}/${config.maxBatches} chunk ${chunkIndex + 1}/${totalChunks} merged=${mergedSamples.length} selected=${selectedSamples.length} opening=${selectedCategoryChunk.opening} midgame=${selectedCategoryChunk.midgame} endgame=${selectedCategoryChunk.endgame} discard=${selectedFamilyChunk.discard} response=${selectedFamilyChunk.response} fullLowSignal=${(fullSignalChunk.lowSignalRatio * 100).toFixed(1)}% selectedLowSignal=${(selectedSignalChunk.lowSignalRatio * 100).toFixed(1)}% selectedNearTie=${(selectedNearTieRatioChunk * 100).toFixed(1)}%`,
      );
    }
    totalSelfPlayGames += config.batchSelfPlayGames;

    const fullSignal = summarizeOracleSignal(mergedSamples, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
    });
    const fixtures = buildBenchmarkFixturesFromSamples(mergedSamples, config.maxPerCategory);
    selectedSamples = rebalanceSelectedSamplesByFamily(
      selectSamplesByBenchmarkFixtures(mergedSamples, fixtures),
      mergedSamples,
      config,
    );
    lastFixtures = fixtures.fixtures;
    const selectedSignal = summarizeOracleSignal(selectedSamples, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
    });
    const selectedNearTieRatio = computeNearTieRatio(
      selectedSamples,
      config.winRateWeight ?? 100,
      config.expectedScoreWeight ?? 1,
    );
    const selectedFamily = countByFamily(selectedSamples);
    const selectedCategory = countSamplesByCategory(selectedSamples);

    const interimCorpus: BenchmarkCorpusFile = {
      version: DEFAULT_BENCHMARK_CORPUS_VERSION,
      generatedAt: new Date().toISOString(),
      source: 'selfplay-holdout',
      config: {
        seed: config.rolloutSeed,
        selfPlayGames: totalSelfPlayGames,
        maxTurnsPerGame: config.maxTurnsPerGame ?? 18,
        maxSamples: config.batchMaxSamples * Math.max(1, batchIndex + 1),
        rolloutCountPerAction: config.rolloutCountPerAction,
        maxRolloutSteps: config.maxRolloutSteps ?? 120,
        maxPerCategory: config.maxPerCategory,
      },
      fixtures: lastFixtures,
      samples: selectedSamples,
    };

    writeJsonFile(config.outputFile, interimCorpus);
    console.log(
      `[benchmark-build] batch ${batchIndex + 1} merged=${mergedSamples.length} selected=${selectedSamples.length} opening=${selectedCategory.opening} midgame=${selectedCategory.midgame} endgame=${selectedCategory.endgame} discard=${selectedFamily.discard} response=${selectedFamily.response} fullLowSignal=${(fullSignal.lowSignalRatio * 100).toFixed(1)}% selectedLowSignal=${(selectedSignal.lowSignalRatio * 100).toFixed(1)}% selectedNearTie=${(selectedNearTieRatio * 100).toFixed(1)}%`,
    );
  }

  const corpus: BenchmarkCorpusFile = {
    version: DEFAULT_BENCHMARK_CORPUS_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'selfplay-holdout',
    config: {
      seed: config.rolloutSeed,
      selfPlayGames: totalSelfPlayGames || config.selfPlayGames,
      maxTurnsPerGame: config.maxTurnsPerGame ?? 18,
      maxSamples: config.batchMaxSamples * Math.max(1, config.maxBatches),
      rolloutCountPerAction: config.rolloutCountPerAction,
      maxRolloutSteps: config.maxRolloutSteps ?? 120,
      maxPerCategory: config.maxPerCategory,
    },
    fixtures: lastFixtures,
    samples: selectedSamples,
  };

  heartbeat.update('writing final benchmark corpus');
  try {
    writeJsonFile(config.outputFile, corpus);
    const finalNearTieRatio = computeNearTieRatio(
      selectedSamples,
      config.winRateWeight ?? 100,
      config.expectedScoreWeight ?? 1,
    );
    if (selectedSamples.length < config.targetSamples) {
      console.warn(`[benchmark-build] warning: selected samples ${selectedSamples.length} < targetSamples ${config.targetSamples}`);
    }
    if (selectedSamples.length >= config.targetSamples && finalNearTieRatio > config.maxNearTieRatio) {
      throw new Error(
        `[benchmark-build] near-tie ratio ${(finalNearTieRatio * 100).toFixed(1)}% exceeds maxNearTieRatio ${(config.maxNearTieRatio * 100).toFixed(1)}%`,
      );
    }
    heartbeat.update('completed');
    console.log('[benchmark-build] done');
    console.log(`[benchmark-build] output: ${config.outputFile}`);
    console.log(`[benchmark-build] fixtures: ${corpus.fixtures.length}`);
    console.log(`[benchmark-build] samples: ${corpus.samples.length}`);
    console.log(`[benchmark-build] nearTieRatio: ${(finalNearTieRatio * 100).toFixed(1)}%`);
  } finally {
    heartbeat.stop();
  }
}

const entryHref = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entryHref === import.meta.url) {
  main().catch((error) => {
    console.error('[benchmark-build] failed:', error);
    process.exitCode = 1;
  });
}
