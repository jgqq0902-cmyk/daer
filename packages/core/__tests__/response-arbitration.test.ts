import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import { CardSize, GamePhase, MeldType, type Card, type GameState, type Meld } from '../src/shared/types';

function card(id: string, value: number, size: CardSize = CardSize.SMALL): Card {
  return {
    id,
    rank: `${size}-${value}` as Card['rank'],
    size,
    value,
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

function triple(id: string, value = 2, size: CardSize = CardSize.SMALL): Meld {
  return {
    type: MeldType.TRIPLE,
    cards: [card(`${id}-1`, value, size), card(`${id}-2`, value, size), card(`${id}-3`, value, size)],
    isConcealed: false,
    position: 'table',
    huPoints: 0,
  };
}

function sixMelds(): Meld[] {
  return [
    triple('m1'),
    triple('m2'),
    triple('m3'),
    triple('m4'),
    triple('m5'),
    triple('m6'),
  ];
}

function responseFixture(sourceIndex = 2, clock: () => number = () => 1000): { manager: GameManager; state: GameState; target: Card } {
  const manager = new GameManager(clock);
  const state = manager.createGame({ playerCount: 3, seed: 20260818 });
  const target = card('active-small-6', 6);

  state.phase = GamePhase.DISCARDING;
  state.currentPlayerIndex = sourceIndex;
  state.pendingResponses = [];
  state.pendingCardSource = undefined;
  state.responseWindow = undefined;
  state.discardPile = { cards: [], discardHistory: [] };
  state.players = state.players.map((player) => ({
    ...player,
    cards: [],
    melds: [],
    passedPlays: [],
    chiHistory: [],
    isBao: false,
  }));
  state.players[sourceIndex].cards = [target, card('source-noise', 1)];
  return { manager, state, target };
}

function startResponse(manager: GameManager, state: GameState, target: Card): GameState {
  state.players[state.currentPlayerIndex].cards = [target, card('source-noise', 1)];
  const ready = manager.updateAvailableActions(state);
  return manager.processAction(ready, {
    type: 'discard',
    playerId: state.players[state.currentPlayerIndex].playerId,
    cards: [target],
    timestamp: 1,
  });
}

describe('响应窗口两层仲裁与系统超时', () => {
  it('RESP-001 keeps hu and mandatory peng for the same responder', () => {
    const { manager, state, target } = responseFixture();
    state.players[1].cards = [card('p1-target-a', 6), card('p1-target-b', 6)];
    state.players[1].melds = sixMelds();

    const waiting = startResponse(manager, state, target);

    expect(waiting.responseWindow?.currentResponderIndex).toBe(1);
    expect(waiting.availableActions.map((action) => action.type)).toEqual(['hu', 'peng']);
    expect(waiting.availableActions.find((action) => action.type === 'peng')?.isMandatory).toBe(true);
  });

  it('RESP-002 keeps hu and mandatory zhao for the same responder', () => {
    const { manager, state, target } = responseFixture();
    state.players[1].cards = [
      card('p1-target-a', 6),
      card('p1-target-b', 6),
      card('p1-target-c', 6),
      card('p1-small-5-for-hu', 5),
      card('p1-small-7-for-hu', 7),
    ];
    state.players[1].melds = sixMelds().slice(0, 5);

    const waiting = startResponse(manager, state, target);

    expect(waiting.availableActions.map((action) => action.type)).toEqual(['hu', 'zhao']);
    expect(waiting.availableActions.find((action) => action.type === 'zhao')?.isMandatory).toBe(true);
  });

  it('RESP-003 auto-resolves a responder with only mandatory peng', () => {
    const { manager, state, target } = responseFixture();
    state.players[1].cards = [card('p1-target-a', 6), card('p1-target-b', 6)];

    const resolved = startResponse(manager, state, target);

    expect(resolved.responseWindow).toBeUndefined();
    expect(resolved.players[1].melds.at(-1)?.type).toBe(MeldType.PENG);
  });

  it('RESP-004 exposes chi plus pass and selects timeout_pass', () => {
    const { manager, state, target } = responseFixture();
    state.players[1].cards = [card('p1-small-5', 5), card('p1-small-7', 7)];

    const waiting = startResponse(manager, state, target);

    expect(waiting.availableActions.map((action) => action.type)).toEqual(['chi', 'pass']);
    expect(waiting.responseWindow?.timeoutAction).toBe('timeout_pass');
  });

  it('RESP-005 selects the higher-priority hu responder across players', () => {
    const { manager, state, target } = responseFixture();
    state.players[1].cards = [card('p1-small-5', 5), card('p1-small-7', 7)];
    state.players[0].cards = [card('p0-target-a', 6), card('p0-target-b', 6)];
    state.players[0].melds = sixMelds();

    const waiting = startResponse(manager, state, target);

    expect(waiting.responseWindow?.currentResponderIndex).toBe(0);
    expect(waiting.availableActions.some((action) => action.type === 'hu')).toBe(true);
  });

  it('RESP-006 rejects an old-window timeout without changing state', () => {
    const { manager, state, target } = responseFixture();
    state.players[1].cards = [card('p1-small-5', 5), card('p1-small-7', 7)];
    const waiting = startResponse(manager, state, target);
    const before = JSON.stringify(waiting);

    const rejected = manager.processAction(waiting, {
      type: 'timeout_pass',
      playerId: waiting.players[1].playerId,
      cards: [],
      timestamp: 2,
      responseWindowId: 'old-window-id',
      isSystem: true,
    });

    expect(JSON.stringify(rejected)).toBe(before);
  });

  it('RESP-007 records timeout_peng and resolves the forced fallback', () => {
    let now = 1000;
    const { manager, state, target } = responseFixture(2, () => now);
    state.players[1].cards = [card('p1-target-a', 6), card('p1-target-b', 6)];
    state.players[1].melds = sixMelds();
    const waiting = startResponse(manager, state, target);

    expect(waiting.responseWindow?.timeoutAction).toBe('timeout_peng');
    now = waiting.responseWindow!.deadlineAt;
    const resolved = manager.processAction(waiting, {
      type: 'timeout_peng',
      playerId: waiting.players[1].playerId,
      cards: [],
      timestamp: now,
      responseWindowId: waiting.responseWindow!.id,
      isSystem: true,
    });

    expect(resolved.responseWindow).toBeUndefined();
    expect(resolved.players[1].melds.at(-1)?.type).toBe(MeldType.PENG);
  });

  it('RESP-008 fixed-clock response opening is deterministic', () => {
    const first = responseFixture(2, () => 1000);
    first.state.players[1].cards = [card('p1-small-5', 5), card('p1-small-7', 7)];
    const firstWaiting = startResponse(first.manager, first.state, first.target);

    const second = responseFixture(2, () => 1000);
    second.state.players[1].cards = [card('p1-small-5', 5), card('p1-small-7', 7)];
    const secondWaiting = startResponse(second.manager, second.state, second.target);

    expect(JSON.stringify({
      responseWindow: firstWaiting.responseWindow,
      availableActions: firstWaiting.availableActions,
    })).toBe(JSON.stringify({
      responseWindow: secondWaiting.responseWindow,
      availableActions: secondWaiting.availableActions,
    }));
  });
});
