import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import { TimeoutHandler } from '../src/game-engine/timeout-handler';
import { GamePhase, type Card, type GameState } from '../src/shared/types';

function card(id: string, rank: number, size: 'small' | 'big'): Card {
  return {
    id,
    value: rank,
    rank,
    size,
    color: 'black',
    isRed: rank === 2 || rank === 7 || rank === 10,
  } as Card;
}

function responseFixture(sourceIndex = 2): { manager: GameManager; state: GameState } {
  const manager = new GameManager();
  const state = manager.createGame({ playerCount: 3, seed: 20260815 });
  state.isGameOver = false;
  state.phase = GamePhase.DISCARDING;
  state.currentPlayerIndex = sourceIndex;
  state.pendingResponses = [];
  state.pendingCardSource = undefined;
  state.responseWindow = undefined;
  state.discardPile = { cards: [], discardHistory: [] };
  state.players = state.players.map((player, index) => ({
    ...player,
    cards: [card(`noise_${index}`, index + 1, 'small')],
    melds: [],
    passedPlays: [],
    chiHistory: [],
    isBao: false,
  }));
  return { manager, state };
}

function discard(manager: GameManager, state: GameState, activeCard: Card): GameState {
  state.players[state.currentPlayerIndex].cards.push(activeCard);
  return manager.processAction(state, {
    type: 'discard',
    playerId: state.players[state.currentPlayerIndex].playerId,
    cards: [activeCard],
    timestamp: Date.now(),
  });
}

describe('core-managed response window', () => {
  it('does not ask the discarder to pass after playing small 6', () => {
    const { manager, state } = responseFixture(0);
    const next = discard(manager, state, card('small_6', 6, 'small'));

    expect(next.responseWindow).toBeUndefined();
		expect(next.phase).toBe(GamePhase.DRAWING);
		expect(next.currentPlayerIndex).toBe(2);
		expect(next.availableActions.map(action => action.type)).toContain('draw');
		expect(next.discardPile.discardHistory?.at(-1)?.source).toBe('discard');
  });

  it('automatically completes mandatory peng on an opponent big 9', () => {
    const { manager, state } = responseFixture(2);
    state.players[0].cards = [card('human_big_9_a', 9, 'big'), card('human_big_9_b', 9, 'big')];

    const waiting = discard(manager, state, card('opponent_big_9', 9, 'big'));

    expect(waiting.responseWindow).toBeUndefined();
    expect(waiting.currentPlayerIndex).toBe(0);
    expect(waiting.phase).toBe(GamePhase.DISCARDING);
    expect(waiting.players[0].melds.at(-1)?.type).toBe('peng');
  });

  it('automatically resolves a mandatory zhao before a lower-priority peng', () => {
    const { manager, state } = responseFixture(2);
    state.players[0].cards = [card('p0_big_9_a', 9, 'big'), card('p0_big_9_b', 9, 'big')];
    state.players[1].cards = [
      card('p1_big_9_a', 9, 'big'),
      card('p1_big_9_b', 9, 'big'),
      card('p1_big_9_c', 9, 'big'),
    ];
    const resolved = discard(manager, state, card('source_big_9', 9, 'big'));
    expect(resolved.responseWindow).toBeUndefined();
    expect(resolved.phase).toBe(GamePhase.DISCARDING);
    expect(resolved.currentPlayerIndex).toBe(1);
    expect(resolved.players[1].melds.at(-1)?.type).toBe('draw_quadruple');
    expect(resolved.players[0].melds).toHaveLength(0);
  });

  it('does not expose the flip owner\'s chi before a later player\'s mandatory peng', () => {
    const { manager, state } = responseFixture(0);
    const flipped = card('flip-small-6', 6, 'small');
    state.phase = GamePhase.DRAWING;
    state.players[0].cards = [
      card('p0-small-5', 5, 'small'),
      card('p0-small-7', 7, 'small'),
    ];
    state.players[2].cards = [
      card('p2-small-6-a', 6, 'small'),
      card('p2-small-6-b', 6, 'small'),
    ];
    manager.setRemainingDeckSnapshot([flipped]);

    const drawing = manager.updateAvailableActions(state);
    const resolved = manager.processAction(drawing, {
      type: 'draw',
      playerId: drawing.players[0].playerId,
      cards: [],
      timestamp: Date.now(),
    });

    expect(resolved.responseWindow).toBeUndefined();
    expect(resolved.players[0].melds).toHaveLength(0);
    expect(resolved.players[2].melds.at(-1)?.type).toBe('peng');
  });

  it('does not expose the flip owner\'s chi before a later player\'s mandatory zhao', () => {
    const { manager, state } = responseFixture(0);
    const flipped = card('flip-small-6-zhao', 6, 'small');
    state.phase = GamePhase.DRAWING;
    state.players[0].cards = [
      card('p0-small-5-zhao', 5, 'small'),
      card('p0-small-7-zhao', 7, 'small'),
    ];
    state.players[2].cards = [
      card('p2-small-6-zhao-a', 6, 'small'),
      card('p2-small-6-zhao-b', 6, 'small'),
      card('p2-small-6-zhao-c', 6, 'small'),
    ];
    manager.setRemainingDeckSnapshot([flipped]);

    const drawing = manager.updateAvailableActions(state);
    const resolved = manager.processAction(drawing, {
      type: 'draw',
      playerId: drawing.players[0].playerId,
      cards: [],
      timestamp: Date.now(),
    });

    expect(resolved.responseWindow).toBeUndefined();
    expect(resolved.players[0].melds).toHaveLength(0);
    expect(resolved.players[2].melds.at(-1)?.type).toBe('draw_quadruple');
  });

  it('lets the flip owner answer their own active card without changing turn ownership', () => {
    const { manager, state } = responseFixture(0);
    state.phase = GamePhase.DRAWING;
    state.players[0].cards = [
      card('self_big_9_a', 9, 'big'),
      card('self_big_9_b', 9, 'big'),
      card('self_big_9_c', 9, 'big'),
    ];
    manager.setRemainingDeckSnapshot([card('flipped_big_9', 9, 'big')]);
    const drawing = manager.updateAvailableActions(state);

    const waiting = manager.processAction(drawing, {
      type: 'draw',
      playerId: drawing.players[0].playerId,
      cards: [],
      timestamp: Date.now(),
    });
    expect(waiting.currentPlayerIndex).toBe(0);
    expect(waiting.responseWindow).toBeUndefined();
    expect(waiting.phase).toBe(GamePhase.DISCARDING);
    expect(waiting.players[0].melds.at(-1)?.type).toBe('draw_quadruple');
  });

  it('records an unclaimed flip as draw-origin history instead of a discard', () => {
    const { manager, state } = responseFixture(0);
    const flipped = card('unclaimed_flip_big_9', 9, 'big');
    manager.setRemainingDeckSnapshot([card('spare_small_1', 1, 'small'), flipped]);
    const drawing = manager.updateAvailableActions({
      ...state,
      phase: GamePhase.DRAWING,
    });

    const resolved = manager.processAction(drawing, {
      type: 'draw',
      playerId: drawing.players[0].playerId,
      cards: [],
      timestamp: Date.now(),
    });

    const historyEntry = resolved.discardPile.discardHistory?.find(
      (entry) => entry.card.id === flipped.id,
    );
    expect(historyEntry?.source).toBe('draw');
    expect(resolved.phase).toBe(GamePhase.DRAWING);
    expect(resolved.currentPlayerIndex).toBe(2);
  });

  it('legacy timeout compatibility follows the formal window and checks only its responder', () => {
    const { state } = responseFixture(2);
    const target = card('timeout-target', 9, 'small');
    state.phase = GamePhase.RESPONSE_COLLECTING;
    state.currentPlayerIndex = 1;
    state.pendingCardSource = 'discard';
    state.discardPile = {
      cards: [target],
      lastDiscard: target,
      lastDiscardPlayerIndex: 2,
      discardHistory: [],
    };
    state.responseWindow = {
      id: 'timeout-window',
      source: 'discard',
      sourcePlayerIndex: 2,
      activeCard: target,
      responderOrder: [1, 0],
      currentResponderIndex: 1,
      responses: [],
      openedAt: 0,
      deadlineAt: 100,
      timeoutAction: 'timeout_pass',
    };

    const result = new TimeoutHandler().checkTimeout(
      state,
      { ...state.ruleProfile!, seed: 20260818 },
      0,
      100,
    );

    expect(result.timeoutPlayers).toEqual([1]);
    expect(result.autoResponses).toHaveLength(1);
    expect(result.autoResponses[0].responseType).toBe('pass');
  });
});
