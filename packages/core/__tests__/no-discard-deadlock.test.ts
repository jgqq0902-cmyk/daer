import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import { TurnManager } from '../src/game-engine/turn-manager';
import { CardSize, GamePhase, type GameState, type PlayerHand } from '../src/shared/types';

function card(id: string, value: number) {
  return {
    id,
    rank: String(value),
    value,
    size: CardSize.SMALL,
    color: 'black' as const,
    isRed: false,
    displayName: String(value),
  };
}

function player(playerId: string, cards: ReturnType<typeof card>[], current = false): PlayerHand {
  return {
    playerId,
    playerName: playerId,
    cards,
    melds: [],
    isCurrentPlayer: current,
    isDealer: false,
    hasEightBlocks: false,
    totalScore: 0,
    passedPlays: [],
    chiHistory: [],
  };
}

function stateWithNoDiscardAction(cards: ReturnType<typeof card>[]): GameState {
  return {
    players: [player('player_0', cards, true), player('player_1', []), player('player_2', [])],
    currentPlayerIndex: 0,
    discardPile: { cards: [], discardHistory: [] },
    tableMelds: [],
    phase: GamePhase.DISCARDING,
    turnCount: 4,
    isGameOver: false,
    remainingDeckCards: 8,
    availableActions: [],
    pendingResponses: [],
    skipDiscardAfterZhao: false,
  };
}

describe('discarding without a legal discard', () => {
  it('offers a mandatory pass instead of deadlocking or splitting a locked kan', () => {
    const lockedKan = [card('kan-1', 5), card('kan-2', 5), card('kan-3', 5)];
    const state = stateWithNoDiscardAction(lockedKan);
    const turnManager = new TurnManager();

    const actions = turnManager.getAvailableActions(state);

    expect(actions).toEqual([
      expect.objectContaining({ type: 'pass', isMandatory: true }),
    ]);
    expect(actions.some((action) => action.type === 'discard')).toBe(false);

    const advanced = new GameManager().processAction(state, {
      type: 'pass',
      playerId: 'player_0',
      cards: [],
      timestamp: Date.now(),
    });

    expect(advanced.phase).toBe(GamePhase.DRAWING);
    expect(advanced.currentPlayerIndex).not.toBe(state.currentPlayerIndex);
    expect(advanced.players[0].cards).toHaveLength(3);
    expect(advanced.players[0].cards.every((item) => item.id.startsWith('kan-'))).toBe(true);
  });

  it('also recovers when a response leaves the acting player with no hand cards', () => {
    const state = stateWithNoDiscardAction([]);
    const actions = new TurnManager().getAvailableActions(state);

    expect(actions).toEqual([
      expect.objectContaining({ type: 'pass', isMandatory: true }),
    ]);
  });
});
