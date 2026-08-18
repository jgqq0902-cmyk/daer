/**
 * 游戏管理器
 * 整合所有游戏模块，管理游戏流程
 * 
 * 实现规则：
 * - R8.4.1: 首局随机庄家
 * - R8.4.2: 胡牌者轮庄
 * - R8.4.3: 流局庄家不变
 */

import { AvailableAction, GameState, GamePhase, PlayerHand, PlayerResponse, Card, PlayerAction, PlayerActionType, MeldType, RESPONSE_PRIORITY, type ResponseTimeoutAction } from '../shared/types';
import { GameConfig, RuleProfile, DEFAULT_GAME_CONFIG } from '../shared/types/game';
import { DeckManager } from './deck-manager';
import { TurnManager } from './turn-manager';
import { ActionHandlers } from './action-handlers';
import { RulesValidator } from './rules-validator';
import { MeldDetector } from './meld-detector';
import { ScoreCalculator } from './score-calculator';
import { canClaimActiveCard } from './passed-play';
import { canDeclareHeavenlyWin, openingMingTangContext } from './opening-facts';
import { getNextPlayerIndex, getPreviousPlayerIndex, getResponderOrder } from './turn-order';

/**
 * 游戏管理器类
 */
export class GameManager {
  private deckManager: DeckManager;
  private turnManager: TurnManager;
  private actionHandlers: ActionHandlers;
  private rulesValidator: RulesValidator;
  private meldDetector: MeldDetector;
  private scoreCalculator: ScoreCalculator;
  private deck: Card[] = [];
  private currentConfig: GameConfig = DEFAULT_GAME_CONFIG;
  private readonly clock: () => number;

  getRemainingDeckSnapshot(): Card[] {
    return this.deck.map((card) => ({ ...card }));
  }

  setRemainingDeckSnapshot(deck: Card[]): void {
    this.deck = deck.map((card) => ({ ...card }));
  }

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
    this.deckManager = new DeckManager();
    this.turnManager = new TurnManager();
    this.actionHandlers = new ActionHandlers();
    this.rulesValidator = new RulesValidator();
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
  }

  private now(): number {
    return this.clock();
  }

  private snapshotRuleProfile(config: GameConfig): RuleProfile {
    return {
      ruleVersion: config.ruleVersion,
      playerCount: 3,
      bottomCardCount: config.bottomCardCount,
      enabledMingTangTypes: { ...config.enabledMingTangTypes },
      guoZhangClearPolicy: config.guoZhangClearPolicy,
      rotatingDealer: config.rotatingDealer,
      mandatoryPeng: config.mandatoryPeng,
      mandatoryZhao: config.mandatoryZhao,
      minHuPoints: config.minHuPoints,
      allowZeroHu: config.allowZeroHu,
      maxTurns: config.maxTurns,
      responseTimeout: config.responseTimeout,
      minResponseTimeout: config.minResponseTimeout,
      maxResponseTimeout: config.maxResponseTimeout,
    };
  }

  private responseTimeoutMs(): number {
    return Math.min(
      this.currentConfig.maxResponseTimeout,
      Math.max(this.currentConfig.minResponseTimeout, this.currentConfig.responseTimeout),
    );
  }

  private timeoutActionFor(actions: AvailableAction[]): ResponseTimeoutAction {
    if (actions.some((action) => action.type === 'zhao' && action.isMandatory)) {
      return 'timeout_zhao';
    }
    if (actions.some((action) => action.type === 'peng' && action.isMandatory)) {
      return 'timeout_peng';
    }
    return 'timeout_pass';
  }

  private normalizeTimeoutAction(state: GameState, action: PlayerAction): PlayerAction | null {
    if (!action.type.startsWith('timeout_')) {
      return action;
    }

    const window = state.responseWindow;
    const responderIndex = window?.currentResponderIndex;
    if (
      state.phase !== GamePhase.RESPONSE_COLLECTING ||
      !window ||
      typeof responderIndex !== 'number' ||
      action.isSystem !== true ||
      action.responseWindowId !== window.id ||
      action.type !== window.timeoutAction ||
      this.now() < window.deadlineAt ||
      state.players[responderIndex]?.playerId !== action.playerId
    ) {
      return null;
    }

    const normalizedType = action.type === 'timeout_peng'
      ? 'peng'
      : action.type === 'timeout_zhao'
        ? 'zhao'
        : 'pass';
    const offered = this.turnManager.getAvailableActions(state);
    if (!offered.some((candidate) => candidate.type === normalizedType)) {
      return null;
    }

    return { ...action, type: normalizedType, isSystem: true };
  }

  private materializePendingDrawCard(state: GameState, responseWindowId?: string): GameState {
    if (state.pendingCardSource !== 'draw' || !state.discardPile.lastDiscard) {
      return state;
    }

    const targetCard = state.discardPile.lastDiscard;
    const alreadyInDiscard = (state.discardPile.cards || []).some((card) => card.id === targetCard.id);
    const alreadyInHistory = (state.discardPile.discardHistory || []).some((entry) => entry.card.id === targetCard.id);

    if (alreadyInDiscard && alreadyInHistory) {
      return state;
    }

    return {
      ...state,
      discardPile: {
        ...state.discardPile,
        cards: alreadyInDiscard
          ? state.discardPile.cards
          : [...(state.discardPile.cards || []), targetCard],
        discardHistory: alreadyInHistory
          ? state.discardPile.discardHistory
          : [
              ...(state.discardPile.discardHistory || []),
              {
                card: targetCard,
                sourcePlayerIndex: state.discardPile.lastDiscardPlayerIndex ?? state.currentPlayerIndex,
                playerIndex: state.discardPile.lastDiscardPlayerIndex ?? state.currentPlayerIndex,
                source: 'draw',
                responseWindowId,
                sequence: (state.discardPile.discardHistory || []).length + 1,
              },
            ],
      },
    };
  }

  private getActingPlayerIndex(state: GameState): number {
    return state.phase === GamePhase.RESPONSE_COLLECTING && typeof state.responseWindow?.currentResponderIndex === 'number'
      ? state.responseWindow.currentResponderIndex
      : state.currentPlayerIndex;
  }

  private getResponseActions(state: GameState, playerIndex: number): AvailableAction[] {
    if (!state.responseWindow) return [];
    return this.turnManager.getAvailableActions({
      ...state,
      responseWindow: { ...state.responseWindow, currentResponderIndex: playerIndex },
    });
  }

  private appendResponse(state: GameState, response: PlayerResponse): GameState {
    const responses = [
      ...(state.responseWindow?.responses || []).filter(item => item.playerIndex !== response.playerIndex),
      response,
    ];
    return {
      ...state,
      pendingResponses: responses,
      responseWindow: state.responseWindow ? { ...state.responseWindow, responses } : undefined,
    };
  }

  private resolveResponseWindow(state: GameState): GameState {
    const window = state.responseWindow;
    if (!window) return state;
    const arbitrationState = { ...state, pendingResponses: window.responses };
    const winner = this.turnManager.resolveResponses(arbitrationState).winningResponse;

    if (!winner) {
      const materialized = this.materializePendingDrawCard({
        ...arbitrationState,
        currentPlayerIndex: window.sourcePlayerIndex,
        responseWindow: undefined,
      }, window.id);
      return this.turnManager.endTurn(this.completeOpeningResolution(materialized));
    }

    const playerId = state.players[winner.playerIndex].playerId;
    const actionState: GameState = {
      ...arbitrationState,
      currentPlayerIndex: winner.playerIndex,
      responseWindow: undefined,
    };
    let resolvedState: GameState;
    switch (winner.responseType) {
      case 'chi':
        resolvedState = this.actionHandlers.handleChi(actionState, playerId, winner.cards, winner.chiOptionId);
        break;
      case 'peng':
        resolvedState = this.actionHandlers.handlePeng(actionState, playerId);
        break;
      case 'zhao':
        resolvedState = this.actionHandlers.handleZhao(actionState, playerId);
        break;
      case 'hu':
        resolvedState = this.actionHandlers.handleHu(
          actionState,
          playerId,
          window.source === 'draw' && window.sourcePlayerIndex === winner.playerIndex,
          winner.huOptionId,
        );
        break;
      default:
        resolvedState = this.turnManager.endTurn({ ...actionState, currentPlayerIndex: window.sourcePlayerIndex });
        break;
    }
    return winner.responseType === 'hu'
      ? resolvedState
      : this.markOrdinaryAction(this.completeOpeningResolution(resolvedState));
  }

  private advanceResponseWindow(state: GameState, _startPosition: number): GameState {
    const window = state.responseWindow;
    if (!window) return state;

    let nextState = state;
    const respondedPlayers = new Set(window.responses.map((response) => response.playerIndex));
    const priorityOf = (action: AvailableAction): number => {
      const priority = RESPONSE_PRIORITY[action.type as keyof typeof RESPONSE_PRIORITY];
      return typeof priority === 'number' ? priority : Number.MAX_SAFE_INTEGER;
    };
    const recordedPriorities = window.responses
      .filter((response) => response.responseType !== 'pass')
      .map((response) => {
        const priority = RESPONSE_PRIORITY[response.responseType];
        return typeof priority === 'number' ? priority : Number.MAX_SAFE_INTEGER;
      });
    const highestRecordedPriority = recordedPriorities.length > 0
      ? Math.min(...recordedPriorities)
      : Number.MAX_SAFE_INTEGER;
    const candidates: Array<{
      position: number;
      playerIndex: number;
      state: GameState;
      actions: AvailableAction[];
    }> = [];

    for (let position = 0; position < window.responderOrder.length; position++) {
      const playerIndex = window.responderOrder[position];
      if (respondedPlayers.has(playerIndex)) continue;

      const candidate = {
        ...nextState,
        responseWindow: { ...nextState.responseWindow!, currentResponderIndex: playerIndex },
      };
      const actions = this.getResponseActions(candidate, playerIndex);
      const competitiveActions = actions.filter(action =>
        action.type !== 'pass' && priorityOf(action) <= highestRecordedPriority,
      );

      if (competitiveActions.length > 0) {
        candidates.push({
          position,
          playerIndex,
          state: candidate,
          // 这一层只决定当前响应者；选中后保留该玩家完整合法动作集。
          actions,
        });
        continue;
      }

      nextState = this.appendResponse(candidate, {
        playerIndex,
        responseType: 'pass',
        cards: [],
        timestamp: Date.now(),
      });
      respondedPlayers.add(playerIndex);
    }

    if (!candidates.length) {
      return this.resolveResponseWindow({
        ...nextState,
        responseWindow: { ...nextState.responseWindow!, currentResponderIndex: undefined },
        availableActions: [],
      });
    }

    const highestPriority = Math.min(
      ...candidates.flatMap((candidate) => candidate.actions
        .filter((action) => action.type !== 'pass')
        .map(priorityOf)),
    );
    const selected = candidates.find((candidate) => candidate.actions.some(
      (action) => action.type !== 'pass' && priorityOf(action) === highestPriority,
    ))!;
    const selectedActions = selected.actions;
    const mandatoryAction = selectedActions.find(
      (action) => action.isMandatory && action.type !== 'pass',
    );
    const hasHuFallback = selectedActions.some((action) => action.type === 'hu');
    const hasMandatoryHuFallback = !!mandatoryAction && hasHuFallback;

    if (mandatoryAction && !hasHuFallback) {
      const resolvedState = this.appendResponse(selected.state, {
        playerIndex: selected.playerIndex,
        responseType: mandatoryAction.type as PlayerResponse['responseType'],
        cards: mandatoryAction.cards || [],
        timestamp: Date.now(),
        chiOptionId: mandatoryAction.chiOptions?.[0]?.id,
        huOptionId: mandatoryAction.huOptions?.[0]?.id,
      });
      return this.resolveResponseWindow({
        ...resolvedState,
        responseWindow: { ...resolvedState.responseWindow!, currentResponderIndex: undefined },
        availableActions: [],
      });
    }

    return {
      ...selected.state,
      responseWindow: {
        ...selected.state.responseWindow!,
        currentResponderIndex: selected.playerIndex,
        timeoutAction: this.timeoutActionFor(selectedActions),
      },
      availableActions: hasMandatoryHuFallback
        ? selectedActions.filter((action) => action.type !== 'pass')
        : selectedActions,
    };
  }

  private openResponseWindow(state: GameState): GameState {
    const activeCard = state.discardPile.lastDiscard;
    const source = state.pendingCardSource;
    const sourcePlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    if (state.phase !== GamePhase.RESPONSE_COLLECTING || !activeCard || !source || typeof sourcePlayerIndex !== 'number') {
      return state;
    }

    const responderOrder = getResponderOrder(source, sourcePlayerIndex, state.players.length);

    const openedAt = this.now();
    const responseWindowId = `${state.turnCount}:${source}:${activeCard.id}`;
    const discardHistory = state.discardPile.discardHistory?.map((entry, index, history) =>
      index === history.length - 1 && entry.card.id === activeCard.id
        ? { ...entry, responseWindowId }
        : entry,
    );
    const opened: GameState = {
      ...state,
      pendingResponses: [],
      discardPile: discardHistory
        ? { ...state.discardPile, discardHistory }
        : state.discardPile,
      responseWindow: {
        id: responseWindowId,
        source,
        sourcePlayerIndex,
        activeCard,
        responderOrder,
        responses: [],
        openedAt,
        deadlineAt: openedAt + this.responseTimeoutMs(),
        timeoutAction: 'timeout_pass',
      },
    };
    return this.advanceResponseWindow(opened, 0);
  }

  private processWindowResponse(state: GameState, action: PlayerAction, offered: AvailableAction[]): GameState {
    const window = state.responseWindow;
    if (!window || typeof window.currentResponderIndex !== 'number') return state;
    const playerIndex = window.currentResponderIndex;
    if (state.players[playerIndex]?.playerId !== action.playerId) return { ...state, availableActions: offered };

    let responseState = state;
    if (action.type === 'pass' && offered.some(item => item.type === 'chi')) {
      responseState = this.actionHandlers.handlePass(state, action.playerId, 'chi');
    }
    responseState = this.appendResponse(responseState, {
      playerIndex,
      responseType: action.type as PlayerResponse['responseType'],
      cards: action.cards || [],
      timestamp: action.timestamp || Date.now(),
      chiOptionId: action.chiOptionId,
      huOptionId: action.huOptionId,
    });
    const position = window.responderOrder.indexOf(playerIndex);
    return this.advanceResponseWindow(responseState, position + 1);
  }

  /**
   * 起手垅牌必晒：把手牌中的4张相同牌移到置牌区
   */
  private applyStartLong(player: PlayerHand): PlayerHand {
    const detected = this.meldDetector.detectQuadruples(player.cards);
    if (detected.melds.length === 0) {
      return player;
    }

    const longMelds = detected.melds.map(m => {
      const meld = {
        ...m,
        isConcealed: false,
        position: 'table' as const,
        huPoints: 0
      };
      meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);
      return meld;
    });

    return {
      ...player,
      cards: detected.remaining,
      melds: [...player.melds, ...longMelds],
      hasEightBlocks: (player.melds.filter(m => m.type === MeldType.QUADRUPLE || m.type === MeldType.DRAW_QUADRUPLE).length + longMelds.length) >= 2
    };
  }

  /**
   * 过张清理策略（默认 NEVER）：进入玩家新回合时清空该玩家过张记录
   */
  private applyGuoZhangClearPolicy(state: GameState): GameState {
    if (this.currentConfig.guoZhangClearPolicy === 'NEVER') {
      return state;
    }
    
    if (this.currentConfig.guoZhangClearPolicy !== 'ROUND_END') {
      return state;
    }

    if (state.phase !== GamePhase.DRAWING) {
      return state;
    }

    const idx = state.currentPlayerIndex;
    const players = [...state.players];
    if (players[idx].passedPlays.length === 0) {
      return state;
    }

    players[idx] = {
      ...players[idx],
      passedPlays: []
    };

    return {
      ...state,
      players
    };
  }

  private sortCards(cards: Card[]): Card[] {
    return [...cards].sort((a, b) => {
      if (a.size !== b.size) {
        return a.size === 'big' ? 1 : -1;
      }
      if (a.value !== b.value) {
        return a.value - b.value;
      }
      return 0;
    });
  }

  private markOrdinaryAction(state: GameState): GameState {
    return {
      ...state,
      openingPhase: 'normal',
      openingFacts: {
        ordinaryActionCount: (state.openingFacts?.ordinaryActionCount || 0) + 1,
      },
    };
  }

  private completeOpeningResolution(state: GameState): GameState {
    if (state.openingPhase !== 'dealer_pending_resolution') {
      return state;
    }
    return { ...state, openingPhase: 'normal' };
  }

  private prepareBaoSelection(players: PlayerHand[]): { players: PlayerHand[]; eligibleIndices: number[] } {
    const preparedPlayers = players.map((player) => {
      const baoTingCards = this.rulesValidator.getBaoTingCards(player.cards, player.melds, this.currentConfig);
      return {
        ...player,
        isBao: false,
        baoTingCards,
      };
    });

    const eligibleIndices = preparedPlayers
      .map((player, index) => ({ index, count: player.baoTingCards?.length || 0 }))
      .filter((item) => item.count > 0)
      .map((item) => item.index);

    return {
      players: preparedPlayers,
      eligibleIndices,
    };
  }

  private finalizeOpeningState(state: GameState): GameState {
    const dealerIndex = state.players.findIndex((player) => player.isDealer);
    if (dealerIndex === -1) {
      return state;
    }

    const dealer = state.players[dealerIndex];
    const dealerPendingCard = state.dealerPendingCard;

    if (!dealer.isBao && dealerPendingCard) {
      const players = [...state.players];
      const dealerCards = dealer.cards.some((card) => card.id === dealerPendingCard.id)
        ? dealer.cards
        : [...dealer.cards, dealerPendingCard];
      players[dealerIndex] = this.applyStartLong({
        ...dealer,
        cards: this.sortCards(dealerCards),
      });

      const nextState: GameState = {
        ...state,
        players,
        currentPlayerIndex: dealerIndex,
        phase: GamePhase.DISCARDING,
        dealerPendingCard: undefined,
        baoEligiblePlayerIndices: undefined,
        baoDecisionIndex: undefined,
        pendingResponses: [],
        pendingCardSource: undefined,
        skipDiscardAfterZhao: false,
        openingPhase: 'dealer_pending_resolution',
      };

      nextState.availableActions = this.turnManager.getAvailableActions(nextState);

      if (
        canDeclareHeavenlyWin(openingMingTangContext(nextState, dealerIndex))
        && this.rulesValidator.checkHeavenlyWin(players[dealerIndex].cards)
      ) {
        return this.actionHandlers.handleHu(nextState, players[dealerIndex].playerId, true);
      }

      return this.completeOpeningResolution(nextState);
    }

    const players = [...state.players];
    if (dealerPendingCard) {
      players[dealerIndex] = {
        ...dealer,
        cards: this.sortCards(dealer.cards.filter((card) => card.id !== dealerPendingCard.id)),
      };
    }

    const responseState: GameState = {
      ...state,
      players,
      currentPlayerIndex: dealerIndex,
      phase: GamePhase.RESPONSE_COLLECTING,
      discardPile: {
        ...state.discardPile,
        lastDiscard: dealerPendingCard,
        lastDiscardPlayerIndex: dealerIndex,
      },
      dealerPendingCard: undefined,
      baoEligiblePlayerIndices: undefined,
      baoDecisionIndex: undefined,
      pendingResponses: [],
      pendingCardSource: 'draw',
      skipDiscardAfterZhao: false,
      openingPhase: 'dealer_pending_resolution',
    };

    return this.openResponseWindow(responseState);
  }

  private handleBaoChoice(state: GameState, declared: boolean): GameState {
    if (state.phase === GamePhase.DISCARDING && declared) {
      return state;
    }

    if (state.phase !== GamePhase.BAO_SELECTION) {
      return state;
    }

    const currentIndex = state.currentPlayerIndex;
    const currentPlayer = state.players[currentIndex];
    if (!currentPlayer || (currentPlayer.baoTingCards?.length || 0) === 0) {
      return state;
    }

    const players = [...state.players];
    players[currentIndex] = {
      ...currentPlayer,
      isBao: declared,
    };

    const eligible = state.baoEligiblePlayerIndices || [];
    const nextDecisionIndex = (state.baoDecisionIndex || 0) + 1;
    const baoDecisions = [
      ...(state.baoDecisions || []),
      {
        playerIndex: currentIndex,
        declared,
        tingCards: currentPlayer.baoTingCards || [],
      },
    ];

    if (nextDecisionIndex < eligible.length) {
      const nextState: GameState = {
        ...state,
        players,
        currentPlayerIndex: eligible[nextDecisionIndex],
        baoDecisionIndex: nextDecisionIndex,
        baoDecisions,
      };
      nextState.availableActions = this.turnManager.getAvailableActions(nextState);
      return nextState;
    }

    return this.finalizeOpeningState({
      ...state,
      players,
      baoDecisionIndex: nextDecisionIndex,
      baoDecisions,
    });
  }

  private handleDiscardToBao(state: GameState, playerId: string, discardCard?: Card): GameState {
    if (state.phase !== GamePhase.DISCARDING) {
      return state;
    }

    const playerIndex = state.players.findIndex((player) => player.playerId === playerId);
    if (playerIndex === -1 || playerIndex !== state.currentPlayerIndex) {
      return state;
    }

    const player = state.players[playerIndex];
    if (!player.isDealer || player.isBao || player.cards.length < 21 || !discardCard) {
      return state;
    }

    const matchedCard = player.cards.find((card) => card.id === discardCard.id);
    if (!matchedCard) {
      return state;
    }

    const allowedBaoDiscardIds = new Set(
      this.rulesValidator
        .getBaoDiscardCandidates(player.cards, player.melds, state.ruleProfile)
        .map((candidate) => candidate.discardCard.id),
    );
    if (!allowedBaoDiscardIds.has(matchedCard.id)) {
      return state;
    }

    const remainingCards = player.cards.filter((card) => card.id !== matchedCard.id);
    const tingCards = this.rulesValidator.getBaoTingCards(remainingCards, player.melds, state.ruleProfile);
    if (tingCards.length === 0) {
      return state;
    }

    const players = [...state.players];
    players[playerIndex] = {
      ...player,
      cards: this.sortCards(remainingCards),
      isBao: true,
      baoTingCards: tingCards,
    };

    const nextState: GameState = {
      ...state,
      players,
      currentPlayerIndex: playerIndex,
      phase: GamePhase.RESPONSE_COLLECTING,
      discardPile: {
        ...state.discardPile,
        lastDiscard: matchedCard,
        lastDiscardPlayerIndex: playerIndex,
      },
      pendingResponses: [],
      pendingCardSource: 'discard',
      skipDiscardAfterZhao: false,
    };

    return this.openResponseWindow(nextState);
  }

  /**
   * 确定庄家索引
   * R8.4.1: 首局随机庄家（但如果未指定lastDealerIndex，默认为0以保持测试稳定）
   * R8.4.2: 胡牌者轮庄
   * R8.4.3: 流局庄家不变
   */
  private determineDealerIndex(config: GameConfig): number {
    // R8.4.3: 如果上一局流局，庄家不变
    if (config.lastGameDrawn && config.lastDealerIndex !== undefined) {
      return config.lastDealerIndex;
    }

    // R8.4.2: 如果上一局有赢家，赢家当庄
    if (config.lastWinnerIndex !== undefined) {
      return config.lastWinnerIndex;
    }

    // R8.4.1: 首局使用lastDealerIndex或默认为0（保持测试稳定）
    if (config.lastDealerIndex !== undefined) {
      return config.lastDealerIndex;
    }

    // 默认庄家为0
    return 0;
  }

  /**
   * 创建新游戏
   */
  createGame(config: Partial<GameConfig> = {}): GameState {
    const finalConfig: GameConfig = { ...DEFAULT_GAME_CONFIG, ...config, playerCount: 3 };
    this.currentConfig = finalConfig;
    this.actionHandlers.setConfig(finalConfig);

    // 创建并洗牌
    this.deck = Number.isFinite(finalConfig.seed)
      ? this.deckManager.createShuffledDeckWithSeed(finalConfig.seed as number)
      : this.deckManager.createShuffledDeck();

    // 确定庄家（实现轮庄规则）
    const dealerIndex = this.determineDealerIndex(finalConfig);

    // 发牌
    const dealResult = this.deckManager.deal(
      this.deck,
      finalConfig.playerCount,
      dealerIndex,
      finalConfig.bottomCardCount,
      true,
    );
    
    // 更新内部牌堆为发放后剩余的可摸牌（排除玩家手牌和底牌）
    this.deck = dealResult.remainingDeck;

    // 创建玩家状态
    let players: PlayerHand[] = dealResult.hands.map((hand, index) => ({
      playerId: `player_${index}`,
      playerName: `玩家${index}`,
      cards: hand,
      melds: [],
      isCurrentPlayer: index === dealResult.dealerIndex,
      isDealer: index === dealResult.dealerIndex,
      hasEightBlocks: false,
      passedPlays: [],
      chiHistory: [],
      totalScore: 0
    }));

    // R4.2.1: 起手垅牌必晒。庄家基础手牌固定为20张，第21张牌只保留在
    // dealerPendingCard，直到爆牌选择完成后才进入弃牌或翻牌流程。
    players = players.map(p => this.applyStartLong(p));
    const baoPrepared = this.prepareBaoSelection(players);
    players = baoPrepared.players;

    // 创建初始游戏状态
    const gameState: GameState = {
      players,
      currentPlayerIndex: baoPrepared.eligibleIndices[0] ?? dealResult.dealerIndex,
      discardPile: {
        cards: [],
        discardHistory: [],
        lastDiscard: undefined
      },
      tableMelds: [],
      phase: baoPrepared.eligibleIndices.length > 0 ? GamePhase.BAO_SELECTION : GamePhase.DISCARDING,
      turnCount: 0,
      isGameOver: false,
      remainingDeckCards: dealResult.remainingDeck.length,
      availableActions: [],
      pendingResponses: [],
      pendingCardSource: undefined,
      skipDiscardAfterZhao: false,
      dealerPendingCard: dealResult.dealerPendingCard,
      baoEligiblePlayerIndices: baoPrepared.eligibleIndices,
      baoDecisionIndex: 0,
      baoDecisions: [],
      openingPhase: baoPrepared.eligibleIndices.length > 0 ? 'bao_selection' : 'dealer_pending_resolution',
      openingFacts: { ordinaryActionCount: 0 },
      drawOrdinal: 0,
      ruleVersion: finalConfig.ruleVersion,
      ruleProfile: this.snapshotRuleProfile(finalConfig),
    };

    if (baoPrepared.eligibleIndices.length === 0) {
      return this.finalizeOpeningState(gameState);
    }

    // 初始化可用操作，避免前端首帧无操作可点
    gameState.availableActions = this.turnManager.getAvailableActions(gameState);

    return gameState;
  }

  /**
   * 处理玩家行动
   */
  processAction(state: GameState, action: PlayerAction): GameState {
    if (state.isGameOver) {
      return state;
    }

    const normalizedAction = this.normalizeTimeoutAction(state, action);
    if (!normalizedAction) {
      return state;
    }
    action = normalizedAction;

    // 仅允许执行当前可用操作（防止前端误触/状态不同步）
    const currentAvailable = this.turnManager.getAvailableActions(state);
    const availableTypes = new Set(currentAvailable.map(a => a.type));
    if (!availableTypes.has(action.type as any)) {
      return {
        ...state,
        availableActions: currentAvailable
      };
    }

    if (state.phase === GamePhase.RESPONSE_COLLECTING && state.responseWindow) {
      const responseState = this.processWindowResponse(state, action, currentAvailable);
      if (responseState.isGameOver) return responseState;
      const checked = this.applyGuoZhangClearPolicy(responseState);
      const gameEndCheck = this.turnManager.checkGameEnd(checked);
      if (gameEndCheck.ended || checked.turnCount > (this.currentConfig.maxTurns ?? 200)) {
        return { ...checked, phase: GamePhase.ENDED, isGameOver: true };
      }
      return { ...checked, availableActions: this.turnManager.getAvailableActions(checked) };
    }

    let newState = state;

    switch (action.type) {
      case 'draw':
        // drawing阶段且手牌<21时才能摸牌，避免重复摸牌
        if (newState.phase === GamePhase.DRAWING && newState.players[newState.currentPlayerIndex].cards.length < 21) {
          const drawResult = this.actionHandlers.handleDraw(newState, this.deck);
          newState = drawResult.drawnCard
            ? {
              ...drawResult.state,
              drawOrdinal: (drawResult.state.drawOrdinal || 0) + 1,
            }
            : drawResult.state;
          newState = this.openResponseWindow(newState);
        }
        break;

      case 'discard':
        if (action.cards?.length > 0) {
          // 只允许执行当前可用列表中的出牌（防止拆坎/拆垅）
          const allowedDiscardIds = new Set(
            this.turnManager
              .getAvailableActions(newState)
              .filter(a => a.type === 'discard' && a.cards.length > 0)
              .map(a => a.cards[0].id)
          );

          if (allowedDiscardIds.has(action.cards[0].id)) {
            newState = this.markOrdinaryAction(
              this.openResponseWindow(this.actionHandlers.handleDiscard(newState, action.cards[0])),
            );
          }
        }
        break;

      case 'chi':
        if (action.cards?.length > 0) {
          newState = this.actionHandlers.handleChi(newState, action.playerId, action.cards, action.chiOptionId);
        }
        break;

      case 'peng':
        newState = this.actionHandlers.handlePeng(newState, action.playerId);
        break;

      case 'zhao':
        newState = this.actionHandlers.handleZhao(newState, action.playerId);
        break;

      case 'hu':
        {
          const current = newState.players[newState.currentPlayerIndex];
          const huActiveCard = newState.phase === GamePhase.RESPONSE_COLLECTING
            ? newState.discardPile.lastDiscard
            : undefined;
          const canClaimHu = !huActiveCard || canClaimActiveCard(
            newState,
            newState.currentPlayerIndex,
            huActiveCard,
            'hu',
          ).allowed;
          const canHuNow = canClaimHu && (
            this.rulesValidator.canHu(
              current.cards,
              current.melds,
              huActiveCard,
              newState.pendingCardSource,
              newState.ruleProfile,
            )
              || this.rulesValidator.getHuChiOptions(current.cards, current.melds, huActiveCard, newState.ruleProfile).length > 0
          );
          if (!canHuNow) {
            return {
              ...newState,
              availableActions: this.turnManager.getAvailableActions(newState),
            };
          }
        }
        newState = this.actionHandlers.handleHu(newState, action.playerId, false, action.huOptionId || action.chiOptionId);
        return newState; // 胡牌后游戏结束

      case 'bao':
        newState = newState.phase === GamePhase.DISCARDING
          ? this.handleDiscardToBao(newState, action.playerId, action.cards?.[0])
          : this.handleBaoChoice(newState, true);
        break;

      case 'pass_bao':
        newState = this.handleBaoChoice(newState, false);
        break;

      case 'pass':
        {
          let playerIndex = -1;
          let passedActionType: 'chi' | 'peng' | 'hu' | undefined;
          let sourcePlayerIndex: number | undefined;

          {
            playerIndex = newState.players.findIndex(p => p.playerId === action.playerId);
            const targetCard = newState.discardPile.lastDiscard;
            sourcePlayerIndex = newState.discardPile.lastDiscardPlayerIndex;

            if (newState.phase === GamePhase.RESPONSE_COLLECTING && playerIndex >= 0 && targetCard) {
              const chiCheck = this.actionHandlers.canPlayerChi(newState, playerIndex, targetCard);
              if (chiCheck.canChi) {
                passedActionType = 'chi';
              }
            }

            newState = this.actionHandlers.handlePass(newState, action.playerId, passedActionType);
          }

          // 响应阶段无人认领时，根据待响应来源推进流程
          if (newState.phase === GamePhase.RESPONSE_COLLECTING) {
            // 玩家（下家）对出牌来源（上家）过吃：进入该玩家（下家）自身翻牌阶段
            // 上家 = (playerIndex - 1 + N) % N
            const prevPlayerIndex = getPreviousPlayerIndex(playerIndex, newState.players.length);
            // 下家过吃后进入自身翻牌阶段（出牌和翻牌转移两种场景统一处理）
            const shouldKeepTurnForChiPass =
              passedActionType === 'chi' &&
              playerIndex >= 0 &&
              sourcePlayerIndex === prevPlayerIndex;

            // 翻牌者自身过吃：将吃牌权转给下家
            // 翻牌阶段 currentPlayerIndex = 翻牌者 = sourcePlayerIndex
            const shouldTransferSelfDrawChiPriority =
              passedActionType === 'chi' &&
              newState.pendingCardSource === 'draw' &&
              playerIndex >= 0 &&
              sourcePlayerIndex === playerIndex;

            if (shouldKeepTurnForChiPass) {
              // 下家过吃，进入下家自身翻牌阶段
              newState = {
                ...newState,
                currentPlayerIndex: playerIndex,
                turnCount: newState.turnCount + 1,
                phase: GamePhase.DRAWING,
                skipDiscardAfterZhao: false,
                pendingResponses: [],
                pendingCardSource: undefined,
              };
            } else if (shouldTransferSelfDrawChiPriority) {
              // 翻牌者过吃，吃权转给下家 (playerIndex + 1)
              const nextPlayerIndex = getNextPlayerIndex(playerIndex, newState.players.length);
              newState = {
                ...newState,
                currentPlayerIndex: nextPlayerIndex,
                pendingResponses: [],
              };
            } else {
              // 其他无人认领场景：进入下一家的翻牌阶段。
              newState = this.materializePendingDrawCard(newState);
              newState = this.turnManager.endTurn({
                ...newState,
                pendingCardSource: undefined
              });
            }
          } else if (newState.phase === GamePhase.DISCARDING) {
            // 八块跳过出牌，直接结束当前回合
            newState = this.turnManager.endTurn(newState);
          }
        }
        break;
    }

    // 应用过张清理策略
    newState = this.applyGuoZhangClearPolicy(newState);

    // 检查游戏是否结束
    const gameEndCheck = this.turnManager.checkGameEnd(newState);
    const maxTurns = this.currentConfig.maxTurns ?? 200;
    if (gameEndCheck.ended || newState.turnCount > maxTurns) {
      return {
        ...newState,
        phase: GamePhase.ENDED,
        isGameOver: true
      };
    }

    // 更新可用操作
    newState.availableActions = this.turnManager.getAvailableActions(newState);

    return newState;
  }

  /**
   * 结束游戏并准备下一局配置
   * R8.4.2: 胡牌者轮庄
   * R8.4.3: 流局庄家不变
   */
  endGame(state: GameState): GameConfig {
    const isDrawn = state.winnerIndex === undefined;
    const dealerIndex = state.players.findIndex(p => p.isDealer);

    return {
      ...this.currentConfig,
      lastDealerIndex: dealerIndex,
      lastGameDrawn: isDrawn,
      lastWinnerIndex: state.winnerIndex
    };
  }

  /**
   * 获取当前玩家
   */
  getCurrentPlayer(state: GameState): PlayerHand {
    return state.players[state.currentPlayerIndex];
  }

  /**
   * 移动到下一个回合
   */
  nextTurn(state: GameState): GameState {
    return this.turnManager.endTurn(state);
  }

  /**
   * 开始新回合
   */
  startTurn(state: GameState): GameState {
    return this.turnManager.startTurn(state);
  }

  /**
   * 检查游戏是否结束
   */
  checkGameEnd(state: GameState): { ended: boolean; winnerIndex?: number } {
    return this.turnManager.checkGameEnd(state);
  }

  /**
   * 获取可用操作
   */
  getAvailableActions(state: GameState): PlayerAction[] {
    const availableActions = this.turnManager.getAvailableActions(state);
    const actingPlayerIndex = this.getActingPlayerIndex(state);

    return availableActions.map(action => ({
      type: action.type as PlayerActionType,
      playerId: state.players[actingPlayerIndex].playerId,
      cards: action.cards,
      chiOptionId: action.chiOptions?.[0]?.id,
      huOptionId: action.huOptions?.[0]?.id,
      timestamp: Date.now()
    }));
  }

  /**
   * 更新游戏状态的可用操作（返回 AvailableAction[]）
   */
  updateAvailableActions(state: GameState): GameState {
    const availableActions = this.turnManager.getAvailableActions(state);
    return {
      ...state,
      availableActions
    };
  }

  /**
   * 验证游戏状态
   */
  validateState(state: GameState): { valid: boolean; errors: string[] } {
    return this.rulesValidator.validateGameState(state);
  }

  /**
   * 获取牌堆剩余数量
   */
  getDeckRemaining(): number {
    return this.deckManager.remainingCount(this.deck);
  }

  /**
   * 重置游戏（使用相同配置重新开始）
   */
  resetGame(state: GameState): GameState {
    const config: Partial<GameConfig> = {
      ...this.currentConfig,
      playerCount: 3,
    };

    return this.createGame(config);
  }

  /**
   * 开始下一局游戏（使用轮庄规则）
   */
  startNextGame(previousState: GameState): GameState {
    const nextConfig = this.endGame(previousState);
    return this.createGame(nextConfig);
  }
}

// 导出单例
export const gameManager = new GameManager();
