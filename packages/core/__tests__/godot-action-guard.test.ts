import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import { isLegalGodotAction, normalizeGodotAction } from '../src/bridge/godot-action-guard';
import type { PlayerAction } from '../src/shared/types';

describe('Godot Bridge action guard', () => {
  it('rejects an unknown discard without allowing the Bridge to advance the game', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const action: PlayerAction = {
      type: 'discard',
      playerId: state.players[state.currentPlayerIndex].playerId,
      cards: [{ ...state.players[0].cards[0], id: 'not-in-current-hand' }],
      timestamp: Date.now(),
    };

    expect(isLegalGodotAction(state, action)).toBe(false);
  });

  it('rejects a legal-looking action submitted for a non-current player', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const offered = state.availableActions.find(action => action.type === 'discard')!;
    const action: PlayerAction = {
      type: 'discard',
      playerId: state.players[(state.currentPlayerIndex + 1) % state.players.length].playerId,
      cards: offered.cards,
      timestamp: Date.now(),
    };

    expect(isLegalGodotAction(state, action)).toBe(false);
  });

  it('accepts a discard returned by the current core snapshot', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const offered = state.availableActions.find(action => action.type === 'discard')!;
    const action: PlayerAction = {
      type: 'discard',
      playerId: state.players[state.currentPlayerIndex].playerId,
      cards: offered.cards,
      timestamp: Date.now(),
    };

    expect(isLegalGodotAction(state, action)).toBe(true);
  });

  it('accepts and normalizes a later discard candidate with the same action type', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const discards = state.availableActions.filter(action => action.type === 'discard');
    const laterDiscard = discards[1]!;
    const forgedCard = { ...laterDiscard.cards[0], value: 10, rank: '拾' };
    const action: PlayerAction = {
      type: 'discard',
      playerId: state.players[state.currentPlayerIndex].playerId,
      cards: [forgedCard],
      timestamp: Date.now(),
    };

    expect(discards.length).toBeGreaterThan(1);
    expect(isLegalGodotAction(state, action)).toBe(true);
    expect(normalizeGodotAction(state, action)?.cards).toEqual(laterDiscard.cards);
  });

  it('requires an explicit current chi option ID', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const selectedCards = [state.players[0].cards[0], state.players[0].cards[1]];
    state.availableActions = [{
      type: 'chi',
      cards: selectedCards,
      chiOptions: [{
        id: 'chi-current-option',
        mainMeldCards: selectedCards,
        selectedCards,
        additionalMelds: [],
        remainingCards: [],
        description: 'test chi option',
      }],
      isMandatory: false,
      description: '吃牌',
    }];
    const base = {
      type: 'chi' as const,
      playerId: state.players[state.currentPlayerIndex].playerId,
      cards: selectedCards,
      timestamp: Date.now(),
    };

    expect(isLegalGodotAction(state, base)).toBe(false);
    expect(isLegalGodotAction(state, { ...base, chiOptionId: 'chi-current-option' })).toBe(true);
    expect(isLegalGodotAction(state, { ...base, chiOptionId: 'stale-option' })).toBe(false);
    const normalized = normalizeGodotAction(state, { ...base, chiOptionId: 'chi-current-option' });
    expect(normalized?.cards).toBe(selectedCards);
    expect(normalizeGodotAction(state, base)).toBeNull();
  });

  it('uses the current core cards for non-option actions', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const targetCard = state.players[0].cards[0];
    const forgedCard = { ...targetCard, value: 10, name: '伪造牌面' };
    state.availableActions = [{
      type: 'peng',
      cards: [targetCard],
      isMandatory: false,
      description: '碰牌',
    }];
    const action: PlayerAction = {
      type: 'peng',
      playerId: state.players[state.currentPlayerIndex].playerId,
      cards: [forgedCard],
      timestamp: Date.now(),
    };

    expect(normalizeGodotAction(state, action)?.cards).toEqual([targetCard]);
  });

  it('rejects a bao candidate whose selected card is not the offered card', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const offeredCard = state.players[0].cards[0];
    const staleCard = state.players[0].cards[1];
    state.availableActions = [{
      type: 'bao',
      cards: [offeredCard],
      isMandatory: false,
      description: '爆牌',
    }];
    const action: PlayerAction = {
      type: 'bao',
      playerId: state.players[state.currentPlayerIndex].playerId,
      cards: [staleCard],
      timestamp: Date.now(),
    };

    expect(isLegalGodotAction(state, action)).toBe(false);
    expect(normalizeGodotAction(state, action)).toBeNull();
  });

  it('accepts and normalizes the selected bao candidate when several bao actions are offered', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const firstCard = state.players[0].cards[0];
    const selectedCard = state.players[0].cards[1];
    state.availableActions = [
      {
        type: 'bao',
        cards: [firstCard],
        isMandatory: false,
        description: '爆牌',
      },
      {
        type: 'bao',
        cards: [selectedCard],
        isMandatory: false,
        description: '爆牌',
      },
    ];
    const action: PlayerAction = {
      type: 'bao',
      playerId: state.players[state.currentPlayerIndex].playerId,
      cards: [selectedCard],
      timestamp: Date.now(),
    };

    expect(isLegalGodotAction(state, action)).toBe(true);
    expect(normalizeGodotAction(state, action)?.cards).toEqual([selectedCard]);
  });

  it('drops client-supplied cards for pass actions', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    state.availableActions = [{
      type: 'pass',
      cards: [],
      isMandatory: false,
      description: '过牌',
    }];
    const action: PlayerAction = {
      type: 'pass',
      playerId: state.players[state.currentPlayerIndex].playerId,
      cards: [state.players[0].cards[0]],
      timestamp: Date.now(),
    };

    expect(normalizeGodotAction(state, action)?.cards).toEqual([]);
  });
});
