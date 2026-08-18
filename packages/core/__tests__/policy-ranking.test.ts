import { describe, expect, it } from 'vitest';
import {
  compareLearnedPolicyCandidates,
  computeLearnedPolicyObjective,
  computeRecommendationPriorityByMode,
} from '../src/ai/policy-ranking';

describe('policy ranking helpers', () => {
  it('computes learned policy objective with configurable weights', () => {
    const input = {
      predictedWinRate: 0.5,
      predictedExpectedScore: 10,
    };

    expect(computeLearnedPolicyObjective(input)).toBe(75);
    expect(computeLearnedPolicyObjective(input, {
      winRateWeight: 10,
      expectedScoreWeight: 1,
    })).toBe(15);
  });

  it('compares candidates by objective first', () => {
    const left = {
      predictedWinRate: 0.5,
      predictedExpectedScore: 5,
      policyScore: 10,
      baselinePriority: 120,
    };
    const right = {
      predictedWinRate: 0.6,
      predictedExpectedScore: 5,
      policyScore: 1,
      baselinePriority: 0,
    };

    expect(compareLearnedPolicyCandidates(left, right)).toBeGreaterThan(0);
  });

  it('falls back to policy score when objective gap is within epsilon', () => {
    const left = {
      predictedWinRate: 0.5,
      predictedExpectedScore: 5,
      policyScore: 2,
      baselinePriority: 20,
    };
    const right = {
      predictedWinRate: 0.50005,
      predictedExpectedScore: 5,
      policyScore: 8,
      baselinePriority: 0,
    };

    expect(compareLearnedPolicyCandidates(left, right)).toBeGreaterThan(0);
  });

  it('resolves recommendation priority by mode', () => {
    const input = {
      predictedWinRate: 0.56,
      predictedExpectedScore: 9,
      policyScore: 13,
      baselinePriority: 86,
    };

    expect(computeRecommendationPriorityByMode('heuristic', input)).toBe(86);
    expect(computeRecommendationPriorityByMode('learned', input)).toBeCloseTo(7850.1386, 4);
  });
});
