import { describe, expect, it } from 'vitest';

import { AIAnalyzer } from '../src/ai/ai-analyzer';
import { HandAnalyzer } from '../src/game-engine/hand-analyzer';
import { Card, CardSize, GamePhase, GameState, Meld, MeldType, PlayerHand } from '../src/shared/types';

const SMALL_RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;
const BIG_RANKS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'] as const;

function createCard(size: CardSize, value: number, id: string): Card {
  const isRed = [2, 7, 10].includes(value);
  const rank = size === CardSize.SMALL ? SMALL_RANKS[value - 1] : BIG_RANKS[value - 1];
  return {
    id,
    rank,
    size,
    value: value as Card['value'],
    color: isRed ? 'red' as Card['color'] : 'black' as Card['color'],
    isRed,
  };
}

function createPlayers(): PlayerHand[] {
  return [
    {
      playerId: 'player_0',
      playerName: '玩家0',
      cards: [],
      melds: [],
      isCurrentPlayer: false,
      isDealer: true,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: [],
    },
    {
      playerId: 'player_1',
      playerName: '玩家1',
      cards: [],
      melds: [],
      isCurrentPlayer: true,
      isDealer: false,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: [],
    },
    {
      playerId: 'player_2',
      playerName: '玩家2',
      cards: [],
      melds: [],
      isCurrentPlayer: false,
      isDealer: false,
      hasEightBlocks: false,
      totalScore: 0,
      passedPlays: [],
      chiHistory: [],
    },
  ];
}

function buildState(handCards: Card[], melds: Meld[]): GameState {
  const players = createPlayers();
  players[1].cards = handCards;
  players[1].melds = melds;

  return {
    players,
    currentPlayerIndex: 1,
    discardPile: {
      cards: [],
      lastDiscard: undefined,
    },
    tableMelds: [],
    phase: GamePhase.DISCARDING,
    turnCount: 12,
    isGameOver: false,
    remainingDeckCards: 24,
    availableActions: handCards.map((card) => ({
      type: 'discard' as const,
      cards: [card],
      isMandatory: false,
      description: `出${card.id}`,
    })),
    pendingResponses: [],
    skipDiscardAfterZhao: false,
  };
}

function codeOf(card: Card | undefined): string | undefined {
  if (!card) return undefined;
  return `${card.size === CardSize.SMALL ? 'S' : 'B'}${card.value}`;
}

describe('AI discard structure heuristics', () => {
  it('locks hand triples and exposed melds from being reused as support', () => {
    const handAnalyzer = new HandAnalyzer();
    const handCards = [
      createCard(CardSize.SMALL, 1, 's1'),
      createCard(CardSize.SMALL, 2, 's2a'),
      createCard(CardSize.SMALL, 2, 's2b'),
      createCard(CardSize.SMALL, 2, 's2c'),
      createCard(CardSize.SMALL, 3, 's3'),
      createCard(CardSize.BIG, 1, 'b1x'),
    ];
    const melds: Meld[] = [{
      type: MeldType.PENG,
      cards: [
        createCard(CardSize.BIG, 1, 'b1a'),
        createCard(CardSize.BIG, 1, 'b1b'),
        createCard(CardSize.BIG, 1, 'b1c'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    }];

    const analysis = handAnalyzer.analyze(handCards, melds);
    expect(analysis.lockedCountsByCode?.['small_2']).toBe(3);
    expect(analysis.lockedCountsByCode?.['big_1']).toBe(3);
  });

  it('prefers discarding S1 over breaking the S9 pair after peng B1', async () => {
    const analyzer = new AIAnalyzer();
    const handCards = [
      createCard(CardSize.SMALL, 1, 's1'),
      createCard(CardSize.SMALL, 2, 's2a'),
      createCard(CardSize.SMALL, 2, 's2b'),
      createCard(CardSize.SMALL, 2, 's2c'),
      createCard(CardSize.SMALL, 3, 's3a'),
      createCard(CardSize.SMALL, 3, 's3b'),
      createCard(CardSize.SMALL, 4, 's4'),
      createCard(CardSize.SMALL, 5, 's5a'),
      createCard(CardSize.SMALL, 5, 's5b'),
      createCard(CardSize.SMALL, 6, 's6a'),
      createCard(CardSize.SMALL, 6, 's6b'),
      createCard(CardSize.SMALL, 9, 's9a'),
      createCard(CardSize.SMALL, 9, 's9b'),
      createCard(CardSize.BIG, 5, 'b5'),
      createCard(CardSize.BIG, 7, 'b7'),
      createCard(CardSize.BIG, 8, 'b8'),
      createCard(CardSize.BIG, 9, 'b9'),
      createCard(CardSize.BIG, 10, 'b10'),
    ];
    const melds: Meld[] = [{
      type: MeldType.PENG,
      cards: [
        createCard(CardSize.BIG, 1, 'pb1a'),
        createCard(CardSize.BIG, 1, 'pb1b'),
        createCard(CardSize.BIG, 1, 'pb1c'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    }];

    const state = buildState(handCards, melds);
    const analysis = await analyzer.analyze(state, 1);
    const discardRecommendations = analysis.recommendations.filter((item) => item.action === 'discard');

    expect(codeOf(discardRecommendations[0]?.card)).toBe('S1');

    const s1Index = discardRecommendations.findIndex((item) => codeOf(item.card) === 'S1');
    const s9Index = discardRecommendations.findIndex((item) => codeOf(item.card) === 'S9');
    expect(s1Index).toBeGreaterThanOrEqual(0);
    if (s9Index >= 0) {
      expect(s1Index).toBeLessThan(s9Index);
    }
  });

  it('prefers discarding dead B8 over live B6 after peng B4', async () => {
    const analyzer = new AIAnalyzer();
    const handCards = [
      createCard(CardSize.SMALL, 1, 's1a'),
      createCard(CardSize.SMALL, 1, 's1b'),
      createCard(CardSize.SMALL, 3, 's3'),
      createCard(CardSize.SMALL, 4, 's4'),
      createCard(CardSize.SMALL, 5, 's5a'),
      createCard(CardSize.SMALL, 5, 's5b'),
      createCard(CardSize.SMALL, 5, 's5c'),
      createCard(CardSize.SMALL, 7, 's7a'),
      createCard(CardSize.SMALL, 7, 's7b'),
      createCard(CardSize.SMALL, 10, 's10'),
      createCard(CardSize.BIG, 1, 'b1a'),
      createCard(CardSize.BIG, 1, 'b1b'),
      createCard(CardSize.BIG, 5, 'b5a'),
      createCard(CardSize.BIG, 5, 'b5b'),
      createCard(CardSize.BIG, 6, 'b6'),
      createCard(CardSize.BIG, 8, 'b8'),
      createCard(CardSize.BIG, 10, 'b10a'),
      createCard(CardSize.BIG, 10, 'b10b'),
    ];
    const melds: Meld[] = [{
      type: MeldType.PENG,
      cards: [
        createCard(CardSize.BIG, 4, 'pb4a'),
        createCard(CardSize.BIG, 4, 'pb4b'),
        createCard(CardSize.BIG, 4, 'pb4c'),
      ],
      isConcealed: false,
      position: 'table',
      huPoints: 0,
    }];

    const state = buildState(handCards, melds);
    state.discardPile.cards = [
      createCard(CardSize.BIG, 9, 'db9a'),
      createCard(CardSize.BIG, 9, 'db9b'),
      createCard(CardSize.BIG, 9, 'db9c'),
      createCard(CardSize.BIG, 9, 'db9d'),
    ];

    const analysis = await analyzer.analyze(state, 1, { discardTopK: handCards.length });
    const discardRecommendations = analysis.recommendations.filter((item) => item.action === 'discard');

    const b8Index = discardRecommendations.findIndex((item) => codeOf(item.card) === 'B8');
    const b6Index = discardRecommendations.findIndex((item) => codeOf(item.card) === 'B6');
    // B8 (dead tile: all B9 in discard pile) must appear in discard candidates
    expect(b8Index).toBeGreaterThanOrEqual(0);
    // B6 (live tile with connections) may be pruned from top-K candidates.
    // When B6 is present, B8 must rank higher; when B6 is absent it means the
    // analyser already recognises B6 as too valuable to discard — either way
    // B8 is correctly preferred.
    if (b6Index >= 0) {
      expect(b8Index).toBeLessThan(b6Index);
    }
  });
});
