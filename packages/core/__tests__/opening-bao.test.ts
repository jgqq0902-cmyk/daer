import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import { RulesValidator } from '../src/game-engine/rules-validator';
import { Card, CardSize, GamePhase } from '../src/shared/types';

function openingCard(rank: string, value: number, size: CardSize, id: string): Card {
  const isRed = [2, 7, 10].includes(value);
  return {
    id,
    rank: rank as Card['rank'],
    value: value as Card['value'],
    size,
    color: isRed ? 'red' : 'black',
    isRed,
    displayName: rank,
  };
}

function findOpeningWithPending(): { manager: GameManager; state: ReturnType<GameManager['createGame']> } {
  const manager = new GameManager();
  for (let seed = 1; seed <= 128; seed += 1) {
    const state = manager.createGame({ playerCount: 3, seed });
    if (state.phase === GamePhase.BAO_SELECTION && state.dealerPendingCard) {
      return { manager, state };
    }
  }
  throw new Error('没有找到带庄家 pending card 的爆牌开局');
}

describe('开局第21张与爆牌状态', () => {
  it('BAO-001 keeps every base hand at 20 and stores dealer pending separately', () => {
    const { state } = findOpeningWithPending();
    const dealer = state.players.find((player) => player.isDealer)!;

    expect(dealer.cards.length + dealer.melds.flatMap((meld) => meld.cards).length).toBe(20);
    expect(state.players.filter((player) => !player.isDealer).every(
      (player) => player.cards.length + player.melds.flatMap((meld) => meld.cards).length === 20,
    )).toBe(true);
    expect(dealer.cards.some((card) => card.id === state.dealerPendingCard!.id)).toBe(false);
    expect(new RulesValidator().validateGameState(state).valid).toBe(true);
  });

  it('BAO-002 evaluates non-dealer bao eligibility from the 20-card base', () => {
    const { state } = findOpeningWithPending();
    const eligible = new Set(state.baoEligiblePlayerIndices || []);
    const nonDealer = state.players.findIndex((player) => !player.isDealer);

    expect(state.players[nonDealer].cards.length + state.players[nonDealer].melds.flatMap((meld) => meld.cards).length).toBe(20);
    expect(state.players[nonDealer].baoTingCards).toBeDefined();
    expect(eligible.has(nonDealer)).toBe((state.players[nonDealer].baoTingCards?.length || 0) > 0);
  });

  it('BAO-003 merges pending into 21 only after dealer declines bao', () => {
    const { manager, state } = findOpeningWithPending();
    const dealerIndex = state.players.findIndex((player) => player.isDealer);
    state.baoEligiblePlayerIndices = [dealerIndex];
    state.baoDecisionIndex = 0;
    state.currentPlayerIndex = dealerIndex;
    state.phase = GamePhase.BAO_SELECTION;
    state.players[dealerIndex].baoTingCards = [state.dealerPendingCard!];

    const afterPass = manager.processAction(state, {
      type: 'pass_bao',
      playerId: state.players[dealerIndex].playerId,
      cards: [],
      timestamp: 1,
    });

    expect(afterPass.phase).toBe(GamePhase.DISCARDING);
    expect(afterPass.dealerPendingCard).toBeUndefined();
    expect(afterPass.players[dealerIndex].cards.length + afterPass.players[dealerIndex].melds.flatMap((meld) => meld.cards).length).toBe(21);
  });

  it('BAO-004 never duplicates the pending card while it is unresolved', () => {
    const { state } = findOpeningWithPending();
    const pendingId = state.dealerPendingCard!.id;
    const baseOwned = state.players.flatMap((player) => [
      ...player.cards,
      ...player.melds.flatMap((meld) => meld.cards),
    ]);

    expect(baseOwned.filter((card) => card.id === pendingId)).toHaveLength(0);
    expect(state.discardPile.lastDiscard?.id).not.toBe(pendingId);
    expect(state.dealerPendingCard?.id).toBe(pendingId);
  });

  it('BAO-005 preserves one physical owner for every card during opening', () => {
    const { manager, state } = findOpeningWithPending();
    const owned = state.players.flatMap((player) => [
      ...player.cards,
      ...player.melds.flatMap((meld) => meld.cards),
    ]);
    const allVisible = [...owned, state.dealerPendingCard!, ...manager.getRemainingDeckSnapshot()];
    const ids = allVisible.map((card) => card.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length + 2).toBe(80);
  });

  it('BAO-006 fixed seed rebuilds the same opening state', () => {
    const first = new GameManager().createGame({ playerCount: 3, seed: 20260818 });
    const second = new GameManager().createGame({ playerCount: 3, seed: 20260818 });

    expect(JSON.stringify({
      players: first.players,
      phase: first.phase,
      pending: first.dealerPendingCard,
      eligible: first.baoEligiblePlayerIndices,
    })).toBe(JSON.stringify({
      players: second.players,
      phase: second.phase,
      pending: second.dealerPendingCard,
      eligible: second.baoEligiblePlayerIndices,
    }));
  });

  it('BAO-007 never offers a card from an opening kan as a discard-to-bao candidate', () => {
    const hand = [
      openingCard('一', 1, CardSize.SMALL, 'small-1-a'),
      openingCard('一', 1, CardSize.SMALL, 'small-1-b'),
      openingCard('一', 1, CardSize.SMALL, 'small-1-c'),
      openingCard('二', 2, CardSize.SMALL, 'small-2'),
      openingCard('四', 4, CardSize.SMALL, 'small-4'),
      openingCard('六', 6, CardSize.SMALL, 'small-6-a'),
      openingCard('六', 6, CardSize.SMALL, 'small-6-b'),
      openingCard('七', 7, CardSize.SMALL, 'small-7-a'),
      openingCard('七', 7, CardSize.SMALL, 'small-7-b'),
      openingCard('八', 8, CardSize.SMALL, 'small-8'),
      openingCard('九', 9, CardSize.SMALL, 'small-9'),
      openingCard('十', 10, CardSize.SMALL, 'small-10'),
      openingCard('壹', 1, CardSize.BIG, 'big-1'),
      openingCard('贰', 2, CardSize.BIG, 'big-2'),
      openingCard('肆', 4, CardSize.BIG, 'big-4-a'),
      openingCard('肆', 4, CardSize.BIG, 'big-4-b'),
      openingCard('陆', 6, CardSize.BIG, 'big-6'),
      openingCard('柒', 7, CardSize.BIG, 'big-7-a'),
      openingCard('柒', 7, CardSize.BIG, 'big-7-b'),
      openingCard('拾', 10, CardSize.BIG, 'big-10-a'),
      openingCard('拾', 10, CardSize.BIG, 'big-10-b'),
    ];
    const candidates = new RulesValidator().getBaoDiscardCandidates(hand);
    const candidateIds = candidates.map((candidate) => candidate.discardCard.id);

    expect(candidateIds).not.toContain('small-1-a');
    expect(candidateIds).not.toContain('small-1-b');
    expect(candidateIds).not.toContain('small-1-c');
    expect(candidateIds).toContain('big-1');
  });

  it('BAO-008 rejects a stale discard-to-bao request for an opening kan card', () => {
    const manager = new GameManager();
    const state = manager.createGame({ playerCount: 3, seed: 20260818 });
    const dealerIndex = state.players.findIndex((player) => player.isDealer);
    const dealerCards = [
      openingCard('一', 1, CardSize.SMALL, 'stale-small-1-a'),
      openingCard('一', 1, CardSize.SMALL, 'stale-small-1-b'),
      openingCard('一', 1, CardSize.SMALL, 'stale-small-1-c'),
      openingCard('壹', 1, CardSize.BIG, 'legal-big-1'),
      openingCard('二', 2, CardSize.SMALL, 'stale-small-2'),
      openingCard('四', 4, CardSize.SMALL, 'stale-small-4'),
      openingCard('六', 6, CardSize.SMALL, 'stale-small-6-a'),
      openingCard('六', 6, CardSize.SMALL, 'stale-small-6-b'),
      openingCard('七', 7, CardSize.SMALL, 'stale-small-7-a'),
      openingCard('七', 7, CardSize.SMALL, 'stale-small-7-b'),
      openingCard('八', 8, CardSize.SMALL, 'stale-small-8'),
      openingCard('九', 9, CardSize.SMALL, 'stale-small-9'),
      openingCard('十', 10, CardSize.SMALL, 'stale-small-10'),
      openingCard('贰', 2, CardSize.BIG, 'stale-big-2'),
      openingCard('肆', 4, CardSize.BIG, 'stale-big-4-a'),
      openingCard('肆', 4, CardSize.BIG, 'stale-big-4-b'),
      openingCard('陆', 6, CardSize.BIG, 'stale-big-6'),
      openingCard('柒', 7, CardSize.BIG, 'stale-big-7-a'),
      openingCard('柒', 7, CardSize.BIG, 'stale-big-7-b'),
      openingCard('拾', 10, CardSize.BIG, 'stale-big-10-a'),
      openingCard('伍', 5, CardSize.BIG, 'stale-big-5'),
    ];
    state.players[dealerIndex] = {
      ...state.players[dealerIndex],
      cards: dealerCards,
      isBao: false,
      baoTingCards: [],
    };
    state.dealerPendingCard = undefined;
    state.currentPlayerIndex = dealerIndex;
    state.phase = GamePhase.DISCARDING;
    state.availableActions = manager.getAvailableActions(state);

    const smallKan = state.players[dealerIndex].cards.filter(
      (card) => card.value === 1 && card.size === CardSize.SMALL,
    );
    expect(smallKan).toHaveLength(3);
    expect(state.availableActions.some((action) => action.type === 'bao')).toBe(true);

    const after = manager.processAction(state, {
      type: 'bao',
      playerId: state.players[dealerIndex].playerId,
      cards: [smallKan[0]],
      timestamp: 1,
    });

    expect(after.phase).toBe(GamePhase.DISCARDING);
    expect(after.players[dealerIndex].isBao).not.toBe(true);
    expect(after.discardPile.lastDiscard).toBeUndefined();
  });
});
