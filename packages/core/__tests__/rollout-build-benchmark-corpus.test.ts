import { describe, expect, it } from 'vitest';
import {
  filterUnseenSamples,
  getOracleLabelBudget,
  prioritizeSamplesForOracle,
} from '../scripts/rollout-build-benchmark-corpus';
import type { OfflineSample } from '../src/ai/rollout-offline';
import type { PolicyEvaluationSample } from '../src/shared/types/ai';

function createSample(
  sampleId: string,
  stateSignature: string,
  overrides: Partial<OfflineSample> = {},
): OfflineSample {
  return {
    sampleId,
    stateSignature,
    playerId: 'player_0',
    playerIndex: 0,
    turnCount: 2,
    phase: 'discarding',
    remainingDeckCards: 18,
    legalDiscards: ['S1', 'S2'],
    heuristicTopOption: 'S2',
    policyFeaturesByAction: {
      S1: { heuristic_priority: 10 },
      S2: { heuristic_priority: 1 },
    },
    state: { remainingDeckCards: 18 } as any,
    remainingDeck: [],
    ...overrides,
  };
}

function toPolicySample(sample: OfflineSample): PolicyEvaluationSample {
  return {
    ...sample,
    remainingDeckCards: sample.remainingDeckCards,
  };
}

describe('rollout-build-benchmark-corpus', () => {
  it('filters already-seen and same-batch duplicate samples before oracle labeling', () => {
    const existing = [createSample('existing-1', 'sig-a')];
    const incoming = [
      createSample('incoming-1', 'sig-a'),
      createSample('incoming-2', 'sig-b'),
      createSample('incoming-3', 'sig-b'),
      createSample('incoming-4', 'sig-c'),
    ];

    const filtered = filterUnseenSamples(incoming, existing);
    expect(filtered.map((sample) => sample.sampleId)).toEqual(['incoming-2', 'incoming-4']);
  });

  it('keeps structurally different samples that share the same coarse state signature', () => {
    const existing = [createSample('existing-1', 'sig-a', {
      policyFeaturesByAction: {
        S1: { heuristic_priority: 10, flexibility_score: 0.1 },
        S2: { heuristic_priority: 1, flexibility_score: 0.2 },
      },
    })];
    const incoming = [
      createSample('incoming-1', 'sig-a', {
        policyFeaturesByAction: {
          S1: { heuristic_priority: 10, flexibility_score: 0.8 },
          S2: { heuristic_priority: 1, flexibility_score: 0.6 },
        },
      }),
    ];

    const filtered = filterUnseenSamples(incoming, existing);
    expect(filtered.map((sample) => sample.sampleId)).toEqual(['incoming-1']);
  });

  it('prioritizes midgame and opening samples when those stage buckets are behind target', () => {
    const selectedSamples: PolicyEvaluationSample[] = [
      ...Array.from({ length: 4 }, (_, index) => toPolicySample(createSample(`opening-${index}`, `sel-open-${index}`, {
        turnCount: 2,
        remainingDeckCards: 18,
      }))),
      ...Array.from({ length: 1 }, (_, index) => toPolicySample(createSample(`mid-${index}`, `sel-mid-${index}`, {
        turnCount: 7,
        remainingDeckCards: 18,
      }))),
      ...Array.from({ length: 5 }, (_, index) => toPolicySample(createSample(`end-${index}`, `sel-end-${index}`, {
        turnCount: 13,
        remainingDeckCards: 9,
      }))),
    ];
    const incoming = [
      createSample('end-new', 'incoming-end', { turnCount: 13, remainingDeckCards: 9 }),
      createSample('opening-new', 'incoming-open', { turnCount: 2, remainingDeckCards: 18 }),
      createSample('midgame-new', 'incoming-mid', { turnCount: 7, remainingDeckCards: 18 }),
    ];

    const prioritized = prioritizeSamplesForOracle(incoming, selectedSamples, {
      targetSamples: 12,
      maxPerCategory: 10,
    });

    expect(prioritized.map((sample) => sample.sampleId)).toEqual(['midgame-new', 'opening-new', 'end-new']);
  });

  it('caps oracle labeling budget to the remaining holdout gap', () => {
    const selectedSamples: PolicyEvaluationSample[] = Array.from({ length: 10 }, (_, index) => toPolicySample(createSample(
      `selected-${index}`,
      `selected-sig-${index}`,
      { turnCount: 2, remainingDeckCards: 18 },
    )));

    expect(getOracleLabelBudget(20, selectedSamples, { targetSamples: 12 })).toBe(4);
    expect(getOracleLabelBudget(1, selectedSamples, { targetSamples: 12 })).toBe(1);
  });
});
