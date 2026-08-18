import type { PolicyArtifact, ReplayFeedbackRewardMetrics } from '../shared/types/ai';
import { scorePolicyFeatures } from './policy-artifact';
import {
  compareLearnedPolicyCandidates,
  computeLearnedPolicyObjective,
  type PolicyObjectiveWeights,
} from './policy-ranking';
import { inferPolicyActionFamily, inferPolicyStage } from './policy-feature-builder';

interface ReplayFeedbackFeatureContributionInput {
  key?: string;
  value?: number;
}

interface ReplayFeedbackOptionInput {
  optionCode?: string;
  action?: string;
  cards?: string[];
  predictedWinRate?: number;
  predictedExpectedScore?: number;
  predictedScoreVariance?: number;
  winRate?: number;
  expectedScore?: number;
  priority?: number;
  baselinePriority?: number;
  featureContributions?: ReplayFeedbackFeatureContributionInput[];
}

interface ReplayFeedbackTrainingSampleInput {
  sampleId?: string;
  stateSignature?: string;
  playerId?: string;
  playerIndex?: number;
  turnCount?: number;
  phase?: string;
  remainingDeckCards?: number;
  heuristicTopOption?: string;
  preferredOption?: string;
  legalOptions?: string[];
  options?: ReplayFeedbackOptionInput[];
}

interface ReplayFeedbackTrainingFileInput {
  version?: string;
  samples?: ReplayFeedbackTrainingSampleInput[];
}

export interface ReplayFeedbackPreferenceBuildOptions {
  maxSamples?: number;
  minOptionsPerSample?: number;
}

export interface ReplayFeedbackPreferenceOption {
  optionCode: string;
  action: string;
  cards: string[];
  predictedWinRate?: number;
  predictedExpectedScore?: number;
  predictedScoreVariance?: number;
  priority?: number;
  baselinePriority?: number;
  policyFeatures: Record<string, number>;
}

export interface ReplayFeedbackPreferenceSample {
  sampleId: string;
  stateSignature: string;
  playerId: string;
  playerIndex: number;
  turnCount: number;
  phase: string;
  remainingDeckCards: number;
  heuristicTopOption?: string;
  preferredOption: string;
  options: ReplayFeedbackPreferenceOption[];
}

export interface ReplayFeedbackPreferenceBuildResult {
  samples: ReplayFeedbackPreferenceSample[];
  accepted: number;
  skipped: number;
  skippedByReason: Record<string, number>;
}

export interface ReplayFeedbackRewardOptions extends PolicyObjectiveWeights {
  topK?: number;
}

export interface ReplayFeedbackRewardEvaluationResult {
  policyVersion: string;
  sampleCount: number;
  skippedByReason: Record<string, number>;
  metrics: ReplayFeedbackRewardMetrics;
}

interface ScoredFeedbackOption {
  optionCode: string;
  predictedWinRate: number;
  predictedExpectedScore: number;
  policyScore: number;
  baselinePriority: number;
}

const DEFAULT_BUILD_OPTIONS: Required<ReplayFeedbackPreferenceBuildOptions> = {
  maxSamples: 200,
  minOptionsPerSample: 2,
};

const DEFAULT_REWARD_OPTIONS: Pick<ReplayFeedbackRewardOptions, 'topK'> = {
  topK: 3,
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function normalizeCards(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, 6);
}

function normalizeOptionCode(option: ReplayFeedbackOptionInput): string {
  if (typeof option.optionCode === 'string' && option.optionCode.length > 0) {
    return option.optionCode;
  }
  const action = typeof option.action === 'string' && option.action.length > 0
    ? option.action
    : 'unknown';
  const cards = normalizeCards(option.cards);
  return cards.length > 0 ? `${action}:${cards.join('+')}` : action;
}

function parsePlayerIndex(playerId: unknown, fallback = 0): number {
  if (typeof playerId !== 'string') {
    return fallback;
  }
  const value = Number(playerId.replace('player_', ''));
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function toFeatureMap(option: ReplayFeedbackOptionInput): Record<string, number> {
  const featureMap: Record<string, number> = {};
  for (const contribution of option.featureContributions || []) {
    if (!contribution || typeof contribution.key !== 'string' || contribution.key.length === 0) {
      continue;
    }
    if (typeof contribution.value !== 'number' || !Number.isFinite(contribution.value)) {
      continue;
    }
    featureMap[contribution.key] = contribution.value;
  }
  return featureMap;
}

function getNumericValue(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampNonNegative(value: number | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function extractSamples(input: unknown): ReplayFeedbackTrainingSampleInput[] {
  if (Array.isArray(input)) {
    return input as ReplayFeedbackTrainingSampleInput[];
  }

  const file = asObject(input) as ReplayFeedbackTrainingFileInput | undefined;
  if (!file || !Array.isArray(file.samples)) {
    return [];
  }

  return file.samples;
}

function mapOption(
  option: ReplayFeedbackOptionInput,
): ReplayFeedbackPreferenceOption | undefined {
  const optionCode = normalizeOptionCode(option);
  if (!optionCode) {
    return undefined;
  }

  const featureMap = toFeatureMap(option);
  return {
    optionCode,
    action: typeof option.action === 'string' && option.action.length > 0 ? option.action : 'unknown',
    cards: normalizeCards(option.cards),
    predictedWinRate: getNumericValue(option.predictedWinRate, option.winRate),
    predictedExpectedScore: getNumericValue(option.predictedExpectedScore, option.expectedScore),
    predictedScoreVariance: getNumericValue(option.predictedScoreVariance),
    priority: getNumericValue(option.priority),
    baselinePriority: getNumericValue(option.baselinePriority),
    policyFeatures: featureMap,
  };
}

function scoreFeedbackOptionForArtifact(
  option: ReplayFeedbackPreferenceOption,
  artifact: PolicyArtifact,
  context?: {
    actionFamily?: 'discard' | 'response';
    stage?: 'opening' | 'midgame' | 'endgame';
  },
): ScoredFeedbackOption | undefined {
  const hasPolicyFeatures = Object.keys(option.policyFeatures).length > 0;
  const hasPredictionFallback = typeof option.predictedWinRate === 'number'
    || typeof option.predictedExpectedScore === 'number';

  if (!hasPolicyFeatures && !hasPredictionFallback) {
    return undefined;
  }

  const evaluated = hasPolicyFeatures
    ? scorePolicyFeatures(option.policyFeatures, artifact, context)
    : undefined;

  return {
    optionCode: option.optionCode,
    predictedWinRate: clamp(
      typeof evaluated?.predictedWinRate === 'number'
        ? evaluated.predictedWinRate
        : clampNonNegative(option.predictedWinRate, 0),
      0,
      1,
    ),
    predictedExpectedScore: clampNonNegative(
      typeof evaluated?.predictedExpectedScore === 'number'
        ? evaluated.predictedExpectedScore
        : option.predictedExpectedScore,
      0,
    ),
    policyScore: typeof evaluated?.policyScore === 'number'
      ? evaluated.policyScore
      : 0,
    baselinePriority: clampNonNegative(
      option.baselinePriority ?? option.priority,
      0,
    ),
  };
}

export function buildReplayFeedbackPreferenceSamples(
  input: unknown,
  options: ReplayFeedbackPreferenceBuildOptions = {},
): ReplayFeedbackPreferenceBuildResult {
  const config = {
    ...DEFAULT_BUILD_OPTIONS,
    ...options,
  };
  const sourceSamples = extractSamples(input);
  const result: ReplayFeedbackPreferenceSample[] = [];
  const skippedByReason: Record<string, number> = {};

  const addSkip = (reason: string) => {
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
  };

  for (const rawSample of sourceSamples) {
    if (result.length >= config.maxSamples) {
      break;
    }

    const sample = asObject(rawSample) as ReplayFeedbackTrainingSampleInput | undefined;
    if (!sample) {
      addSkip('invalid-sample');
      continue;
    }

    const preferredOptionCode = typeof sample.preferredOption === 'string' && sample.preferredOption.length > 0
      ? sample.preferredOption
      : undefined;
    if (!preferredOptionCode) {
      addSkip('missing-preferred-option');
      continue;
    }

    const legalOptionCodes = Array.isArray(sample.legalOptions)
      ? sample.legalOptions.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
    const legalOptionSet = new Set(legalOptionCodes);

    const optionsInput = Array.isArray(sample.options)
      ? sample.options.filter((item): item is ReplayFeedbackOptionInput => !!asObject(item))
      : [];
    const optionMap = new Map<string, ReplayFeedbackPreferenceOption>();
    for (const rawOption of optionsInput) {
      const normalized = mapOption(rawOption);
      if (!normalized) {
        continue;
      }
      if (legalOptionSet.size > 0 && !legalOptionSet.has(normalized.optionCode)) {
        continue;
      }
      optionMap.set(normalized.optionCode, normalized);
    }

    if (optionMap.size < config.minOptionsPerSample) {
      addSkip('insufficient-options');
      continue;
    }

    if (!optionMap.has(preferredOptionCode)) {
      addSkip('preferred-option-not-found');
      continue;
    }

    const fallbackPlayerIndex = typeof sample.playerIndex === 'number'
      ? sample.playerIndex
      : parsePlayerIndex(sample.playerId, 0);
    const playerIndex = Number.isInteger(fallbackPlayerIndex) ? Math.max(0, fallbackPlayerIndex) : 0;
    const playerId = typeof sample.playerId === 'string' && sample.playerId.length > 0
      ? sample.playerId
      : `player_${playerIndex}`;

    const sampleId = typeof sample.sampleId === 'string' && sample.sampleId.length > 0
      ? sample.sampleId
      : `feedback_${result.length + 1}`;
    const stateSignature = typeof sample.stateSignature === 'string' && sample.stateSignature.length > 0
      ? sample.stateSignature
      : `${sampleId}_sig`;
    const turnCount = typeof sample.turnCount === 'number' ? Math.max(0, sample.turnCount) : 0;
    const phase = typeof sample.phase === 'string' && sample.phase.length > 0 ? sample.phase : 'discarding';
    const remainingDeckCards = typeof sample.remainingDeckCards === 'number'
      ? Math.max(0, sample.remainingDeckCards)
      : 0;
    const heuristicTopOption = typeof sample.heuristicTopOption === 'string' && sample.heuristicTopOption.length > 0
      ? sample.heuristicTopOption
      : undefined;

    result.push({
      sampleId,
      stateSignature,
      playerId,
      playerIndex,
      turnCount,
      phase,
      remainingDeckCards,
      heuristicTopOption,
      preferredOption: preferredOptionCode,
      options: [...optionMap.values()],
    });
  }

  return {
    samples: result,
    accepted: result.length,
    skipped: sourceSamples.length - result.length,
    skippedByReason,
  };
}

export function evaluatePolicyFeedbackReward(
  samples: ReplayFeedbackPreferenceSample[],
  artifact: PolicyArtifact,
  options: ReplayFeedbackRewardOptions = {},
): ReplayFeedbackRewardEvaluationResult {
  const config = {
    ...DEFAULT_REWARD_OPTIONS,
    ...options,
  };
  const topK = Math.max(1, Math.floor(config.topK ?? DEFAULT_REWARD_OPTIONS.topK ?? 3));
  const skippedByReason: Record<string, number> = {};
  const addSkip = (reason: string) => {
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
  };

  let top1MatchCount = 0;
  let topKMatchCount = 0;
  let preferredRankSum = 0;
  let reciprocalRankSum = 0;
  let preferredObjectiveGapSum = 0;
  let sampleRewardSum = 0;
  let optionCountSum = 0;
  let preferredFeatureSampleCount = 0;
  let scoredSampleCount = 0;

  for (const sample of samples) {
    if (!Array.isArray(sample.options) || sample.options.length < 2) {
      addSkip('insufficient-options');
      continue;
    }

    const scoredOptions = sample.options
      .map((option) => scoreFeedbackOptionForArtifact(option, artifact, {
        actionFamily: inferPolicyActionFamily(option.action || 'discard', sample.phase),
        stage: inferPolicyStage(sample.turnCount, sample.remainingDeckCards),
      }))
      .filter((item): item is ScoredFeedbackOption => !!item);
    if (scoredOptions.length < 2) {
      addSkip('insufficient-scorable-options');
      continue;
    }

    const ranked = [...scoredOptions].sort((left, right) => compareLearnedPolicyCandidates(
      left,
      right,
      {
        winRateWeight: config.winRateWeight,
        expectedScoreWeight: config.expectedScoreWeight,
      },
    ));
    const preferredIndex = ranked.findIndex((option) => option.optionCode === sample.preferredOption);
    if (preferredIndex < 0) {
      addSkip('preferred-option-not-scorable');
      continue;
    }

    const preferred = ranked[preferredIndex];
    const best = ranked[0];
    const preferredRank = preferredIndex + 1;
    const preferredObjective = computeLearnedPolicyObjective(preferred, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
    });
    const bestObjective = computeLearnedPolicyObjective(best, {
      winRateWeight: config.winRateWeight,
      expectedScoreWeight: config.expectedScoreWeight,
    });
    const preferredObjectiveGap = preferredObjective - bestObjective;
    const rankReward = ranked.length <= 1
      ? 1
      : 1 - ((preferredRank - 1) / (ranked.length - 1));
    const objectiveScale = Math.max(1, Math.abs(bestObjective));
    const objectiveGapPenalty = clamp((bestObjective - preferredObjective) / objectiveScale, 0, 1.5);
    const objectiveReward = clamp(1 - objectiveGapPenalty, 0, 1);
    const sampleReward = clamp(rankReward * 0.7 + objectiveReward * 0.3, 0, 1);
    const preferredHasFeatureSignals = Object.keys(
      sample.options.find((option) => option.optionCode === sample.preferredOption)?.policyFeatures || {},
    ).length > 0;

    scoredSampleCount += 1;
    optionCountSum += ranked.length;
    preferredRankSum += preferredRank;
    reciprocalRankSum += 1 / preferredRank;
    preferredObjectiveGapSum += preferredObjectiveGap;
    sampleRewardSum += sampleReward;
    if (preferredHasFeatureSignals) {
      preferredFeatureSampleCount += 1;
    }
    if (preferredRank === 1) {
      top1MatchCount += 1;
    }
    if (preferredRank <= topK) {
      topKMatchCount += 1;
    }
  }

  const denominator = Math.max(1, scoredSampleCount);
  const metrics: ReplayFeedbackRewardMetrics = {
    policyVersion: artifact.policyVersion,
    sampleCount: scoredSampleCount,
    topK,
    top1MatchRate: top1MatchCount / denominator,
    topKMatchRate: topKMatchCount / denominator,
    meanPreferredRank: preferredRankSum / denominator,
    meanReciprocalRank: reciprocalRankSum / denominator,
    meanPreferredObjectiveGap: preferredObjectiveGapSum / denominator,
    meanOptionCount: optionCountSum / denominator,
    preferredFeatureCoverage: preferredFeatureSampleCount / denominator,
    rewardScore: sampleRewardSum / denominator,
  };

  return {
    policyVersion: artifact.policyVersion,
    sampleCount: scoredSampleCount,
    skippedByReason,
    metrics,
  };
}
