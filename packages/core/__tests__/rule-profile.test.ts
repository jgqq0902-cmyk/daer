import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import { GamePhase, DEFAULT_RULE_PROFILE } from '../src/shared/types/game';
import { CardSize, MeldType } from '../src/shared/types';
import { ScoreCalculator } from '../src/game-engine/score-calculator';

describe('RuleProfile 单一规则事实', () => {
  it('stores the rule version and an immutable profile snapshot in every new game', () => {
    const manager = new GameManager();
    const state = manager.createGame({ seed: 20260818 });

    expect(state.ruleVersion).toBe(DEFAULT_RULE_PROFILE.ruleVersion);
    expect(state.ruleProfile).toEqual(expect.objectContaining({
      ruleVersion: DEFAULT_RULE_PROFILE.ruleVersion,
      playerCount: 3,
      responseTimeout: DEFAULT_RULE_PROFILE.responseTimeout,
    }));

    const profile = state.ruleProfile!;
    expect(profile).not.toBe(DEFAULT_RULE_PROFILE);
    expect(profile.enabledMingTangTypes).not.toBe(DEFAULT_RULE_PROFILE.enabledMingTangTypes);
  });

  it('applies a profile override only to the new game snapshot', () => {
    const manager = new GameManager();
    const state = manager.createGame({ responseTimeout: 5000, maxTurns: 80, seed: 20260818 });

    expect(state.ruleProfile).toMatchObject({ responseTimeout: 5000, maxTurns: 80 });
    expect(state.ruleVersion).toBe(DEFAULT_RULE_PROFILE.ruleVersion);
  });

  it('uses the frozen profile snapshot when deciding mandatory peng', () => {
    const manager = new GameManager();
    const state = manager.createGame({ mandatoryPeng: false, seed: 20260818 });
    const target = {
      id: 'profile-target',
      rank: 'small-6' as const,
      size: CardSize.SMALL,
      value: 6,
      color: 'black' as const,
      isRed: false,
    };

    state.players = state.players.map((player) => ({ ...player, cards: [], melds: [], isBao: false }));
    state.players[1].cards = [
      { ...target, id: 'profile-peng-a' },
      { ...target, id: 'profile-peng-b' },
    ];
    state.currentPlayerIndex = 1;
    state.phase = GamePhase.RESPONSE_COLLECTING;
    state.pendingCardSource = 'discard';
    state.discardPile = {
      cards: [target],
      lastDiscard: target,
      lastDiscardPlayerIndex: 2,
      discardHistory: [],
    };

    const actions = manager.updateAvailableActions(state).availableActions;
    expect(actions.find((action) => action.type === 'peng')).toMatchObject({ isMandatory: false });
    expect(actions.some((action) => action.type === 'pass')).toBe(true);
  });

  it('uses profile thresholds for win checks instead of a second static rule source', () => {
    const calculator = new ScoreCalculator();
    const winningMelds = Array.from({ length: 7 }, (_, index) => ({
      type: MeldType.TRIPLE,
      cards: [],
      isConcealed: true,
      position: 'hand' as const,
      huPoints: 0,
      id: `profile-meld-${index}`,
    }));

    expect(calculator.checkCanWin(winningMelds, 10, false, {
      minHuPoints: 10,
      allowZeroHu: true,
    })).toBe(true);
    expect(calculator.checkCanWin(winningMelds, 10, false, {
      minHuPoints: 20,
      allowZeroHu: true,
    })).toBe(false);
    expect(calculator.checkCanWin(winningMelds, 0, true, {
      minHuPoints: 0,
      allowZeroHu: false,
    })).toBe(false);
  });
});
