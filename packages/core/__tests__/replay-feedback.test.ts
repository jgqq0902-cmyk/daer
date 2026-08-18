import { describe, expect, it } from 'vitest';
import type { PolicyArtifact } from '../src/shared/types/ai';
import {
  buildReplayFeedbackPreferenceSamples,
  evaluatePolicyFeedbackReward,
} from '../src/ai/replay-feedback';

const POSITIVE_TEMPO_ARTIFACT: PolicyArtifact = {
  policyVersion: 'feedback-reward-positive',
  featureSchemaVersion: 'discard-v1',
  generatedAt: '2026-03-26T00:00:00.000Z',
  objective: 'dual_balanced',
  scoreWeights: {
    tempo_gain: 1,
  },
};

const NEGATIVE_TEMPO_ARTIFACT: PolicyArtifact = {
  ...POSITIVE_TEMPO_ARTIFACT,
  policyVersion: 'feedback-reward-negative',
  scoreWeights: {
    tempo_gain: -1,
  },
};

describe('replay feedback reward pipeline', () => {
  it('builds preference samples from replay feedback export', () => {
    const result = buildReplayFeedbackPreferenceSamples({
      version: 'replay-feedback-training-v1',
      samples: [
        {
          sampleId: 'feedback_case_1',
          stateSignature: 'g1|step_10|player_0',
          playerId: 'player_0',
          playerIndex: 0,
          turnCount: 10,
          phase: 'discarding',
          remainingDeckCards: 21,
          heuristicTopOption: 'discard:S3',
          preferredOption: 'discard:S4',
          legalOptions: ['discard:S3', 'discard:S4'],
          options: [
            {
              optionCode: 'discard:S3',
              action: 'discard',
              cards: ['S3'],
              predictedWinRate: 0.42,
              predictedExpectedScore: 6,
              featureContributions: [
                { key: 'tempo_gain', value: 0.4 },
                { key: 'danger_score', value: 0.3 },
              ],
            },
            {
              optionCode: 'discard:S4',
              action: 'discard',
              cards: ['S4'],
              predictedWinRate: 0.35,
              predictedExpectedScore: 4,
              featureContributions: [
                { key: 'tempo_gain', value: 0.6 },
                { key: 'danger_score', value: 0.1 },
              ],
            },
            {
              optionCode: 'discard:S9',
              action: 'discard',
              cards: ['S9'],
              predictedWinRate: 0.2,
              predictedExpectedScore: 1,
            },
          ],
        },
      ],
    });

    expect(result.accepted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].heuristicTopOption).toBe('discard:S3');
    expect(result.samples[0].options).toHaveLength(2);
    expect(result.samples[0].options.find((option) => option.optionCode === 'discard:S3')?.policyFeatures).toMatchObject({
      tempo_gain: 0.4,
      danger_score: 0.3,
    });
    expect(result.samples[0].options.find((option) => option.optionCode === 'discard:S4')?.policyFeatures).toMatchObject({
      tempo_gain: 0.6,
      danger_score: 0.1,
    });
  });

  it('evaluates reward alignment for baseline vs learned artifacts', () => {
    const samples = buildReplayFeedbackPreferenceSamples({
      samples: [
        {
          sampleId: 'feedback_case_1',
          preferredOption: 'discard:S4',
          options: [
            {
              optionCode: 'discard:S3',
              action: 'discard',
              cards: ['S3'],
              featureContributions: [
                { key: 'tempo_gain', value: 1 },
              ],
            },
            {
              optionCode: 'discard:S4',
              action: 'discard',
              cards: ['S4'],
              featureContributions: [
                { key: 'tempo_gain', value: 5 },
              ],
            },
          ],
        },
        {
          sampleId: 'feedback_case_2',
          preferredOption: 'discard:S7',
          options: [
            {
              optionCode: 'discard:S2',
              action: 'discard',
              cards: ['S2'],
              featureContributions: [
                { key: 'tempo_gain', value: 2 },
              ],
            },
            {
              optionCode: 'discard:S7',
              action: 'discard',
              cards: ['S7'],
              featureContributions: [
                { key: 'tempo_gain', value: 4 },
              ],
            },
          ],
        },
      ],
    }).samples;

    const learnedReward = evaluatePolicyFeedbackReward(samples, POSITIVE_TEMPO_ARTIFACT, { topK: 2 });
    const baselineReward = evaluatePolicyFeedbackReward(samples, NEGATIVE_TEMPO_ARTIFACT, { topK: 2 });

    expect(learnedReward.sampleCount).toBe(2);
    expect(baselineReward.sampleCount).toBe(2);
    expect(learnedReward.metrics.top1MatchRate).toBe(1);
    expect(baselineReward.metrics.top1MatchRate).toBe(0);
    expect(learnedReward.metrics.rewardScore).toBeGreaterThan(baselineReward.metrics.rewardScore);
    expect(learnedReward.metrics.meanPreferredRank).toBeLessThan(baselineReward.metrics.meanPreferredRank);
    expect(learnedReward.metrics.meanPreferredObjectiveGap).toBeGreaterThanOrEqual(baselineReward.metrics.meanPreferredObjectiveGap);
  });

  it('skips unsupported or incomplete feedback samples', () => {
    const result = buildReplayFeedbackPreferenceSamples({
      samples: [
        {
          sampleId: 'invalid_case_missing_preferred',
          options: [
            {
              optionCode: 'discard:S3',
              action: 'discard',
              cards: ['S3'],
            },
          ],
        },
        {
          sampleId: 'invalid_case_missing_options',
          preferredOption: 'discard:S4',
          options: [],
        },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.skippedByReason['missing-preferred-option']).toBe(1);
    expect(result.skippedByReason['insufficient-options']).toBe(1);
  });
});
