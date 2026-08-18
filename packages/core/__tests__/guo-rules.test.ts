import { describe, expect, it } from 'vitest';
import { ActionHandlers } from '../src/game-engine/action-handlers';
import { GameManager } from '../src/game-engine/game-manager';
import { CardSize, GamePhase, MeldType, type Card, type GameState, type Meld } from '../src/shared/types';

function card(id: string, value: number, size: CardSize = CardSize.SMALL): Card {
  return {
    id,
    value,
    rank: id,
    size,
    color: 'black',
    isRed: [2, 7, 10].includes(value),
  } as Card;
}

function sequence(id: string, start: number, size: CardSize = CardSize.SMALL): Meld {
  return {
    type: MeldType.SEQUENCE,
    cards: [card(`${id}-1`, start, size), card(`${id}-2`, start + 1, size), card(`${id}-3`, start + 2, size)],
    isConcealed: false,
    position: 'table',
    huPoints: 0,
  };
}

function responseState(actionType: 'chi' | 'discard'): { manager: GameManager; state: GameState; target: Card } {
  const manager = new GameManager();
  const state = manager.createGame({ playerCount: 3, seed: 20260818 });
  const target = card('small-6', 6);
  const player = state.players[1];

  state.players[1] = {
    ...player,
    cards: [card('small-5', 5), card('small-7', 7)],
    melds: [
      sequence('meld-a', 1),
      sequence('meld-b', 2),
      sequence('meld-c', 3),
      sequence('meld-d', 4),
      sequence('meld-e', 7),
      sequence('meld-f', 8, CardSize.BIG),
    ],
    passedPlays: [{ card: target, timestamp: 1, actionType }],
  };
  state.currentPlayerIndex = 1;
  state.phase = GamePhase.RESPONSE_COLLECTING;
  state.pendingCardSource = 'discard';
  state.pendingResponses = [];
  state.responseWindow = undefined;
  state.discardPile = {
    cards: [target],
    lastDiscard: target,
    lastDiscardPlayerIndex: 2,
    discardHistory: [{ card: target, playerIndex: 2, source: 'discard' }],
  };

  return { manager, state, target };
}

describe('GUO-01～GUO-07 过张统一约束', () => {
  it('GUO-001 records an active discard and blocks the same card from chi', () => {
    const manager = new GameManager();
    const state = manager.createGame({ playerCount: 3, seed: 20260818 });
    const target = card('discard-small-6', 6);

    state.currentPlayerIndex = 2;
    state.phase = GamePhase.DISCARDING;
    state.players[2].cards = [target, card('small-1', 1), card('small-2', 2)];
    const afterDiscard = manager.processAction(state, {
      type: 'discard',
      playerId: state.players[2].playerId,
      cards: [target],
      timestamp: 1,
    });

    expect(afterDiscard.players[2].passedPlays).toEqual([
      expect.objectContaining({ actionType: 'discard', card: expect.objectContaining({ value: 6, size: CardSize.SMALL }) }),
    ]);
  });

  it('GUO-002 blocks hu after the player actively discarded the same card identity', () => {
    const { manager, state } = responseState('discard');
    const actions = manager.updateAvailableActions(state).availableActions;

    expect(actions.some((action) => action.type === 'hu')).toBe(false);
  });

  it('GUO-003 records a pass only for a real chi opportunity', () => {
    const handlers = new ActionHandlers();
    const { state } = responseState('chi');
    state.players[1].passedPlays = [];

    const next = handlers.handlePass(state, state.players[1].playerId, 'chi');

    expect(next.players[1].passedPlays).toHaveLength(1);
    expect(next.players[1].passedPlays[0].actionType).toBe('chi');
  });

  it('GUO-004 blocks hu after voluntarily passing a legal chi opportunity', () => {
    const { manager, state } = responseState('chi');
    const actions = manager.updateAvailableActions(state).availableActions;

    expect(actions.some((action) => action.type === 'hu')).toBe(false);
  });

  it('GUO-005 does not record a pass when the player has no legal chi', () => {
    const handlers = new ActionHandlers();
    const { state } = responseState('chi');
    state.players[1].cards = [card('small-1-only', 1)];
    state.players[1].passedPlays = [];

    const next = handlers.handlePass(state, state.players[1].playerId, 'chi');

    expect(next.players[1].passedPlays).toHaveLength(0);
  });

  it('GUO-006 keeps big and small card identities independent', () => {
    const { manager, state } = responseState('discard');
    state.players[1].cards = [card('big-5-in-hand', 5, CardSize.BIG), card('big-7-in-hand', 7, CardSize.BIG)];
    state.players[1].passedPlays = [{ card: card('small-6-passed', 6), timestamp: 1, actionType: 'discard' }];
    state.discardPile.lastDiscard = card('big-6-active', 6, CardSize.BIG);
    state.discardPile.cards = [state.discardPile.lastDiscard];

    const actions = manager.updateAvailableActions(state).availableActions;

    expect(actions.some((action) => action.type === 'hu')).toBe(true);
  });

  it('GUO-007 rejects a direct hu request for a passed card without changing state', () => {
    const { manager, state } = responseState('chi');
    state.availableActions = manager.updateAvailableActions(state).availableActions;
    const before = JSON.stringify(state);

    const next = manager.processAction(state, {
      type: 'hu',
      playerId: state.players[1].playerId,
      cards: [],
      timestamp: 1,
    });

    expect(next.isGameOver).toBe(false);
    expect(JSON.stringify(next)).toBe(before);
  });
});
