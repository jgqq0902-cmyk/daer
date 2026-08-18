import type {
  PolicyActionFamily,
  PolicyArtifact,
  PolicyFeatureContribution,
  PolicyHeadModel,
  PolicyStage,
} from '../shared/types/ai';

export type PolicyMode = 'heuristic' | 'learned';

export interface PolicyRankInput {
  predictedWinRate: number;
  predictedExpectedScore: number;
  policyScore?: number;
  baselinePriority?: number;
}

export interface PolicyScoreContext {
  actionFamily?: PolicyActionFamily;
  stage?: PolicyStage;
}

export const DEFAULT_POLICY_WIN_RATE_WEIGHT = 100;
export const DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT = 2.5;
export const DEFAULT_POLICY_HEAD_MIN_SAMPLE_COUNT = 24;
export const DEFAULT_POLICY_STAGE_ADJUSTMENT_MIN_SAMPLE_COUNT = 12;

const FEATURE_LABELS: Record<string, string> = {
  heuristic_win_rate: '启发式胜率',
  heuristic_expected_score: '启发式期望分',
  heuristic_priority: '启发式优先级',
  wait_count: '听口数',
  remaining_wait_count: '进张总量',
  max_round_score: '最大单局分',
  danger_score: '危险分',
  speed_score: '速度评分',
  ukeire_score: '进张效率',
  score_bonus: '分数奖励',
  tempo_gain: '向听改善',
  tempo_loss: '向听倒退',
  ukeire_delta_score: '进张变化',
  score_cross_10_flag: '跨10胡',
  score_cross_20_flag: '跨20胡',
  dead_tile_flag: '死张标记',
  isolated_flag: '孤张标记',
  nearly_dead_flag: '近死张标记',
  stable_structure_loss: '稳定结构损失',
  flexibility_score: '路线弹性',
  response_value: '响应进张价值',
  response_action_chi: '吃牌响应',
  response_action_peng: '碰牌响应',
  response_action_zhao: '招牌响应',
  response_action_pass: '过牌响应',
  post_response_discard_risk: '响应后弃牌风险',
  bipai_extra_meld_count: '比牌额外成列',
  gui_value: '归潜力',
  live_response_sequence_count: '顺子响应进张',
  live_response_2710_count: '二七十响应进张',
  dead_response_sequence_count: '死顺子响应',
  dead_response_2710_count: '死二七十响应',
  stable_response_block_count: '稳定组阻塞',
  viable_pair_templates: '对子模板数',
  viable_mixed_templates: '大小搭模板数',
  viable_sequence_templates: '顺子模板数',
  viable_2710_templates: '二七十模板数',
  blocked_template_count: '受阻模板数',
  free_support_count: '自由支撑数',
  total_live_support: '总活支撑数',
  preserves_tempo_flag: '不降速标记',
  exact_meld_anchor_strength: '成型锚点强度',
  shape_anchor_strength: '牌型锚点强度',
  turn_count: '回合数',
  deck_pressure: '牌山压力',
  opening_flag: '开局阶段',
  midgame_flag: '中局阶段',
  endgame_flag: '残局阶段',
};

export const DEFAULT_POLICY_ARTIFACT: PolicyArtifact = {
  policyVersion: 'learned-v1-1774237565697',
  featureSchemaVersion: 'discard-v1',
  generatedAt: '2026-03-23T03:46:05.764Z',
  policyName: 'Learned Discard Policy v4-mid',
  objective: 'dual_balanced',
  scoreWeights: {
    blocked_template_count: 0.008,
    danger_score: -0.036,
    dead_response_2710_count: -0.059,
    dead_response_sequence_count: -0.029,
    dead_tile_flag: 0.011,
    exact_meld_anchor_strength: -0.07,
    flexibility_score: -0.034,
    free_support_count: -0.047,
    gui_value: 0,
    heuristic_expected_score: 0.179,
    heuristic_priority: 0.059,
    heuristic_win_rate: 0.131,
    isolated_flag: -0.029,
    live_response_2710_count: 0,
    live_response_sequence_count: -0.031,
    max_round_score: 0,
    nearly_dead_flag: -0.02,
    preserves_tempo_flag: 0.089,
    remaining_wait_count: -0.036,
    response_value: -0.031,
    score_bonus: 0,
    shape_anchor_strength: -0.082,
    speed_score: 0.08,
    stable_response_block_count: -0.037,
    stable_structure_loss: 0.174,
    total_live_support: 0.134,
    ukeire_score: 0.014,
    viable_2710_templates: 0.143,
    viable_mixed_templates: -0.017,
    viable_pair_templates: -0.106,
    viable_sequence_templates: -0.144,
    wait_count: -0.064,
  },
  normalizationStats: {
    blocked_template_count: { mean: 0.029, std: 0.2064899543300722 },
    danger_score: { mean: 10.254, std: 20.75427722433114 },
    dead_response_2710_count: { mean: 0.007, std: 0.08481666601970757 },
    dead_response_sequence_count: { mean: 0.065, std: 0.27469407856557826 },
    dead_tile_flag: { mean: 0.058, std: 0.23368863038546528 },
    exact_meld_anchor_strength: { mean: 0.628, std: 1.5887634475168135 },
    flexibility_score: { mean: 5.423, std: 13.847141200765684 },
    free_support_count: { mean: 0.819, std: 1.9308161045676069 },
    gui_value: { mean: 0, std: 0.001 },
    heuristic_expected_score: { mean: 3.819, std: 8.041770937745296 },
    heuristic_priority: { mean: 88.673, std: 325.2600419671828 },
    heuristic_win_rate: { mean: 0.138, std: 0.27556733138614986 },
    isolated_flag: { mean: 0.058, std: 0.23368863038546528 },
    live_response_2710_count: { mean: 0, std: 0.001 },
    live_response_sequence_count: { mean: 0.116, std: 0.5906575035453571 },
    max_round_score: { mean: 0, std: 0.001 },
    nearly_dead_flag: { mean: 0.043, std: 0.20393111999232325 },
    preserves_tempo_flag: { mean: 0.188, std: 0.3910358713980307 },
    remaining_wait_count: { mean: 1.493, std: 3.597999397434107 },
    response_value: { mean: 0.116, std: 0.5906575035453571 },
    score_bonus: { mean: 0, std: 0.001 },
    shape_anchor_strength: { mean: 7.475, std: 18.81712453042074 },
    speed_score: { mean: 0.176, std: 0.34631787291898436 },
    stable_response_block_count: { mean: 0.043, std: 0.2916610405434503 },
    stable_structure_loss: { mean: 0.222, std: 0.7321537743796546 },
    total_live_support: { mean: 0.906, std: 2.186545422891648 },
    ukeire_score: { mean: 0.255, std: 0.5102987890038538 },
    viable_2710_templates: { mean: 0.022, std: 0.1458305202717254 },
    viable_mixed_templates: { mean: 0.123, std: 0.38921881165205136 },
    viable_pair_templates: { mean: 0.109, std: 0.3112569796364424 },
    viable_sequence_templates: { mean: 0.203, std: 0.6720013402533108 },
    wait_count: { mean: 1.203, std: 2.8416147182718774 },
  },
  objectiveBias: 0,
  predictionWeights: {
    winRate: {
      blocked_template_count: 0.083,
      danger_score: 0.005,
      dead_response_2710_count: -0.046,
      dead_response_sequence_count: -0.012,
      dead_tile_flag: -0.03,
      exact_meld_anchor_strength: -0.049,
      flexibility_score: -0.03,
      free_support_count: -0.005,
      gui_value: 0,
      heuristic_expected_score: 0.046,
      heuristic_priority: 0.209,
      heuristic_win_rate: 0.191,
      isolated_flag: -0.004,
      live_response_2710_count: 0,
      live_response_sequence_count: -0.021,
      max_round_score: 0,
      nearly_dead_flag: -0.089,
      preserves_tempo_flag: -0.017,
      remaining_wait_count: -0.082,
      response_value: -0.021,
      score_bonus: 0,
      shape_anchor_strength: -0.037,
      speed_score: 0.122,
      stable_response_block_count: -0.118,
      stable_structure_loss: 0.172,
      total_live_support: 0.122,
      ukeire_score: 0.012,
      viable_2710_templates: 0.145,
      viable_mixed_templates: 0.083,
      viable_pair_templates: -0.191,
      viable_sequence_templates: -0.106,
      wait_count: -0.15,
    },
    expectedScore: {
      blocked_template_count: -0.045,
      danger_score: -0.06,
      dead_response_2710_count: -0.061,
      dead_response_sequence_count: -0.037,
      dead_tile_flag: 0.038,
      exact_meld_anchor_strength: -0.076,
      flexibility_score: -0.032,
      free_support_count: -0.071,
      gui_value: 0,
      heuristic_expected_score: 0.249,
      heuristic_priority: -0.052,
      heuristic_win_rate: 0.074,
      isolated_flag: -0.043,
      live_response_2710_count: 0,
      live_response_sequence_count: -0.034,
      max_round_score: 0,
      nearly_dead_flag: 0.03,
      preserves_tempo_flag: 0.152,
      remaining_wait_count: 0,
      response_value: -0.034,
      score_bonus: 0,
      shape_anchor_strength: -0.103,
      speed_score: 0.043,
      stable_response_block_count: 0.023,
      stable_structure_loss: 0.154,
      total_live_support: 0.127,
      ukeire_score: 0.013,
      viable_2710_templates: 0.124,
      viable_mixed_templates: -0.083,
      viable_pair_templates: -0.035,
      viable_sequence_templates: -0.153,
      wait_count: 0.003,
    },
  },
  predictionBias: {
    winRate: 0,
    expectedScore: 0,
  },
  predictionTargetStats: {
    winRate: { mean: 0.633, std: 0.147 },
    expectedScore: { mean: 13.703, std: 8.5 },
  },
  trainingMeta: {
    iteration: 1,
    sampledDecisionCount: 1448,
    selfPlayGames: 2,
    rolloutCountPerAction: 1,
    seed: 20260319,
    validationSampleCount: 481.6666666666667,
    retainedSampleCount: 1445,
    filteredSampleCount: 3,
    lowSignalSampleCount: 3,
    lowSignalRatio: 0.0020718232044198894,
    pairwiseRowCount: 8616,
    skippedFeatureCoverageSampleCount: 0,
    hardExampleSampleCount: 716,
  },
};

let activePolicyArtifact: PolicyArtifact = DEFAULT_POLICY_ARTIFACT;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeFeature(
  key: string,
  value: number,
  artifact: PolicyArtifact,
): number {
  const stats = artifact.normalizationStats?.[key];
  if (!stats || !Number.isFinite(stats.std) || stats.std === 0) {
    return value;
  }
  return (value - stats.mean) / stats.std;
}

function mergeWeights(
  base: Record<string, number> | undefined,
  delta: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!base && !delta) {
    return undefined;
  }
  const merged: Record<string, number> = {
    ...(base || {}),
  };
  for (const [key, value] of Object.entries(delta || {})) {
    merged[key] = (merged[key] || 0) + value;
  }
  return merged;
}

function resolveHeadModel(
  artifact: PolicyArtifact,
  context: PolicyScoreContext,
): PolicyHeadModel | undefined {
  if (!context.actionFamily) {
    return undefined;
  }
  const headModel = artifact.familyHeads?.[context.actionFamily];
  if (!headModel) {
    return undefined;
  }
  const minSampleCount = headModel.activationMinSampleCount ?? DEFAULT_POLICY_HEAD_MIN_SAMPLE_COUNT;
  if ((headModel.sampleCount ?? 0) < minSampleCount) {
    return undefined;
  }
  return headModel;
}

export function getActivePolicyArtifact(): PolicyArtifact {
  return activePolicyArtifact;
}

export function loadPolicyArtifact(artifact?: PolicyArtifact): PolicyArtifact {
  activePolicyArtifact = artifact ?? DEFAULT_POLICY_ARTIFACT;
  return activePolicyArtifact;
}

export function resetPolicyArtifact(): PolicyArtifact {
  activePolicyArtifact = DEFAULT_POLICY_ARTIFACT;
  return activePolicyArtifact;
}

export function scorePolicyFeatures(
  features: Record<string, number>,
  artifact: PolicyArtifact = activePolicyArtifact,
  context: PolicyScoreContext = {},
): {
  policyScore: number;
  predictedWinRate: number;
  predictedExpectedScore: number;
  predictedScoreVariance: number;
  featureContributions: PolicyFeatureContribution[];
} {
  const headModel = resolveHeadModel(artifact, context);
  const stageAdjustment = (() => {
    if (!context.stage) {
      return undefined;
    }
    const candidate = headModel?.stageAdjustments?.[context.stage];
    if (!candidate) {
      return undefined;
    }
    const minStageSampleCount = headModel?.stageActivationMinSampleCount
      ?? DEFAULT_POLICY_STAGE_ADJUSTMENT_MIN_SAMPLE_COUNT;
    return (candidate.sampleCount ?? 0) >= minStageSampleCount
      ? candidate
      : undefined;
  })();
  const effectiveScoreWeights = mergeWeights(
    headModel?.scoreWeights ?? artifact.scoreWeights,
    stageAdjustment?.scoreWeightDelta,
  ) || {};
  const effectiveObjectiveBias = (headModel?.objectiveBias ?? artifact.objectiveBias ?? 0)
    + (stageAdjustment?.objectiveBiasDelta ?? 0);
  const effectiveWinRateWeights = mergeWeights(
    headModel?.predictionWeights?.winRate ?? artifact.predictionWeights?.winRate,
    stageAdjustment?.predictionWeightDelta?.winRate,
  );
  const effectiveExpectedScoreWeights = mergeWeights(
    headModel?.predictionWeights?.expectedScore ?? artifact.predictionWeights?.expectedScore,
    stageAdjustment?.predictionWeightDelta?.expectedScore,
  );
  const effectiveWinRateBias = (headModel?.predictionBias?.winRate ?? artifact.predictionBias?.winRate ?? 0)
    + (stageAdjustment?.predictionBiasDelta?.winRate ?? 0);
  const effectiveExpectedScoreBias =
    (headModel?.predictionBias?.expectedScore ?? artifact.predictionBias?.expectedScore ?? 0)
    + (stageAdjustment?.predictionBiasDelta?.expectedScore ?? 0);

  const contributions: PolicyFeatureContribution[] = Object.entries(effectiveScoreWeights)
    .map(([key, weight]) => {
      const value = features[key] ?? 0;
      const normalizedValue = normalizeFeature(key, value, artifact);
      return {
        key,
        label: FEATURE_LABELS[key] || key,
        value,
        weight,
        contribution: normalizedValue * weight,
      };
    })
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));

  const normalizedKeys = new Set<string>([
    ...Object.keys(effectiveScoreWeights),
    ...Object.keys(effectiveWinRateWeights || {}),
    ...Object.keys(effectiveExpectedScoreWeights || {}),
  ]);
  const normalizedFeatureValues = new Map<string, number>();
  for (const key of normalizedKeys) {
    normalizedFeatureValues.set(key, normalizeFeature(key, features[key] ?? 0, artifact));
  }

  const totalContribution = contributions.reduce((sum, item) => sum + item.contribution, 0)
    + effectiveObjectiveBias;
  const heuristicWinRate = clamp(features.heuristic_win_rate ?? 0, 0, 1);
  const heuristicExpectedScore = Math.max(0, features.heuristic_expected_score ?? 0);
  const policyScore = Math.round(totalContribution * 10);
  const predictedWinRate = effectiveWinRateWeights
    ? clamp(
      denormalizePrediction(
        effectiveWinRateBias,
        effectiveWinRateWeights,
        headModel?.predictionTargetStats?.winRate ?? artifact.predictionTargetStats?.winRate,
        normalizedFeatureValues,
      ),
      0,
      1,
    )
    : clamp(
      heuristicWinRate
        + totalContribution * 0.0022
        + (features.remaining_wait_count ?? 0) * 0.0015
        - (features.danger_score ?? 0) * 0.00025,
      0,
      1,
    );
  const predictedExpectedScore = effectiveExpectedScoreWeights
    ? Math.max(
      0,
      denormalizePrediction(
        effectiveExpectedScoreBias,
        effectiveExpectedScoreWeights,
        headModel?.predictionTargetStats?.expectedScore ?? artifact.predictionTargetStats?.expectedScore,
        normalizedFeatureValues,
      ),
    )
    : Math.max(
      0,
      heuristicExpectedScore
        + totalContribution * 0.08
        + (features.max_round_score ?? 0) * 0.15
        + (features.gui_value ?? 0) * 0.6,
    );
  const contributionMean = contributions.length > 0
    ? contributions.reduce((sum, item) => sum + item.contribution, 0) / contributions.length
    : 0;
  const contributionVariance = contributions.length > 0
    ? contributions.reduce((sum, item) => {
      const distance = item.contribution - contributionMean;
      return sum + distance * distance;
    }, 0) / contributions.length
    : 0;
  const predictedScoreVariance = Math.max(
    0,
    contributionVariance * 0.08
      + Math.max(0, (features.danger_score ?? 0) - 35) * 0.06
      + Math.max(0, 4 - (features.remaining_wait_count ?? 0)) * 0.3,
  );

  return {
    policyScore,
    predictedWinRate,
    predictedExpectedScore,
    predictedScoreVariance,
    featureContributions: contributions.slice(0, 5),
  };
}

function denormalizePrediction(
  bias: number,
  weights: Record<string, number>,
  targetStats: { mean: number; std: number } | undefined,
  normalizedFeatureValues: Map<string, number>,
): number {
  let normalizedPrediction = bias;
  for (const [key, weight] of Object.entries(weights)) {
    normalizedPrediction += (normalizedFeatureValues.get(key) ?? 0) * weight;
  }
  const std = targetStats?.std && Number.isFinite(targetStats.std) && targetStats.std > 0
    ? targetStats.std
    : 1;
  const mean = targetStats?.mean && Number.isFinite(targetStats.mean)
    ? targetStats.mean
    : 0;
  return normalizedPrediction * std + mean;
}

export function computePolicyObjective(
  input: Pick<PolicyRankInput, 'predictedWinRate' | 'predictedExpectedScore'>,
  weights: {
    winRateWeight?: number;
    expectedScoreWeight?: number;
  } = {},
): number {
  const winRateWeight = weights.winRateWeight ?? DEFAULT_POLICY_WIN_RATE_WEIGHT;
  const expectedScoreWeight = weights.expectedScoreWeight ?? DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT;
  return input.predictedWinRate * winRateWeight + input.predictedExpectedScore * expectedScoreWeight;
}

export function computePolicyPriority(input: PolicyRankInput): number {
  const objective = computePolicyObjective(input);
  return objective * 100
    + (input.policyScore ?? 0) * 0.01
    + (input.baselinePriority ?? 0) * 0.0001;
}
