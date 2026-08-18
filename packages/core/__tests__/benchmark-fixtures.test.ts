import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationSample } from '../src/shared/types/ai';
import {
  buildBenchmarkFixturesFromSamples,
  inferBenchmarkCategoryFromSample,
} from '../src/ai/benchmark-fixtures';

function createSample(params: {
  sampleId: string;
  turnCount: number;
  remainingDeckCards: number;
  objectiveTop: number;
  objectiveSecond: number;
}): PolicyEvaluationSample {
  const topWin = params.objectiveTop / 100;
  const secondWin = params.objectiveSecond / 100;
  return {
    sampleId: params.sampleId,
    stateSignature: `${params.sampleId}_sig`,
    playerId: 'player_0',
    playerIndex: 0,
    turnCount: params.turnCount,
    phase: 'discarding',
    remainingDeckCards: params.remainingDeckCards,
    legalDiscards: ['S1', 'S2'],
    heuristicTopOption: 'S2',
    policyFeaturesByAction: {
      S1: { heuristic_priority: 10 },
      S2: { heuristic_priority: 1 },
    },
    oracle: {
      sampleId: params.sampleId,
      policyVersion: 'oracle-rollout-v1',
      objectiveScore: params.objectiveTop,
      candidates: [
        {
          action: 'discard',
          cards: ['S1'],
          predictedWinRate: topWin,
          predictedExpectedScore: 0,
          predictedScoreVariance: 0,
          futureMingTangPotential: 0,
          rolloutCount: 12,
        },
        {
          action: 'discard',
          cards: ['S2'],
          predictedWinRate: secondWin,
          predictedExpectedScore: 0,
          predictedScoreVariance: 0,
          futureMingTangPotential: 0,
          rolloutCount: 12,
        },
      ],
    },
  };
}

describe('benchmark fixtures', () => {
  it('uses unified opening/midgame/endgame category mapping', () => {
    expect(inferBenchmarkCategoryFromSample(createSample({
      sampleId: 'open',
      turnCount: 4,
      remainingDeckCards: 18,
      objectiveTop: 80,
      objectiveSecond: 20,
    }))).toBe('opening');
    expect(inferBenchmarkCategoryFromSample(createSample({
      sampleId: 'mid',
      turnCount: 6,
      remainingDeckCards: 15,
      objectiveTop: 70,
      objectiveSecond: 40,
    }))).toBe('midgame');
    expect(inferBenchmarkCategoryFromSample(createSample({
      sampleId: 'end',
      turnCount: 10,
      remainingDeckCards: 8,
      objectiveTop: 65,
      objectiveSecond: 60,
    }))).toBe('endgame');
  });

  it('prioritizes higher-signal samples when building fixtures', () => {
    const samples: PolicyEvaluationSample[] = [
      createSample({
        sampleId: 'opening-weak',
        turnCount: 2,
        remainingDeckCards: 18,
        objectiveTop: 51,
        objectiveSecond: 50,
      }),
      createSample({
        sampleId: 'opening-strong',
        turnCount: 2,
        remainingDeckCards: 18,
        objectiveTop: 80,
        objectiveSecond: 20,
      }),
    ];

    const fixtures = buildBenchmarkFixturesFromSamples(samples, 1);
    expect(fixtures.fixtures).toHaveLength(1);
    expect(fixtures.fixtures[0].sampleId).toBe('opening-strong');
  });
});
