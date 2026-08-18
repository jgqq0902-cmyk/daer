import { describe, expect, it } from 'vitest';
import type { PolicyArtifact } from '../src/shared/types/ai';
import { scorePolicyFeatures } from '../src/ai/policy-artifact';

const TEST_ARTIFACT: PolicyArtifact = {
  policyVersion: 'test-multihead-v2',
  featureSchemaVersion: 'discard-response-v2',
  generatedAt: '2026-03-31T00:00:00.000Z',
  objective: 'dual_balanced',
  scoreWeights: {
    heuristic_priority: 1,
  },
  objectiveBias: 0,
  familyHeads: {
    discard: {
      sampleCount: 40,
      activationMinSampleCount: 24,
      stageActivationMinSampleCount: 12,
      scoreWeights: {
        heuristic_priority: 2,
      },
      objectiveBias: 0,
      stageAdjustments: {
        midgame: {
          sampleCount: 20,
          objectiveBiasDelta: 1,
        },
      },
    },
    response: {
      sampleCount: 40,
      activationMinSampleCount: 24,
      scoreWeights: {
        heuristic_priority: -1,
      },
      objectiveBias: 0,
    },
  },
};

describe('policy artifact multi-head routing', () => {
  it('keeps legacy behavior when no routing context is provided', () => {
    const result = scorePolicyFeatures({
      heuristic_priority: 10,
      heuristic_win_rate: 0.4,
      heuristic_expected_score: 5,
    }, TEST_ARTIFACT);

    expect(result.policyScore).toBe(100);
  });

  it('routes by action family and applies stage adjustment', () => {
    const base = scorePolicyFeatures({
      heuristic_priority: 10,
      heuristic_win_rate: 0.4,
      heuristic_expected_score: 5,
    }, TEST_ARTIFACT, {
      actionFamily: 'discard',
      stage: 'opening',
    });
    const midgame = scorePolicyFeatures({
      heuristic_priority: 10,
      heuristic_win_rate: 0.4,
      heuristic_expected_score: 5,
    }, TEST_ARTIFACT, {
      actionFamily: 'discard',
      stage: 'midgame',
    });
    const response = scorePolicyFeatures({
      heuristic_priority: 10,
      heuristic_win_rate: 0.4,
      heuristic_expected_score: 5,
    }, TEST_ARTIFACT, {
      actionFamily: 'response',
      stage: 'midgame',
    });

    expect(base.policyScore).toBe(200);
    expect(midgame.policyScore).toBe(210);
    expect(response.policyScore).toBe(-100);
  });

  it('falls back to legacy scoring when head sample count is below activation threshold', () => {
    const lowSampleArtifact: PolicyArtifact = {
      ...TEST_ARTIFACT,
      familyHeads: {
        discard: {
          ...TEST_ARTIFACT.familyHeads!.discard!,
          sampleCount: 8,
          activationMinSampleCount: 24,
        },
      },
    };

    const result = scorePolicyFeatures({
      heuristic_priority: 10,
      heuristic_win_rate: 0.4,
      heuristic_expected_score: 5,
    }, lowSampleArtifact, {
      actionFamily: 'discard',
      stage: 'midgame',
    });

    expect(result.policyScore).toBe(100);
  });

  it('falls back to head-only scoring when stage adjustment sample count is below threshold', () => {
    const lowStageArtifact: PolicyArtifact = {
      ...TEST_ARTIFACT,
      familyHeads: {
        discard: {
          ...TEST_ARTIFACT.familyHeads!.discard!,
          stageActivationMinSampleCount: 24,
          stageAdjustments: {
            midgame: {
              sampleCount: 10,
              objectiveBiasDelta: 1,
            },
          },
        },
      },
    };

    const result = scorePolicyFeatures({
      heuristic_priority: 10,
      heuristic_win_rate: 0.4,
      heuristic_expected_score: 5,
    }, lowStageArtifact, {
      actionFamily: 'discard',
      stage: 'midgame',
    });

    expect(result.policyScore).toBe(200);
  });
});
