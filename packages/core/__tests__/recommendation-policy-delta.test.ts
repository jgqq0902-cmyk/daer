import { describe, expect, it, beforeEach } from 'vitest';

import { AIAnalyzer } from '../src/ai/ai-analyzer';
import { loadPolicyArtifact, DEFAULT_POLICY_ARTIFACT } from '../src/ai/policy-artifact';
import { Card, CardSize, GamePhase, GameState } from '../src/shared/types';

function buildDiscardState(): GameState {
  const makeCard = (id: string, value: number, size: CardSize): Card => ({ id, value, size });
  const hand: Card[] = [
    makeCard('d-b1', 1, 'big'), makeCard('d-b2', 2, 'big'), makeCard('d-b3', 3, 'big'),
    makeCard('d-b4', 4, 'big'), makeCard('d-b5', 5, 'big'), makeCard('d-b6', 6, 'big'),
    makeCard('d-s1', 1, 'small'), makeCard('d-s3', 3, 'small'), makeCard('d-s4', 4, 'small'),
    makeCard('d-s5', 5, 'small'), makeCard('d-s6', 6, 'small'), makeCard('d-s8', 8, 'small'),
    makeCard('d-s9', 9, 'small'), makeCard('d-b8', 8, 'big'), makeCard('d-b9', 9, 'big'),
    makeCard('d-b10', 10, 'big'), makeCard('d-s10', 10, 'small'), makeCard('d-s2', 2, 'small'),
  ];
  return {
    phase: 'discarding' as GamePhase,
    turnCount: 6,
    currentPlayerIndex: 0,
    remainingDeckCards: 40,
    players: [
      { playerId: 'p0', playerName: 'P0', cards: hand, melds: [], isCurrentPlayer: true, isDealer: true, hasEightBlocks: false, totalScore: 0, passedPlays: [], chiHistory: [] },
      { playerId: 'p1', playerName: 'P1', cards: [], melds: [], isCurrentPlayer: false, isDealer: false, hasEightBlocks: false, totalScore: 0, passedPlays: [], chiHistory: [] },
    ],
    discardPile: { cards: [], discardHistory: [] },
    tableMelds: [],
    isGameOver: false,
    availableActions: hand.map((card) => ({ type: 'discard' as const, cards: [card] })),
    pendingResponses: [],
  } as unknown as GameState;
}

describe('recommendation learned delta baseline', () => {
  beforeEach(() => {
    loadPolicyArtifact({ ...DEFAULT_POLICY_ARTIFACT, policyVersion: 'test-delta-v1' });
  });

  it('computes deltaFromBest on learned-mode recommendations', async () => {
    const analyzer = new AIAnalyzer();
    const state = buildDiscardState();

    const analysis = await analyzer.analyze(state, 0, {
      policyMode: 'learned',
      discardTopK: 5,
      chiOptionTopK: 3,
    });

    const recs = analysis.recommendations.filter((r) => r.action === 'discard');
    expect(recs.length).toBeGreaterThanOrEqual(2);

    // All learned recommendations should have policy fields
    for (const rec of recs) {
      expect(rec.policySource).toBe('learned');
      expect(rec.policyVersion).toBe('test-delta-v1');
      expect(typeof rec.policyScore).toBe('number');
      expect(rec.baselinePriority).toBeDefined();
      expect(rec.deltaFromBest).toBeDefined();
      expect(typeof rec.deltaFromBest?.winRate).toBe('number');
      expect(typeof rec.deltaFromBest?.expectedScore).toBe('number');
    }

    // The best recommendation should have deltaFromBest = {winRate: 0, expectedScore: 0}
    const sorted = [...recs].sort((a, b) => b.priority - a.priority);
    expect(sorted[0].deltaFromBest?.winRate).toBe(0);
    expect(sorted[0].deltaFromBest?.expectedScore).toBe(0);

    // Non-best should have negative or zero delta
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].deltaFromBest!.winRate).toBeLessThanOrEqual(0);
    }
  });
});
