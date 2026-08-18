/**
 * 回合管理器
 * 管理游戏回合流程
 * 
 * 规则实现：
 * - R7.2.1/2/3: 响应仲裁（通过 ResponseArbitrator）
 * - 坎牌不可拆：出牌时禁止出属于坎牌的牌
 */

import { 
  GameState, 
  GamePhase, 
  AvailableAction,
  PlayerResponse,
  ResponseType,
  RESPONSE_PRIORITY,
} from '../shared/types';
import { RulesValidator } from './rules-validator';
import { ResponseArbitrator, responseArbitrator, ArbitrationResult } from './response-arbitrator';
import { MeldDetector } from './meld-detector';
import { canClaimActiveCard, hasPassedCard } from './passed-play';
import { getNextPlayerIndex, getPreviousPlayerIndex } from './turn-order';

/**
 * 回合管理器类
 */
export class TurnManager {
  private rulesValidator: RulesValidator;
  private arbitrator: ResponseArbitrator;
  private meldDetector: MeldDetector;

  constructor() {
    this.rulesValidator = new RulesValidator();
    this.arbitrator = responseArbitrator;
    this.meldDetector = new MeldDetector();
  }

  /**
   * 开始回合
   */
  startTurn(state: GameState): GameState {
    const newState = { ...state };
    newState.phase = GamePhase.DRAWING;
    newState.skipDiscardAfterZhao = false;
    newState.availableActions = this.getAvailableActions(newState);
    return newState;
  }

  /**
   * 开始响应收集阶段
   * 当玩家出牌后，进入此阶段等待其他玩家响应
   * R7.2.1/2/3: 收集所有响应后进行仲裁
   */
  startResponseCollection(state: GameState): GameState {
    return {
      ...state,
      phase: GamePhase.RESPONSE_COLLECTING,
      pendingResponses: []
    };
  }

  /**
   * 添加玩家响应
   * @param state 游戏状态
   * @param playerIndex 响应玩家索引
   * @param responseType 响应类型
   * @param cards 相关牌（可选）
   * @returns 更新后的游戏状态
   */
  addPlayerResponse(
    state: GameState, 
    playerIndex: number, 
    responseType: ResponseType,
    cards?: any[]
  ): GameState {
    const response: PlayerResponse = {
      playerIndex,
      responseType,
      cards: cards || [],
      timestamp: Date.now()
    };

    return this.arbitrator.addResponse(state, response);
  }

  /**
   * 检查是否可以执行仲裁
   * 当所有需要响应的玩家都已响应时返回true
   */
  canResolveResponses(state: GameState): boolean {
    return this.arbitrator.allPlayersResponded(state);
  }

  /**
   * 执行响应仲裁
   * R7.2.1: 优先级高者先
   * R7.2.2: 同优先级按座次
   * R7.2.3: 唯一胡牌
   * @returns 仲裁结果
   */
  resolveResponses(state: GameState): ArbitrationResult {
    return this.arbitrator.arbitrate(state, state.pendingResponses);
  }

  /**
   * 获取玩家可用的响应选项
   */
  getAvailableResponsesForPlayer(state: GameState, playerIndex: number): ResponseType[] {
    return this.arbitrator.getAvailableResponses(state, playerIndex);
  }

  /**
   * 结束回合并交给下一个玩家
   */
  endTurn(state: GameState): GameState {
    const nextPlayerIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length);
    const newState = {
      ...state,
      currentPlayerIndex: nextPlayerIndex,
      turnCount: state.turnCount + 1,
      phase: GamePhase.DRAWING,
      skipDiscardAfterZhao: false,
      // 清空响应收集状态
      pendingResponses: [],
      pendingCardSource: undefined,
      responseWindow: undefined
    };

    if (this.canAct(newState, nextPlayerIndex)) {
      newState.availableActions = this.getAvailableActions(newState);
    }

    return newState;
  }

  /**
   * 获取可用操作
   */
  getAvailableActions(state: GameState): AvailableAction[] {
    const responseActorIndex = state.phase === GamePhase.RESPONSE_COLLECTING
      ? state.responseWindow?.currentResponderIndex
      : undefined;
    if (typeof responseActorIndex === 'number' && responseActorIndex !== state.currentPlayerIndex) {
      state = { ...state, currentPlayerIndex: responseActorIndex };
    }
    const actions: AvailableAction[] = [];
    const currentPlayer = state.players[state.currentPlayerIndex];
    const priorityOf = (type: AvailableAction['type'] | PlayerResponse['responseType']): number => {
      const priority = RESPONSE_PRIORITY[type as keyof typeof RESPONSE_PRIORITY];
      return typeof priority === 'number' ? priority : Number.MAX_SAFE_INTEGER;
    };
    const restrictByRecordedResponse = (candidateActions: AvailableAction[]): AvailableAction[] => {
      if (state.phase !== GamePhase.RESPONSE_COLLECTING || !state.responseWindow) {
        return candidateActions;
      }
      const recordedPriorities = state.responseWindow.responses
        .filter(response => response.responseType !== 'pass')
        .map(response => priorityOf(response.responseType));
      if (recordedPriorities.length === 0) {
        return candidateActions;
      }
      const highestRecordedPriority = Math.min(...recordedPriorities);
      return candidateActions.filter(action =>
        action.type === 'pass' || priorityOf(action.type) <= highestRecordedPriority,
      );
    };

    if (state.isGameOver || state.phase === GamePhase.ENDED) {
      return actions;
    }

    if (state.phase === GamePhase.BAO_SELECTION) {
      const tingCards = currentPlayer.baoTingCards || [];
      if (tingCards.length === 0) {
        return actions;
      }

      actions.push({
        type: 'bao',
        cards: [],
        isMandatory: false,
        description: `爆（听牌：${tingCards.map((card) => card.rank).join('、')}）`
      });
      actions.push({
        type: 'pass_bao',
        cards: [],
        isMandatory: false,
        description: '不爆'
      });
      return actions;
    }

    const mandatoryActions = this.rulesValidator.getMandatoryActions(state);
    if (mandatoryActions.length > 0) {
      const activeCard = state.discardPile.lastDiscard;
      const canChooseHu = state.phase === GamePhase.RESPONSE_COLLECTING && !!activeCard && (
          canClaimActiveCard(state, state.currentPlayerIndex, activeCard, 'hu').allowed && (
          this.rulesValidator.canHu(currentPlayer.cards, currentPlayer.melds, activeCard, state.pendingCardSource, state.ruleProfile) ||
          this.rulesValidator.getHuChiOptions(currentPlayer.cards, currentPlayer.melds, activeCard, state.ruleProfile).length > 0
        )
      );
      if (!canChooseHu) return mandatoryActions;
    }

    const addDiscardActions = () => {
      // 检测手牌中的坎牌（3张相同牌不可拆）
      const triples = this.meldDetector.detectTriples(currentPlayer.cards);
      const lockedCardIds = new Set<string>();
      for (const meld of triples.melds) {
        for (const card of meld.cards) {
          lockedCardIds.add(card.id);
        }
      }

      // 垅牌（4张相同）也不可拆
      const quadruples = this.meldDetector.detectQuadruples(currentPlayer.cards);
      for (const meld of quadruples.melds) {
        for (const card of meld.cards) {
          lockedCardIds.add(card.id);
        }
      }

      // 只有不属于坎牌/垅牌的牌才能出
      for (const card of currentPlayer.cards) {
        if (!lockedCardIds.has(card.id)) {
          actions.push({
            type: 'discard',
            cards: [card],
            isMandatory: false,
            description: `出 ${card.rank}`
          });
        }
      }

      // 坎/垅锁定牌不作为出牌候选，避免用死锁兜底逻辑拆开合法组合。
      if (false && !actions.some(a => a.type === 'discard')) {
        for (const card of currentPlayer.cards) {
          actions.push({
            type: 'discard',
            cards: [card],
            isMandatory: false,
            description: `出 ${card.rank}`
          });
        }
      }
    };

    if (state.phase === GamePhase.DRAWING) {
      // 规则循环：出牌-响应-翻牌/出牌。
      // 若当前玩家已持有21张（可出牌态），则不允许再次摸牌，直接进入出牌动作。
      if (currentPlayer.cards.length >= 21) {
        addDiscardActions();
      } else {
        actions.push({
          type: 'draw',
          cards: [],
          isMandatory: false,
          description: '摸牌'
        });
      }
    }

    if (state.phase === GamePhase.DISCARDING) {
      if (state.skipDiscardAfterZhao) {
        actions.push({
          type: 'pass',
          cards: [],
          isMandatory: true,
          description: '跳过出牌'
        });
      } else if (currentPlayer.isBao) {
        actions.push({
          type: 'pass',
          cards: [],
          isMandatory: true,
          description: '爆后不出牌'
        });
      } else {
        const dealerDiscardBaoCandidates = currentPlayer.isDealer && currentPlayer.cards.length >= 21
          ? this.rulesValidator.getBaoDiscardCandidates(currentPlayer.cards, currentPlayer.melds, state.ruleProfile)
          : [];

        for (const candidate of dealerDiscardBaoCandidates) {
          const preview = candidate.tingCards.slice(0, 4).map((card) => card.rank).join('、');
          actions.push({
            type: 'bao',
            cards: [candidate.discardCard],
            isMandatory: false,
            description: `爆（弃${candidate.discardCard.rank}成听：${preview}${candidate.tingCards.length > 4 ? '…' : ''}）`
          });
        }
        addDiscardActions();
        if (!actions.some((action) => action.type === 'discard') && !actions.some((action) => action.type === 'bao')) {
          actions.push({
            type: 'pass',
            cards: [],
            isMandatory: true,
            description: '无可出牌，跳过本回合',
          });
        }
      }
    }

    // 只有响应收集阶段才允许吃/碰/招
    if (state.phase === GamePhase.RESPONSE_COLLECTING && state.discardPile.lastDiscard) {
      const targetCard = state.discardPile.lastDiscard;
      const isResponseToDiscard = state.pendingCardSource === 'discard';
      const isOwnDiscard = isResponseToDiscard && state.discardPile.lastDiscardPlayerIndex === state.currentPlayerIndex;
      const isSelfDraw = state.pendingCardSource === 'draw' && state.currentPlayerIndex >= 0;

      // 上家是逆时针座次序列中的前一座位；来源必须是上家，下家才能吃。
      const prevPlayerIndex = getPreviousPlayerIndex(state.currentPlayerIndex, state.players.length);
      const sourcePlayerIndex = state.discardPile.lastDiscardPlayerIndex;
      const sourcePlayer = typeof sourcePlayerIndex === 'number' ? state.players[sourcePlayerIndex] : undefined;
      const sourcePlayerPassedThisCard = !!sourcePlayer && hasPassedCard(sourcePlayer, targetCard);
      const canChiBySource =
        (isResponseToDiscard && sourcePlayerIndex === prevPlayerIndex) ||
        (state.pendingCardSource === 'draw' && (
          // 翻牌者自身响应
          sourcePlayerIndex === state.currentPlayerIndex ||
          // 翻牌者已过牌（passedPlays 有记录），吃权已转给下家（来源=上家）
          (sourcePlayerPassedThisCard && sourcePlayerIndex === prevPlayerIndex)
        ));

      const hasPassedThisCard = hasPassedCard(currentPlayer, targetCard);

      if (!currentPlayer.isBao && canChiBySource && !hasPassedThisCard && this.rulesValidator.canChi(currentPlayer.cards, targetCard)) {
        const chiOptions = this.rulesValidator.getValidChiOptions(currentPlayer.cards, targetCard);
        if (chiOptions.length > 0) {
          const chiSelection = chiOptions[0].selectedCards;
          actions.push({
            type: 'chi',
            cards: chiSelection,
            chiOptions,
            isMandatory: false,
            description: '吃牌'
          });
        }
      }

      if (!currentPlayer.isBao && (!isOwnDiscard || isSelfDraw) && this.rulesValidator.canPeng(currentPlayer.cards, targetCard)) {
        actions.push({
          type: 'peng',
          cards: [targetCard],
          isMandatory: false,
          description: '碰牌'
        });
      }

      if ((!isOwnDiscard || isSelfDraw) && this.rulesValidator.canZhao(currentPlayer.cards, targetCard)) {
        actions.push({
          type: 'zhao',
          cards: [targetCard],
          isMandatory: false,
          description: '招牌'
        });
      }
    }

    const canHuBySource =
      (state.phase === GamePhase.RESPONSE_COLLECTING && !(
        state.pendingCardSource === 'discard' &&
        state.discardPile.lastDiscardPlayerIndex === state.currentPlayerIndex
      )) ||
      state.phase === GamePhase.DISCARDING;

    const huActiveCard = state.phase === GamePhase.RESPONSE_COLLECTING
      ? state.discardPile.lastDiscard
      : undefined;

    const canClaimHu = !!huActiveCard && canClaimActiveCard(state, state.currentPlayerIndex, huActiveCard, 'hu').allowed;
    const huViaDirect = canHuBySource && canClaimHu && this.rulesValidator.canHu(
      currentPlayer.cards,
      currentPlayer.melds,
      huActiveCard,
      state.pendingCardSource,
      state.ruleProfile,
    );
    const huChiOptions = canHuBySource && canClaimHu
      ? this.rulesValidator.getHuChiOptions(currentPlayer.cards, currentPlayer.melds, huActiveCard, state.ruleProfile)
      : [];

    if (huViaDirect || huChiOptions.length > 0) {
      actions.push({
        type: 'hu',
        cards: [],
        huOptions: huChiOptions.length > 0 ? huChiOptions : undefined,
        isMandatory: false,
        description: '胡牌'
      });
    }

    if (state.phase === GamePhase.RESPONSE_COLLECTING) {
      actions.push({
        type: 'pass',
        cards: [],
        isMandatory: false,
        description: '过'
      });
    }

    // 胡可放弃，但不能借此绕过“有招必招/有碰必碰”。
    if (state.phase === GamePhase.RESPONSE_COLLECTING && actions.some(action => action.type === 'hu')) {
      const targetCard = state.discardPile.lastDiscard;
      const forcedType = targetCard && state.ruleProfile?.mandatoryZhao !== false && this.rulesValidator.canZhao(currentPlayer.cards, targetCard)
        ? 'zhao'
        : targetCard && state.ruleProfile?.mandatoryPeng !== false && !currentPlayer.isBao && this.rulesValidator.canPeng(currentPlayer.cards, targetCard)
          ? 'peng'
          : undefined;
      if (forcedType) {
        return restrictByRecordedResponse(actions
          .filter(action => action.type === 'hu' || action.type === forcedType)
          .map(action => action.type === forcedType ? { ...action, isMandatory: true } : action)
          .sort((left, right) => priorityOf(left.type) - priorityOf(right.type)));
      }
    }

    return restrictByRecordedResponse(actions);
  }

  

  

  /**
   * 检查游戏是否结束
   * 注意：胡牌由玩家主动操作触发，这里只检查牌堆耗尽和回合数超限
   */
  checkGameEnd(state: GameState): { ended: boolean; winnerIndex?: number } {
    // 已经标记了赢家（通过 handleHu 设置）
    if (state.isGameOver) {
      const winnerIndex = state.players.findIndex(p => p.totalScore > 0);
      return { ended: true, winnerIndex: winnerIndex >= 0 ? winnerIndex : undefined };
    }

    // 牌堆耗尽
    if (state.remainingDeckCards <= 0) {
      if (state.phase === GamePhase.RESPONSE_COLLECTING || state.phase === GamePhase.DISCARDING) {
        return { ended: false };
      }
      return { ended: true };
    }

    // 回合数超限（防止无限循环）
    if (state.turnCount > 200) {
      return { ended: true };
    }

    return { ended: false };
  }

  /**
   * 检查玩家是否可以行动
   */
  canAct(state: GameState, playerIndex: number): boolean {
    if (state.isGameOver) return false;
    if (playerIndex !== state.currentPlayerIndex) return false;
    return true;
  }
}
