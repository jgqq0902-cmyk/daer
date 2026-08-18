/**
 * 行动处理器
 * 处理玩家的各种游戏行动
 * 
 * 实现规则：
 * - R4.3.1 只吃下家（牌局按逆时针进行）
 * - R4.3.3 过张不可吃
 * - R5.3.1/2 点炮/自摸计分
 * - R7.8.1/2 比牌规则
 */

import {
  GameState,
  GamePhase,
  Card,
  Meld,
  MeldType,
  WinType,
  PassedPlay,
  GameConfig,
  DEFAULT_GAME_CONFIG,
} from '../shared/types';
import { deckManager } from './deck-manager';
import { MeldDetector } from './meld-detector';
import { ScoreCalculator } from './score-calculator';
import { RulesValidator } from './rules-validator';
import { hasPassedCard } from './passed-play';
import { getNextPlayerIndex, getPreviousPlayerIndex } from './turn-order';
import { hasEightBlocks } from '../shared/constants';
import { canDeclareHeavenlyWin, isFirstMountainFlipWin, openingMingTangContext } from './opening-facts';

/**
 * 行动处理器类
 */
export class ActionHandlers {
  private meldDetector: MeldDetector;
  private scoreCalculator: ScoreCalculator;
  private rulesValidator: RulesValidator;
  private gameConfig: GameConfig;

  constructor() {
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
    this.rulesValidator = new RulesValidator();
    this.gameConfig = DEFAULT_GAME_CONFIG;
  }

  setConfig(config: GameConfig): void {
    this.gameConfig = config;
  }

  private hasShaBao(state: GameState, winnerIndex: number): boolean {
    return state.players.some((player, index) => index !== winnerIndex && !!player.isBao);
  }

  /**
   * 处理摸牌（翻牌）
   */
  handleDraw(state: GameState, deck: Card[]): { state: GameState; drawnCard?: Card } {
    // 从牌堆摸牌
    const drawnCard = deckManager.draw(deck);
    if (!drawnCard) {
      // 牌堆空，游戏可能结束
      return { state };
    }

    // 规则流程：翻牌先进入待响应区，不直接进手牌
    const newDiscardPile = {
      ...state.discardPile,
      lastDiscard: drawnCard,
      lastDiscardPlayerIndex: state.currentPlayerIndex
    };

    return {
      state: {
        ...state,
        discardPile: newDiscardPile,
        phase: GamePhase.RESPONSE_COLLECTING,
        pendingCardSource: 'draw',
        skipDiscardAfterZhao: false,
        pendingResponses: [],
        remainingDeckCards: deckManager.remainingCount(deck)
      },
      drawnCard
    };
  }

  /**
   * 处理出牌
   * R8.3.2: 八块玩家可以跳过出牌
   */
  handleDiscard(state: GameState, card: Card): GameState {
    const currentPlayer = state.players[state.currentPlayerIndex];

    // 从手牌移除
    const newCards = currentPlayer.cards.filter(c => c.id !== card.id);

    // 添加到弃牌堆，记录出牌者索引
    const newDiscardPile = {
      ...state.discardPile,
      cards: [...state.discardPile.cards, card],
      discardHistory: [
        ...(state.discardPile.discardHistory || []),
        {
          card,
          sourcePlayerIndex: state.currentPlayerIndex,
          playerIndex: state.currentPlayerIndex,
          source: 'discard' as const,
          sequence: (state.discardPile.discardHistory || []).length + 1,
        }
      ],
      lastDiscard: card,
      lastDiscardPlayerIndex: state.currentPlayerIndex
    };

    // 更新玩家状态
    const updatedPlayers = [...state.players];
    const discardAsPassed: PassedPlay = {
      card,
      timestamp: Date.now(),
      actionType: 'discard'
    };
    updatedPlayers[state.currentPlayerIndex] = {
      ...currentPlayer,
      cards: newCards,
      // 新增规则：玩家自己打出过的牌也纳入过张，不可再吃同名牌
      passedPlays: [...currentPlayer.passedPlays, discardAsPassed]
    };

    // 转换到可以吃/碰/胡的阶段，清空待处理响应
    // currentPlayerIndex 保持出牌者，响应阶段结束后 endTurn 推进到下家
    return {
      ...state,
      players: updatedPlayers,
      discardPile: newDiscardPile,
      phase: GamePhase.RESPONSE_COLLECTING,
      skipDiscardAfterZhao: false,
      pendingResponses: [],
      pendingCardSource: 'discard'
    };
  }

  /**
   * R8.3.2: 检查玩家是否可以跳过出牌（八块特权）
   */
  canSkipDiscard(state: GameState, playerIndex: number): boolean {
    return state.currentPlayerIndex === playerIndex && !!state.skipDiscardAfterZhao;
  }

  /**
   * R8.3.2: 处理八块跳过出牌
   */
  handleSkipDiscard(state: GameState): GameState {
    if (!state.skipDiscardAfterZhao) {
      return state;
    }

    // 直接进入下一玩家的翻牌阶段
    return this.nextPlayer(state);
  }

  /**
  * 检查是否可以吃牌（包含R4.3.1只吃下家、R4.3.3过张规则）
   * @param state 游戏状态
   * @param playerIndex 想要吃牌的玩家索引
   * @param targetCard 目标牌
   * @returns 是否可以吃牌及原因
   */
  canPlayerChi(state: GameState, playerIndex: number, targetCard: Card): { canChi: boolean; reason?: string } {
    const player = state.players[playerIndex];
    const discardPlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    // 自摸：翻牌来源是自己（用 lastDiscardPlayerIndex 判断，不依赖 currentPlayerIndex，
    // 因为翻牌者过吃后 currentPlayerIndex 已切换到下家）
    const isSelfDrawCard = state.pendingCardSource === 'draw' && playerIndex === discardPlayerIndex;
    const sourcePlayer = typeof discardPlayerIndex === 'number' ? state.players[discardPlayerIndex] : undefined;
    const sourcePlayerPassedThisCard = !!sourcePlayer && hasPassedCard(sourcePlayer, targetCard);

    if (player.isBao) {
      return { canChi: false, reason: '爆牌后不能吃牌' };
    }

    if (
      state.pendingCardSource === 'draw' &&
      !isSelfDrawCard &&
      discardPlayerIndex !== undefined
    ) {
      // 翻牌转移后，逆时针相邻玩家可吃；但翻牌者必须已经 pass（passedPlays 有记录）
      if (!sourcePlayerPassedThisCard) {
        return { canChi: false, reason: '翻牌者需先决定是否吃牌' };
      }
      // 仅翻牌者的逆时针相邻玩家（其顺序前一座位）可吃
      const expectedPrevForDraw = getPreviousPlayerIndex(playerIndex, state.players.length);
      if (discardPlayerIndex !== expectedPrevForDraw) {
        return { canChi: false, reason: '只有翻牌者的下家才能吃' };
      }
    }

    // R4.3.1 + V3: 只能吃上家打出的牌，或自己翻出的牌
    // 玩家i的上家是逆时针座次序列中的前一座位。
    if (!isSelfDrawCard && discardPlayerIndex !== undefined) {
      const expectedPrevPlayer = getPreviousPlayerIndex(playerIndex, state.players.length);
      if (discardPlayerIndex !== expectedPrevPlayer) {
        return { canChi: false, reason: '只能吃上家的牌或自己翻的牌' };
      }
    }

    // R4.3.3: 过张不可吃 - 检查是否已过张
    const hasPassedThisCard = hasPassedCard(player, targetCard);
    if (hasPassedThisCard) {
      return { canChi: false, reason: '已过张，不能再吃此牌' };
    }

    const chiOptions = this.rulesValidator.getValidChiOptions(player.cards, targetCard);
    if (chiOptions.length === 0) {
      return { canChi: false, reason: '手牌无法组成顺子' };
    }

    // 不能拆坎/垅：必须存在一组不使用坎牌/垅牌的合法吃法
    const validSelection = chiOptions[0]?.selectedCards;
    if (!validSelection) {
      return { canChi: false, reason: '不能拆坎/垅吃牌' };
    }

    return { canChi: true };
  }

  /**
   * 处理吃牌（含R4.3.1、R4.3.3、R7.8规则）
   */
  handleChi(state: GameState, playerId: string, cards: Card[], chiOptionId?: string): GameState {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) return state;

    const player = state.players[playerIndex];
    const targetCard = state.discardPile.lastDiscard;

    if (!targetCard) return state;

    // R4.3.1 & R4.3.3: 检查是否可以吃牌
    const chiCheck = this.canPlayerChi(state, playerIndex, targetCard);
    if (!chiCheck.canChi) {
      // 吃牌被拒绝: ${chiCheck.reason}
      return state;
    }

    // 吃牌必须使用“手牌中的2张”与 ActiveCard 组成合法三张列。
    // AI 可能仅传入占位卡，此处回退自动选择第一组合法组合，避免2张/非法组进入置牌区。
    const chiOptions = this.rulesValidator.getValidChiOptions(player.cards, targetCard);
    let selectedOption = chiOptionId
      ? chiOptions.find((option) => option.id === chiOptionId)
      : undefined;

    if (!selectedOption) {
      selectedOption = chiOptions.find((option) => this.isSameSelection(option.selectedCards, cards));
    }

    if (!selectedOption) {
      selectedOption = chiOptions[0];
      if (!selectedOption) {
        return state;
      }
    }

    const selectedCards = selectedOption.selectedCards;

    const allChiCards = [...selectedCards, targetCard];
    const displayChiCards = [targetCard, ...selectedCards];
    const chiMeldType = this.rulesValidator.detectChiMeldType(allChiCards);
    if (!chiMeldType) {
      return state;
    }

    // 若来源是出牌，则从弃牌堆移除最后一张；若来源是翻牌，不改弃牌历史
    const isFromDiscard = state.pendingCardSource === 'discard';
    const newDiscardPile = {
      ...state.discardPile,
      cards: isFromDiscard ? state.discardPile.cards.slice(0, -1) : state.discardPile.cards,
      discardHistory: isFromDiscard
        ? (state.discardPile.discardHistory || []).slice(0, -1)
        : state.discardPile.discardHistory,
      lastDiscard: isFromDiscard
        ? state.discardPile.cards[state.discardPile.cards.length - 2] || undefined
        : undefined,
      lastDiscardPlayerIndex: undefined
    };

    // 创建吃牌组合
    const meld: Meld = {
      type: chiMeldType,
      cards: displayChiCards,
      isConcealed: false,
      position: 'table',
      huPoints: 0
    };
    meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);

    // 合并所有牌型（原吃牌+比牌额外形成的）
    const allMelds = [meld, ...selectedOption.additionalMelds];

    // 更新玩家状态
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = {
      ...player,
      cards: selectedOption.remainingCards,
      melds: [...player.melds, ...allMelds],
      chiHistory: [...player.chiHistory, targetCard]
    };

    // 切换到出牌玩家
    return {
      ...state,
      players: updatedPlayers,
      discardPile: newDiscardPile,
      currentPlayerIndex: playerIndex,
      phase: GamePhase.DISCARDING,
      skipDiscardAfterZhao: false,
      pendingResponses: [],
      pendingCardSource: undefined
    };
  }

  private isValidChiSelection(handCards: Card[], selectedCards: Card[] | undefined, targetCard: Card): boolean {
    if (!selectedCards || selectedCards.length !== 2) return false;

    const selectedIds = selectedCards.map(c => c.id);
    if (new Set(selectedIds).size !== 2) return false;

    const handIds = new Set(handCards.map(c => c.id));
    if (!selectedIds.every(id => handIds.has(id))) return false;

    const lockedCardIds = this.getLockedMeldCardIds(handCards);
    if (selectedCards.some(c => lockedCardIds.has(c.id))) return false;

    const meldCards = [...selectedCards, targetCard];
    const meldType = this.rulesValidator.detectChiMeldType(meldCards);
    if (!meldType) return false;

    return this.rulesValidator.isValidMeld(meldCards, meldType);
  }

  private findFirstValidChiSelection(handCards: Card[], targetCard: Card): Card[] | null {
    return this.rulesValidator.getValidChiOptions(handCards, targetCard)[0]?.selectedCards || null;
  }

  private isSameSelection(left: Card[] | undefined, right: Card[] | undefined): boolean {
    if (!left || !right || left.length !== right.length) {
      return false;
    }

    const leftIds = left.map(card => card.id).sort();
    const rightIds = right.map(card => card.id).sort();
    return leftIds.every((id, index) => id === rightIds[index]);
  }

  private getLockedMeldCardIds(handCards: Card[]): Set<string> {
    const locked = new Set<string>();
    const triples = this.meldDetector.detectTriples(handCards).melds;
    const quads = this.meldDetector.detectQuadruples(handCards).melds;

    for (const meld of [...triples, ...quads]) {
      for (const card of meld.cards) {
        locked.add(card.id);
      }
    }

    return locked;
  }

  /**
   * 处理碰牌
   */
  handlePeng(state: GameState, playerId: string): GameState {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) return state;

    const player = state.players[playerIndex];
    const targetCard = state.discardPile.lastDiscard;

    if (!targetCard) return state;

    const isFromDiscard = state.pendingCardSource === 'discard';
    const newDiscardPile = {
      ...state.discardPile,
      cards: isFromDiscard ? state.discardPile.cards.slice(0, -1) : state.discardPile.cards,
      discardHistory: isFromDiscard
        ? (state.discardPile.discardHistory || []).slice(0, -1)
        : state.discardPile.discardHistory,
      lastDiscard: isFromDiscard
        ? state.discardPile.cards[state.discardPile.cards.length - 2] || undefined
        : undefined,
      lastDiscardPlayerIndex: undefined
    };

    // 找到两张相同的牌
    const sameCards = player.cards.filter(c =>
      c.rank === targetCard.rank && c.size === targetCard.size
    ).slice(0, 2);

    // 创建碰牌组合
    const meld: Meld = {
      type: MeldType.PENG,
      cards: [...sameCards, targetCard],
      isConcealed: false,
      position: 'table',
      huPoints: 0
    };
    meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);

    // 从手牌移除
    const remainingCards = player.cards.filter(c =>
      !sameCards.some(sc => sc.id === c.id)
    );

    // 更新玩家状态
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = {
      ...player,
      cards: remainingCards,
      melds: [...player.melds, meld]
    };

    return {
      ...state,
      players: updatedPlayers,
      discardPile: newDiscardPile,
      currentPlayerIndex: playerIndex,
      phase: GamePhase.DISCARDING,
      skipDiscardAfterZhao: false,
      pendingResponses: [],
      pendingCardSource: undefined
    };
  }

  /**
   * 处理招牌
   */
  handleZhao(state: GameState, playerId: string): GameState {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) return state;

    const player = state.players[playerIndex];
    const targetCard = state.discardPile.lastDiscard;

    if (!targetCard) return state;

    const isFromDiscard = state.pendingCardSource === 'discard';
    const newDiscardPile = {
      ...state.discardPile,
      cards: isFromDiscard ? state.discardPile.cards.slice(0, -1) : state.discardPile.cards,
      discardHistory: isFromDiscard
        ? (state.discardPile.discardHistory || []).slice(0, -1)
        : state.discardPile.discardHistory,
      lastDiscard: isFromDiscard
        ? state.discardPile.cards[state.discardPile.cards.length - 2] || undefined
        : undefined,
      lastDiscardPlayerIndex: undefined
    };

    // 找到三张相同的牌
    const sameCards = player.cards.filter(c =>
      c.rank === targetCard.rank && c.size === targetCard.size
    ).slice(0, 3);

    // 创建招牌组合
    const meld: Meld = {
      type: MeldType.DRAW_QUADRUPLE,
      cards: [...sameCards, targetCard],
      isConcealed: false,
      position: 'table',
      huPoints: 0
    };
    meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);

    // 从手牌移除
    const remainingCards = player.cards.filter(c =>
      !sameCards.some(sc => sc.id === c.id)
    );

    // 检查是否形成八块
    const allMelds = [...player.melds, meld];
    const hasEight = hasEightBlocks(
      allMelds.filter(m => m.type === MeldType.QUADRUPLE).length,
      allMelds.filter(m => m.type === MeldType.DRAW_QUADRUPLE).length
    );

    // 更新玩家状态
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = {
      ...player,
      cards: remainingCards,
      melds: allMelds,
      hasEightBlocks: hasEight
    };

    return {
      ...state,
      players: updatedPlayers,
      discardPile: newDiscardPile,
      currentPlayerIndex: playerIndex,
      phase: GamePhase.DISCARDING,
      skipDiscardAfterZhao: hasEight || !!player.isBao,
      pendingResponses: [],
      pendingCardSource: undefined
    };
  }

  /**
   * 处理胡牌（R5.3.1/2 点炮/自摸计分）
   * @param state 游戏状态
   * @param playerId 胡牌玩家ID
   * @param isSelfDraw 是否自摸（翻牌胡）
   */
  handleHu(state: GameState, playerId: string, isSelfDraw: boolean = false, huOptionId?: string): GameState {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) return state;

    const player = state.players[playerIndex];

    // 获取并合并手牌中成胡的牌组
    const activeCard = state.phase === GamePhase.RESPONSE_COLLECTING 
      ? state.discardPile.lastDiscard 
      : undefined;
    let effectiveHandCards = activeCard ? [...player.cards, activeCard] : player.cards;
    let landedMelds = [...player.melds];

    if (activeCard) {
      const huChiOptions = this.rulesValidator.getHuChiOptions(player.cards, player.melds, activeCard, state.ruleProfile);
      const resolvedHuOption = huOptionId
        ? huChiOptions.find((option) => option.id === huOptionId)
        : huChiOptions[0];

      if (resolvedHuOption) {
        const mainMeldType = this.rulesValidator.detectChiMeldType(resolvedHuOption.mainMeldCards);
        if (mainMeldType) {
          const mainMeld: Meld = {
            type: mainMeldType,
            cards: resolvedHuOption.mainMeldCards,
            isConcealed: false,
            position: 'table',
            huPoints: 0,
          };
          mainMeld.huPoints = this.scoreCalculator.calculateMeldHuPoints(mainMeld);
          effectiveHandCards = resolvedHuOption.remainingCards;
          landedMelds = [...player.melds, mainMeld, ...resolvedHuOption.additionalMelds];
        }
      }
    }

    const heavenlyWinCards = activeCard ? [...player.cards, activeCard] : player.cards;

    const winningHandMelds = this.rulesValidator.findWinningHandMelds(
      effectiveHandCards,
      landedMelds,
      activeCard,
      state.pendingCardSource,
      state.ruleProfile,
    );
    if (!winningHandMelds) {
      return state;
    }
    const finalMelds = winningHandMelds ? [...landedMelds, ...winningHandMelds] : landedMelds;

    // 计算基础胡息 (使用所有碰、吃牌和手牌牌型的总和)
    const openingFacts = openingMingTangContext(state, playerIndex);
    const isHeavenlyWin = canDeclareHeavenlyWin(openingFacts)
      && this.rulesValidator.checkHeavenlyWin(heavenlyWinCards);
    const isDrawResponseWin = state.pendingCardSource === 'draw' && state.discardPile.lastDiscardPlayerIndex === playerIndex;
    const isActualSelfDraw = isSelfDraw || isDrawResponseWin;
    const isDiscardWin = !isActualSelfDraw
      && state.discardPile.lastDiscardPlayerIndex !== undefined
      && state.discardPile.lastDiscardPlayerIndex !== playerIndex
      && state.pendingCardSource !== 'draw';
    const isBaoWin = !!player.isBao;
    const isShaBao = this.hasShaBao(state, playerIndex);
    const scoreResult = this.scoreCalculator.calculateTotalScore(finalMelds, {
      winType: isActualSelfDraw ? WinType.SELF_DRAW : undefined,
      isHeavenlyWin,
      isFirstDrawWin: isDrawResponseWin && isFirstMountainFlipWin(openingFacts, state.drawOrdinal || 0),
      isLastDrawWin: isDrawResponseWin && state.remainingDeckCards === 0,
      isBaoWin,
      isShaBao,
      enabledMingTangTypes: this.gameConfig.enabledMingTangTypes,
    });
    const { totalHuPoints, baseScore, finalScore, roundScore, mingtangs, totalFans } = scoreResult;


    // R5.3.1/2: 根据胡牌方式计算得分
    const winType = isDiscardWin ? WinType.DISCARD : WinType.SELF_DRAW;
    const settlementScore = finalScore;
    
    // 确定点炮者（如果是点炮胡）
    let dianpaoPlayerIndex: number | undefined;
    if (isDiscardWin && state.discardPile.lastDiscardPlayerIndex !== undefined) {
      dianpaoPlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    }

    // 更新所有玩家分数
    const updatedPlayers = [...state.players];
    
    if (isDiscardWin) {
      const payment = settlementScore * 2;
      for (let i = 0; i < updatedPlayers.length; i++) {
        if (i === playerIndex) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            melds: finalMelds,
            cards: [],
            totalScore: payment
          };
        } else if (i === dianpaoPlayerIndex) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            totalScore: -payment
          };
        }
      }
    } else {
      const winnerGain = settlementScore * 2;
      for (let i = 0; i < updatedPlayers.length; i++) {
        if (i === playerIndex) {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            melds: finalMelds,
            cards: [],
            totalScore: winnerGain
          };
        } else {
          updatedPlayers[i] = {
            ...updatedPlayers[i],
            totalScore: -settlementScore
          };
        }
      }
    }

    return {
      ...state,
      players: updatedPlayers,
      phase: GamePhase.ENDED,
      isGameOver: true,
      skipDiscardAfterZhao: false,
      winnerIndex: playerIndex,
      winType,
      dianpaoPlayerIndex,
      winningMingTangs: mingtangs,
      totalFans,
      winningHuPoints: totalHuPoints,
      winningBaseScore: baseScore,
      winningRoundScore: roundScore,
      pendingResponses: [],
      pendingCardSource: undefined
    };
  }

  /**
   * 处理过/放弃（记录过张）
   * @param state 游戏状态
   * @param playerId 玩家ID
   * @param passedActionType 放弃的操作类型（用于R4.3.3过张记录）
   */
  handlePass(state: GameState, playerId: string, passedActionType?: 'chi' | 'peng' | 'hu'): GameState {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    
    // 如果是吃牌被放弃，记录过张
    if (passedActionType === 'chi' && state.discardPile.lastDiscard) {
      if (playerIndex < 0 || !this.canPlayerChi(state, playerIndex, state.discardPile.lastDiscard).canChi) {
        return state;
      }

      const updatedPlayers = [...state.players];
      const player = updatedPlayers[playerIndex];
      
      const passedPlay: PassedPlay = {
        card: state.discardPile.lastDiscard,
        timestamp: Date.now(),
        actionType: 'chi'
      };

      updatedPlayers[playerIndex] = {
        ...player,
        passedPlays: [...player.passedPlays, passedPlay]
      };

      return {
        ...state,
        players: updatedPlayers
      };
    }

    return state;
  }

  /**
   * 移动到下一个玩家
   */
  nextPlayer(state: GameState): GameState {
    const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, state.players.length);

    return {
      ...state,
      currentPlayerIndex: nextIndex,
      phase: GamePhase.DRAWING,
      skipDiscardAfterZhao: false,
      pendingResponses: [],
      pendingCardSource: undefined
    };
  }
}
