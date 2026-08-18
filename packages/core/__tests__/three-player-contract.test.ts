import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import { DeckManager } from '../src/game-engine/deck-manager';
import { RulesValidator } from '../src/game-engine/rules-validator';
import { GamePhase } from '../src/shared/types';
import { getTurnOrder } from '../src/game-engine/turn-order';

describe('固定三人运行契约', () => {
  it('normalizes legacy four-player input to a three-player game at the manager boundary', () => {
    const state = new GameManager().createGame({ playerCount: 4 as never, seed: 20260818 });
    expect(state.players).toHaveLength(3);
    const dealer = state.players.find((player) => player.isDealer)!;
    expect(dealer.cards.length + dealer.melds.flatMap((meld) => meld.cards).length).toBe(state.phase === GamePhase.BAO_SELECTION ? 20 : 21);
    expect(state.players.filter((player) => !player.isDealer).every(
      (player) => player.cards.length + player.melds.flatMap((meld) => meld.cards).length === 20,
    )).toBe(true);
    expect([GamePhase.BAO_SELECTION, GamePhase.DISCARDING]).toContain(state.phase);
  });

  it('does not retain a four-player deal path', () => {
    const deckManager = new DeckManager();
    expect(() => deckManager.deal(deckManager.createDeck(), 4 as never)).toThrow('Only three-player games are supported.');
    expect(() => getTurnOrder(4)).toThrow('Only three-player turn order is supported.');
  });

  it('rejects four-player snapshots in the state validator', () => {
    const state = new GameManager().createGame({ playerCount: 3, seed: 20260818 });
    const invalid = { ...state, players: [...state.players, { ...state.players[0], playerId: 'player_3' }] };
    expect(new RulesValidator().validateGameState(invalid).valid).toBe(false);
  });
});
