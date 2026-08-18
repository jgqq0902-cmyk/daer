import { describe, expect, it } from 'vitest';
import { AIPlayerAgent } from '../src/ai/ai-player-agent';
import type { AvailableAction, Card, ChiOption, GameState } from '../src/shared/types';

function card(id: string, value: 3 | 4): Card {
  return {
    id,
    rank: value === 3 ? '三' : '四',
    size: 'small',
    color: 'black',
    value,
    isRed: false,
  };
}

function chiOption(id: string, selectedCards: Card[]): ChiOption {
  return {
    id,
    mainMeldCards: selectedCards,
    selectedCards,
    additionalMelds: [],
    remainingCards: [],
    description: id,
  };
}

const SMALL_RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;
const BIG_RANKS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'] as const;

function numericCard(id: string, value: Card['value'], size: 'small' | 'big' = 'small'): Card {
  const ranks = size === 'small' ? SMALL_RANKS : BIG_RANKS;
  const isRed = [2, 7, 10].includes(value);
  return {
    id,
    rank: ranks[value - 1],
    size,
    color: isRed ? 'red' : 'black',
    value,
    isRed,
  };
}

function fastDiscardState(handCards: Card[]): GameState {
  return {
    phase: 'discarding',
    players: [
      { playerId: 'player_0', cards: [], melds: [] },
      { playerId: 'player_1', cards: handCards, melds: [] },
    ],
    availableActions: handCards.map((handCard) => ({
      type: 'discard' as const,
      cards: [handCard],
      isMandatory: false,
      description: `出${handCard.rank}`,
    })),
  } as unknown as GameState;
}

describe('AIPlayerAgent response actions', () => {
  it('binds a default chi option when one available action has multiple chi options', async () => {
    const first = card('small-3-a', 3);
    const second = card('small-3-b', 3);
    const firstOption = chiOption('chi-option-a', [first, second]);
    const secondOption = chiOption('chi-option-b', [first, second]);
    const chi: AvailableAction = {
      type: 'chi',
      cards: [first, second],
      chiOptions: [firstOption, secondOption],
      isMandatory: false,
      description: '吃牌',
    };
    const pass: AvailableAction = {
      type: 'pass',
      cards: [],
      isMandatory: false,
      description: '过',
    };
    const state = {
      phase: 'response_collecting',
      players: [{ playerId: 'player_2' }],
      availableActions: [chi, pass],
    } as unknown as GameState;

    const action = await new AIPlayerAgent('player_2', { mode: 'fast' }).decide(state);

    expect(action.type).toBe('chi');
    expect(action.chiOptionId).toBe(firstOption.id);
    expect(action.cards).toEqual(firstOption.selectedCards);
  });
});

describe('AIPlayerAgent fast discard protection', () => {
  it('protects an intact same-size 2710 from fast discard scoring', async () => {
    const handCards = [
      numericCard('s2', 2),
      numericCard('s7', 7),
      numericCard('s10', 10),
      numericCard('s3', 3),
      numericCard('s4', 4),
      numericCard('s5', 5),
    ];

    const action = await new AIPlayerAgent('player_1', { mode: 'fast' }).decide(fastDiscardState(handCards));

    expect(action.type).toBe('discard');
    expect([2, 7, 10]).not.toContain(action.cards[0]?.value);
    expect(action.cards[0]?.value).toBe(5);
  });

  it('discards a redundant 2710 duplicate while preserving the complete set', async () => {
    const handCards = [
      numericCard('s2-a', 2),
      numericCard('s2-b', 2),
      numericCard('s7', 7),
      numericCard('s10', 10),
    ];

    const action = await new AIPlayerAgent('player_1', { mode: 'fast' }).decide(fastDiscardState(handCards));

    expect(action.type).toBe('discard');
    expect(['s2-a', 's2-b']).toContain(action.cards[0]?.id);
  });

  it('treats same-size 2710 pairs as adjacent fast-discard support', async () => {
    const handCards = [
      numericCard('s1', 1),
      numericCard('s2', 2),
      numericCard('s7', 7),
    ];

    const action = await new AIPlayerAgent('player_1', { mode: 'fast' }).decide(fastDiscardState(handCards));

    expect(action.type).toBe('discard');
    expect(action.cards[0]?.value).toBe(1);
  });
});
