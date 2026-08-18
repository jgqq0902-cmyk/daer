import {
  computePolicyObjective,
  computePolicyPriority,
  DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT,
  DEFAULT_POLICY_WIN_RATE_WEIGHT,
} from './policy-artifact';

export interface PolicyObjectiveWeights {
  winRateWeight?: number;
  expectedScoreWeight?: number;
}

export interface LearnedPolicyCandidateScoreInput {
  predictedWinRate: number;
  predictedExpectedScore: number;
  policyScore: number;
  baselinePriority: number;
}

export interface LearnedPolicyComparatorConfig extends PolicyObjectiveWeights {
  objectiveEpsilon?: number;
  baselinePriorityEpsilon?: number;
}

const DEFAULT_OBJECTIVE_EPSILON = 0.01;
const DEFAULT_BASELINE_PRIORITY_EPSILON = 6;

export function computeLearnedPolicyObjective(
  input: Pick<LearnedPolicyCandidateScoreInput, 'predictedWinRate' | 'predictedExpectedScore'>,
  weights: PolicyObjectiveWeights = {},
): number {
  return computePolicyObjective(input, {
    winRateWeight: weights.winRateWeight ?? DEFAULT_POLICY_WIN_RATE_WEIGHT,
    expectedScoreWeight: weights.expectedScoreWeight ?? DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT,
  });
}

export function compareLearnedPolicyCandidates(
  left: LearnedPolicyCandidateScoreInput,
  right: LearnedPolicyCandidateScoreInput,
  config: LearnedPolicyComparatorConfig = {},
): number {
  const objectiveGap = computeLearnedPolicyObjective(right, config)
    - computeLearnedPolicyObjective(left, config);
  if (Math.abs(objectiveGap) >= (config.objectiveEpsilon ?? DEFAULT_OBJECTIVE_EPSILON)) {
    return objectiveGap;
  }

  const policyScoreGap = right.policyScore - left.policyScore;
  if (policyScoreGap !== 0) {
    return policyScoreGap;
  }

  const baselinePriorityGap = right.baselinePriority - left.baselinePriority;
  if (Math.abs(baselinePriorityGap) >= (config.baselinePriorityEpsilon ?? DEFAULT_BASELINE_PRIORITY_EPSILON)) {
    return baselinePriorityGap;
  }

  return objectiveGap || policyScoreGap || baselinePriorityGap;
}

export function computeRecommendationPriorityByMode(
  mode: 'heuristic' | 'learned',
  input: LearnedPolicyCandidateScoreInput,
): number {
  if (mode !== 'learned') {
    return input.baselinePriority;
  }

  return computePolicyPriority({
    predictedWinRate: input.predictedWinRate,
    predictedExpectedScore: input.predictedExpectedScore,
    policyScore: input.policyScore,
    baselinePriority: input.baselinePriority,
  });
}
