/**
 * 响应仲裁器
 * 实现规则 R7.2.1/2/3: 多玩家响应优先级+座次仲裁
 * 
 * 规则要点：
 * - R7.1.1 优先级：胡(1) > 招(2) > 碰(3) > 吃(4)
 * - R7.2.1 同级按座次仲裁
 * - R7.2.2 同优先级按三人逆时针座次，从当前玩家开始比较
 * - R7.2.3 唯一胡牌：仅一人可胡，同级座次先
 */

import { 
  GameState, 
  PlayerResponse, 
  ResponseType, 
  RESPONSE_PRIORITY 
} from '../shared/types';
import { getPreviousPlayerIndex, getTurnDistance } from './turn-order';

/**
 * 仲裁结果
 */
export interface ArbitrationResult {
  /** 获胜的响应 */
  winningResponse: PlayerResponse | null;
  /** 所有响应按仲裁排序 */
  sortedResponses: PlayerResponse[];
  /** 仲裁原因 */
  reason: string;
}

/**
 * 响应仲裁器类
 */
export class ResponseArbitrator {
  
  /**
   * 仲裁多个玩家的响应，确定最终执行的响应
   * @param state 游戏状态
   * @param responses 所有玩家的响应
   * @returns 仲裁结果
   */
  arbitrate(state: GameState, responses: PlayerResponse[]): ArbitrationResult {
    // 过滤掉pass响应
    const activeResponses = responses.filter(r => r.responseType !== 'pass');
    
    if (activeResponses.length === 0) {
      return {
        winningResponse: null,
        sortedResponses: responses,
        reason: '所有玩家均选择过'
      };
    }

    if (activeResponses.length === 1) {
      return {
        winningResponse: activeResponses[0],
        sortedResponses: responses,
        reason: '仅一人响应'
      };
    }

    // 按优先级+座次排序
    const sortedResponses = this.sortResponsesByPriorityAndSeat(
      activeResponses, 
      state.currentPlayerIndex,
      state.players.length
    );

    const winningResponse = sortedResponses[0];
    const reason = this.generateReason(winningResponse, sortedResponses);

    return {
      winningResponse,
      sortedResponses,
      reason
    };
  }

  /**
   * 按优先级和座次排序响应
   * R7.2.1: 优先级高者先
   * R7.2.2: 同优先级按座次，当前轮玩家起
   */
  private sortResponsesByPriorityAndSeat(
    responses: PlayerResponse[],
    currentPlayerIndex: number,
    playerCount: number
  ): PlayerResponse[] {
    return [...responses].sort((a, b) => {
      // 1. 先按优先级排序（数字小优先级高）
      const priorityA = RESPONSE_PRIORITY[a.responseType];
      const priorityB = RESPONSE_PRIORITY[b.responseType];
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // 2. 同优先级按座次排序（当前玩家优先）
      const seatOrderA = this.getSeatOrder(a.playerIndex, currentPlayerIndex, playerCount);
      const seatOrderB = this.getSeatOrder(b.playerIndex, currentPlayerIndex, playerCount);
      
      return seatOrderA - seatOrderB;
    });
  }

  /**
   * 获取玩家的座次顺序
   * 当前玩家索引为基准，计算相对顺序
   * 例：当前玩家为0，则顺序为 0→2→1。
   * 
   * @param playerIndex 目标玩家索引
   * @param currentPlayerIndex 当前轮玩家索引
   * @param playerCount 玩家总数
   * @returns 座次顺序（0最优先）
   */
  private getSeatOrder(
    playerIndex: number, 
    currentPlayerIndex: number, 
    playerCount: number
  ): number {
    // 计算相对于当前玩家的偏移
    return getTurnDistance(currentPlayerIndex, playerIndex, playerCount);
  }

  /**
   * 生成仲裁原因说明
   */
  private generateReason(
    winner: PlayerResponse, 
    allResponses: PlayerResponse[]
  ): string {
    const winnerPriority = RESPONSE_PRIORITY[winner.responseType];
    const samePriorityCount = allResponses.filter(
      r => RESPONSE_PRIORITY[r.responseType] === winnerPriority
    ).length;

    if (samePriorityCount === 1) {
      return `玩家${winner.playerIndex + 1}的${this.getActionName(winner.responseType)}优先级最高`;
    } else {
      return `多人${this.getActionName(winner.responseType)}，玩家${winner.playerIndex + 1}座次优先`;
    }
  }

  /**
   * 获取操作类型的中文名称
   */
  private getActionName(type: ResponseType): string {
    const names: Record<ResponseType, string> = {
      hu: '胡牌',
      zhao: '招牌',
      peng: '碰牌',
      chi: '吃牌',
      pass: '过'
    };
    return names[type] || type;
  }

  /**
   * 检查是否所有玩家都已响应
   * @param state 游戏状态
   * @returns 是否所有玩家都已响应
   */
  allPlayersResponded(state: GameState): boolean {
    const respondedPlayers = new Set(
      state.pendingResponses.map(r => r.playerIndex)
    );
    
    // 仅在“出牌来源”下，出牌者不需要响应自己的牌
    const discardPlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    const isDiscardSource = state.pendingCardSource === 'discard';
    
    for (let i = 0; i < state.players.length; i++) {
      // 跳过出牌者（R7.3.2: 自出牌不可响应）
      if (isDiscardSource && i === discardPlayerIndex) continue;
      
      if (!respondedPlayers.has(i)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * 添加玩家响应
   * @param state 游戏状态
   * @param response 玩家响应
   * @returns 更新后的游戏状态
   */
  addResponse(state: GameState, response: PlayerResponse): GameState {
    // 检查该玩家是否已经响应
    const existingIndex = state.pendingResponses.findIndex(
      r => r.playerIndex === response.playerIndex
    );

    const newResponses = [...state.pendingResponses];
    
    if (existingIndex >= 0) {
      // 替换已有响应
      newResponses[existingIndex] = response;
    } else {
      // 添加新响应
      newResponses.push(response);
    }

    return {
      ...state,
      pendingResponses: newResponses
    };
  }

  /**
   * 获取玩家可用的响应选项
   * @param state 游戏状态
   * @param playerIndex 玩家索引
   * @returns 可用的响应类型列表
   */
  getAvailableResponses(state: GameState, playerIndex: number): ResponseType[] {
    const responses: ResponseType[] = ['pass'];
    const player = state.players[playerIndex];
    const targetCard = state.discardPile.lastDiscard;

    if (!targetCard) return responses;

    // R7.3.2: 仅自己出的牌不可响应；自己翻牌可响应
    if (state.pendingCardSource === 'discard' && state.discardPile.lastDiscardPlayerIndex === playerIndex) {
      return responses;
    }

    // 检查胡牌 - 需要有规则验证器支持
    // if (canHu) responses.unshift('hu');

    // 检查招牌
    const sameCardsForZhao = player.cards.filter(c => 
      c.rank === targetCard.rank && c.size === targetCard.size
    );
    if (sameCardsForZhao.length >= 3) {
      responses.unshift('zhao');
    }

    // 检查碰牌
    const sameCardsForPeng = player.cards.filter(c => 
      c.rank === targetCard.rank && c.size === targetCard.size
    );
    if (!player.isBao && sameCardsForPeng.length >= 2) {
      responses.unshift('peng');
    }

    // 检查吃牌 - 逆时针相邻玩家可吃，自己翻牌可吃；自己过后才轮到相邻玩家
    const previousPlayerIndex = getPreviousPlayerIndex(playerIndex, state.players.length);
    const sourcePlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    const sourcePlayer = typeof sourcePlayerIndex === 'number' ? state.players[sourcePlayerIndex] : undefined;
    const sourcePlayerPassedThisCard = !!sourcePlayer && sourcePlayer.passedPlays.some(
      pp => (pp.actionType === 'chi' || pp.actionType === 'discard') &&
           pp.card.rank === targetCard.rank &&
           pp.card.size === targetCard.size,
    );
    const canChiBySource =
      (state.pendingCardSource === 'discard' && sourcePlayerIndex === previousPlayerIndex) ||
      (state.pendingCardSource === 'draw' && (
        sourcePlayerIndex === playerIndex ||
        (sourcePlayerPassedThisCard && sourcePlayerIndex === previousPlayerIndex)
      ));

    if (!player.isBao && canChiBySource) {
      // 还需要检查过张 (R4.3.3)
      const hasPassedThisCard = player.passedPlays.some(
        pp => (pp.actionType === 'chi' || pp.actionType === 'discard') &&
             pp.card.rank === targetCard.rank &&
             pp.card.size === targetCard.size
      );
      if (!hasPassedThisCard) {
        // 简化检查：假设可以吃（实际需要检查手牌）
        responses.unshift('chi');
      }
    }

    return responses;
  }
}

// 导出单例
export const responseArbitrator = new ResponseArbitrator();
