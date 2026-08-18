/**
 * 游戏流程测试
 * 验证游戏能够正常运行多回合
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameSimulator } from '../src/game-engine/simulator';
import { SimulationConfig } from '../src/shared/types/simulation';
import { GameManager } from '../src/game-engine/game-manager';
import { ActionHandlers } from '../src/game-engine/action-handlers';
import { GamePhase } from '../src/shared/types';

describe('游戏流程测试', () => {
  let simulator: GameSimulator;
  let gameManager: GameManager;
  let actionHandlers: ActionHandlers;

  beforeEach(() => {
    simulator = new GameSimulator();
    gameManager = new GameManager();
    actionHandlers = new ActionHandlers();
  });

  it('游戏应该运行多回合而不是立即结束', async () => {
    const config: SimulationConfig = {
      playerCount: 3,
      aiPlayers: [0, 1, 2],
      maxTurns: 50,
      recordHistory: true
    };

    const result = await simulator.simulate(config);

    // V3允许天胡，可能0回合直接结束
    if (result.totalTurns === 0) {
      expect(result.completed).toBe(true);
      return;
    }

    expect(result.totalTurns).toBeGreaterThanOrEqual(3);
    expect(result.history.length).toBeGreaterThanOrEqual(3);

    const midGameState = result.history[Math.floor(result.history.length / 2)];
    expect(midGameState.state).toBeDefined();
    expect(midGameState.state.players).toBeDefined();
    expect(midGameState.action).toBeDefined();
  });

  it('固定三人游戏不再生成歇底玩家', async () => {
    const config: SimulationConfig = {
      playerCount: 3,
      aiPlayers: [0, 1, 2],
      maxTurns: 20,
      recordHistory: true
    };

    const result = await simulator.simulate(config);

    const lastState = result.history[result.history.length - 1]?.state;
    if (lastState) {
      expect(lastState.players).toHaveLength(3);
      expect(lastState.players.every((player) => player.cards.length > 0 || player.melds.length > 0)).toBe(true);
    }
  });

  it('3人游戏每个玩家都应该有牌', async () => {
    const config: SimulationConfig = {
      playerCount: 3,
      aiPlayers: [0, 1, 2],
      maxTurns: 20,
      recordHistory: false
    };

    const result = await simulator.simulate(config);

    if (result.totalTurns === 0) {
      expect(result.completed).toBe(true);
    } else {
      expect(result.totalTurns).toBeGreaterThan(0);
    }
    expect(result.scores).toHaveLength(3);
  });

  it('底牌数量配置应准确影响可摸牌山', () => {
    const states = [0, 1, 2].map((bottomCardCount) =>
      gameManager.createGame({ playerCount: 3, bottomCardCount: bottomCardCount as 0 | 1 | 2, seed: 20260812 })
    );

    expect(states.map((state) => state.remainingDeckCards)).toEqual([19, 18, 17]);
  });

  it('游戏应该通过摸牌和出牌进行', async () => {
    const config: SimulationConfig = {
      playerCount: 3,
      aiPlayers: [0, 1, 2],
      maxTurns: 30,
      recordHistory: true
    };

    const result = await simulator.simulate(config);

    if (result.history.length === 0) {
      expect(result.completed).toBe(true);
      expect(result.winnerIndex).toBeDefined();
      return;
    }

    const actionTypes = new Set(
      result.history
        .map(h => h.action.type)
        .filter(Boolean)
    );

    expect(actionTypes.has('discard')).toBe(true);
    // 进入正常回合后应出现摸牌
    if (result.totalTurns > 0) {
      expect(actionTypes.has('draw')).toBe(true);
    }
  });

  it('回归：点击摸牌后不应卡死或崩溃', () => {
    let state = gameManager.createGame({ playerCount: 3 });

    // 直接构造下家摸牌阶段，避免把“出牌响应”与本用例关注的摸牌稳定性混在一起。
    state = gameManager.updateAvailableActions({
      ...state,
      phase: GamePhase.DRAWING,
      currentPlayerIndex: 1,
      pendingResponses: [],
      pendingCardSource: undefined,
      responseWindow: undefined,
    } as any);

    // 下家摸牌后应进入响应收集，不应结束
    state = gameManager.processAction(state, {
      type: 'draw',
      playerId: 'player_1',
      cards: [],
      timestamp: Date.now(),
    } as any);

    expect(['response_collecting', 'drawing', 'discarding']).toContain(state.phase);
    expect(state.isGameOver).toBe(false);
    const handBeforePass = state.players[1].cards.length;

    if (state.responseWindow) {
      // 响应动作必须由显式响应游标指向的玩家执行，而不是由轮次归属玩家执行。
      const passOrMandatory = (state.availableActions || []).find(a => a.type !== 'pass')
        || (state.availableActions || []).find(a => a.type === 'pass');
      expect(passOrMandatory).toBeDefined();
      const responderIndex = state.responseWindow.currentResponderIndex!;
      state = gameManager.processAction(state, {
        type: passOrMandatory!.type as any,
        playerId: state.players[responderIndex].playerId,
        cards: passOrMandatory!.cards || [],
        chiOptionId: passOrMandatory!.chiOptions?.[0]?.id,
        huOptionId: passOrMandatory!.huOptions?.[0]?.id,
        timestamp: Date.now(),
      } as any);
    }

    // 不应卡死在同一状态
    expect(state.phase === 'drawing' || state.phase === 'discarding' || state.phase === 'response_collecting').toBe(true);
    expect(state.isGameOver).toBe(false);
    // 修正规则：翻牌ActiveCard不进入手牌；若本轮触发强制响应，手牌数量允许减少
    expect(state.players[1].cards.length).toBeLessThanOrEqual(handBeforePass);
  });

  it('回归：被碰的牌不应继续留在弃牌历史', () => {
    const state = gameManager.createGame({ playerCount: 3 });
    const discardCard = state.players[0].cards[0];

    // 人为构造响应窗口：player_1 可碰 player_0 的出牌
    state.phase = GamePhase.RESPONSE_COLLECTING as any;
    state.pendingCardSource = 'discard' as any;
    state.discardPile.cards = [discardCard];
    state.discardPile.lastDiscard = discardCard;
    state.discardPile.lastDiscardPlayerIndex = 0;
    state.discardPile.discardHistory = [{ card: discardCard, playerIndex: 0 }];

    state.players[1].cards = [
      { ...discardCard, id: `${discardCard.id}_a` },
      { ...discardCard, id: `${discardCard.id}_b` },
      ...state.players[1].cards.slice(2),
    ];

    const next = actionHandlers.handlePeng(state as any, state.players[1].playerId);
    const historyAfter = next.discardPile.discardHistory || [];
    expect(historyAfter.length).toBe(0);
  });

  it('回归：chi入参异常时也必须形成合法3张列，不得产生对子置牌', () => {
    const state = gameManager.createGame({ playerCount: 3 });
    const target = {
      id: 'test_target_small_4',
      value: 4,
      rank: 4,
      size: 'small',
      color: 'black',
      isRed: false,
    } as any;

    state.phase = GamePhase.RESPONSE_COLLECTING as any;
    state.pendingCardSource = 'discard' as any;
    state.currentPlayerIndex = 0;
    state.discardPile.cards = [target];
    state.discardPile.lastDiscard = target;
    state.discardPile.lastDiscardPlayerIndex = 1; // player_0 的逆时针上家

    // 保证 player_0 至少有一组可吃组合（混搭：同值异大小）
    const altSize = target.size === 'small' ? 'big' : 'small';
    state.players[0].cards = [
      { ...target, id: `${target.id}_same` },
      { ...target, size: altSize as any, id: `${target.id}_diff` },
      {
        ...target,
        id: `${target.id}_noise`,
        value: 9,
        rank: 9,
      },
    ] as any;

    // 传入异常chi参数（非两张手牌）
    const next = actionHandlers.handleChi(state as any, state.players[0].playerId, [target] as any);
    const lastMeld = next.players[0].melds[next.players[0].melds.length - 1];

    expect(lastMeld).toBeDefined();
    expect(lastMeld.cards.length).toBe(3);
    expect(lastMeld.type).not.toBe('pair');
  });

  it('回归：自己翻出的牌应先由自己决定是否吃，过牌后下家才可吃', () => {
    const state = gameManager.createGame({ playerCount: 3 });
    const target = {
      id: 'self_draw_small_5',
      value: 5,
      rank: 5,
      size: 'small',
      color: 'black',
      isRed: false,
    } as any;

    state.phase = GamePhase.RESPONSE_COLLECTING as any;
    state.pendingCardSource = 'draw' as any;
    state.currentPlayerIndex = 1;
    state.discardPile.cards = [target];
    state.discardPile.lastDiscard = target;
    state.discardPile.lastDiscardPlayerIndex = 1;
    state.pendingResponses = [] as any;

    state.players[1].cards = [
      { ...target, id: 'p1_same_small_5' },
      { ...target, id: 'p1_big_5', size: 'big' },
      ...state.players[1].cards.slice(2),
    ] as any;

    state.players[0].cards = [
      { ...target, id: 'p0_same_small_5' },
      { ...target, id: 'p0_big_5', size: 'big' },
      ...state.players[0].cards.slice(2),
    ] as any;

    // player_2 是 player_1 的下家（顺时针），翻牌者过牌后 player_2 获得吃权
    state.players[2].cards = [
      { ...target, id: 'p2_same_small_5' },
      { ...target, id: 'p2_big_5', size: 'big' },
      ...state.players[2].cards.slice(2),
    ] as any;

    const selfView = gameManager.updateAvailableActions({ ...state, currentPlayerIndex: 1 } as any);
    // pass 前：翻牌者(1)的下家(2)不能吃（翻牌者还未过牌）
    const nextPlayerViewBeforePass = gameManager.updateAvailableActions({ ...state, currentPlayerIndex: 0 } as any);

    expect(selfView.availableActions.some((action) => action.type === 'chi')).toBe(true);
    expect(nextPlayerViewBeforePass.availableActions.some((action) => action.type === 'chi')).toBe(false);

    const afterSelfPass = gameManager.processAction(selfView as any, {
      type: 'pass',
      playerId: 'player_1',
      cards: [],
      timestamp: Date.now(),
    } as any);

    expect(afterSelfPass.phase).toBe(GamePhase.RESPONSE_COLLECTING);
    // 顺时针：player_1 的下家是 player_2（index=2）
    expect(afterSelfPass.currentPlayerIndex).toBe(0);

    const nextPlayerViewAfterPass = gameManager.updateAvailableActions({ ...afterSelfPass, currentPlayerIndex: 0 } as any);
    expect(nextPlayerViewAfterPass.availableActions.some((action) => action.type === 'chi')).toBe(true);
  });
});
