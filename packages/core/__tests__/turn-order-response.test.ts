import { describe, expect, it } from 'vitest';
import { ActionHandlers } from '../src/game-engine/action-handlers';
import { GameManager } from '../src/game-engine/game-manager';
import { ResponseArbitrator } from '../src/game-engine/response-arbitrator';
import { TurnManager } from '../src/game-engine/turn-manager';
import {
  Card,
  CardSize,
  GamePhase,
  GameState,
  MeldType,
  PlayerHand,
} from '../src/shared/types';

function createCard(id: string, value: number, size: CardSize): Card {
  return {
    id,
    rank: String(value) as any,
    value: value as any,
    size,
    color: [2, 7, 10].includes(value) ? 'red' : 'black',
    isRed: [2, 7, 10].includes(value),
    displayName: String(value),
  } as Card;
}

function createPlayer(index: number): PlayerHand {
  return {
    playerId: `player_${index}`,
    playerName: `玩家${index}`,
    cards: [],
    melds: [],
    isCurrentPlayer: index === 0,
    isDealer: index === 0,
    hasEightBlocks: false,
    totalScore: 0,
    passedPlays: [],
    chiHistory: [],
  };
}

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [createPlayer(0), createPlayer(1), createPlayer(2)],
    currentPlayerIndex: 0,
    discardPile: { cards: [], lastDiscard: undefined },
    tableMelds: [],
    phase: GamePhase.DISCARDING,
    turnCount: 0,
    isGameOver: false,
    remainingDeckCards: 20,
    availableActions: [],
    pendingResponses: [],
    ...overrides,
  };
}

describe('三人逆时针牌序和响应来源', () => {
  it('uses player order 0 -> 2 -> 1 -> 0', () => {
    const turnManager = new TurnManager();

    const afterZero = turnManager.endTurn(createState({ currentPlayerIndex: 0 }));
    const afterTwo = turnManager.endTurn(createState({ currentPlayerIndex: 2 }));
    const afterOne = turnManager.endTurn(createState({ currentPlayerIndex: 1 }));

    expect(afterZero.currentPlayerIndex).toBe(2);
    expect(afterTwo.currentPlayerIndex).toBe(1);
    expect(afterOne.currentPlayerIndex).toBe(0);
  });

  it('allows only player 2 to chi player 0 discard', () => {
    const target = createCard('discard-small-6', 6, CardSize.SMALL);
    const state = createState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [target],
        lastDiscard: target,
        lastDiscardPlayerIndex: 0,
      },
    });
    state.players[1].cards = [
      createCard('p1-small-5', 5, CardSize.SMALL),
      createCard('p1-small-7', 7, CardSize.SMALL),
    ];
    state.players[2].cards = [
      createCard('p2-small-5', 5, CardSize.SMALL),
      createCard('p2-small-7', 7, CardSize.SMALL),
    ];

    const actionHandlers = new ActionHandlers();

    expect(actionHandlers.canPlayerChi(state, 1, target).canChi).toBe(false);
    expect(actionHandlers.canPlayerChi(state, 2, target).canChi).toBe(true);
  });

  it('uses the same previous-seat rule in the response helper', () => {
    const target = createCard('helper-small-6', 6, CardSize.SMALL);
    const state = createState({
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [target],
        lastDiscard: target,
        lastDiscardPlayerIndex: 0,
      },
    });
    state.players[1].cards = [
      createCard('helper-p1-small-5', 5, CardSize.SMALL),
      createCard('helper-p1-small-7', 7, CardSize.SMALL),
    ];
    state.players[2].cards = [
      createCard('helper-p2-small-5', 5, CardSize.SMALL),
      createCard('helper-p2-small-7', 7, CardSize.SMALL),
    ];

    const responseArbitrator = new ResponseArbitrator();

    expect(responseArbitrator.getAvailableResponses(state, 1)).not.toContain('chi');
    expect(responseArbitrator.getAvailableResponses(state, 2)).toContain('chi');
  });

  it('does not offer lower-priority chi after player 2 has already submitted hu', () => {
    const target = createCard('discard-big-6-after-hu', 6, CardSize.BIG);
    const state = createState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'discard',
      discardPile: {
        cards: [target],
        lastDiscard: target,
        lastDiscardPlayerIndex: 1,
      },
      pendingResponses: [{
        playerIndex: 2,
        responseType: 'hu',
        cards: [],
        timestamp: 1,
      }],
      responseWindow: {
        id: 'hu-before-chi',
        source: 'discard',
        sourcePlayerIndex: 1,
        activeCard: target,
        responderOrder: [0, 2],
        responses: [{
          playerIndex: 2,
          responseType: 'hu',
          cards: [],
          timestamp: 1,
        }],
        openedAt: 1,
        currentResponderIndex: 0,
      },
    });
    state.players[0].cards = [
      createCard('p0-big-4-after-hu', 4, CardSize.BIG),
      createCard('p0-big-5-after-hu', 5, CardSize.BIG),
    ];

    const available = new TurnManager().getAvailableActions(state);

    expect(available.some((action) => action.type === 'chi')).toBe(false);
    expect(available.some((action) => action.type === 'pass')).toBe(true);
  });

  it('does not let player 1 chi player 0 flip after player 0 passes', () => {
    const target = createCard('draw-small-6', 6, CardSize.SMALL);
    const state = createState({
      currentPlayerIndex: 0,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingCardSource: 'draw',
      discardPile: {
        cards: [],
        lastDiscard: target,
        lastDiscardPlayerIndex: 0,
      },
    });
    state.players[0].passedPlays = [{
      card: target,
      timestamp: Date.now(),
      actionType: 'chi',
    }];
    state.players[1].cards = [
      createCard('p1-small-5', 5, CardSize.SMALL),
      createCard('p1-small-7', 7, CardSize.SMALL),
    ];
    state.players[2].cards = [
      createCard('p2-small-5', 5, CardSize.SMALL),
      createCard('p2-small-7', 7, CardSize.SMALL),
    ];

    const actionHandlers = new ActionHandlers();

    expect(actionHandlers.canPlayerChi(state, 1, target).canChi).toBe(false);
    expect(actionHandlers.canPlayerChi(state, 2, target).canChi).toBe(true);
  });

  it('automatically completes a mandatory peng instead of waiting for input', () => {
    const discard = createCard('discard-big-6', 6, CardSize.BIG);
    const state = createState({
      phase: GamePhase.DISCARDING,
      currentPlayerIndex: 0,
    });
    state.players[0].cards = [discard];
    state.players[1].cards = [];
    state.players[2].cards = [
      createCard('p2-big-6-a', 6, CardSize.BIG),
      createCard('p2-big-6-b', 6, CardSize.BIG),
    ];

    const next = new GameManager().processAction(state, {
      type: 'discard',
      playerId: 'player_0',
      cards: [discard],
      timestamp: Date.now(),
    });

    expect(next.phase).toBe(GamePhase.DISCARDING);
    expect(next.currentPlayerIndex).toBe(2);
    expect(next.responseWindow).toBeUndefined();
    expect(next.players[2].melds.some((meld) => meld.type === MeldType.PENG)).toBe(true);
  });
});
