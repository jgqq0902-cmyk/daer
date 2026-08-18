/**
 * 正式响应窗口的兼容适配器。
 *
 * 生产流程由 GameManager + Bridge 的 ResponseWindow 定时器推进；本类只
 * 保留旧测试/调用方需要的 PlayerResponse 形状，并委托 TurnManager 生成
 * 当前响应者的合法动作，避免维护第二套碰/招规则。
 */

import {
  GameState,
  GameConfig,
  PlayerResponse,
  ResponseType,
  GamePhase,
  ResponseTimeoutAction,
} from '../shared/types';
import { TurnManager } from './turn-manager';

export interface TimeoutCheckResult {
  /** 是否超时 */
  isTimeout: boolean;
  /** 超时玩家索引列表 */
  timeoutPlayers: number[];
  /** 自动响应列表 */
  autoResponses: PlayerResponse[];
}

/**
 * @deprecated 正式运行时请提交 `ResponseWindow.timeoutAction` 对应的
 * `timeout_*` 系统动作给 GameManager；该类仅作为旧 PlayerResponse API 的
 * 兼容 façade。
 */
export class TimeoutHandler {
  private readonly turnManager: TurnManager;

  constructor(turnManager: TurnManager = new TurnManager()) {
    this.turnManager = turnManager;
  }

  /**
   * 检查响应是否超时。
   * `now` 可注入，避免测试依赖真实等待；正式 Bridge 使用 ResponseWindow
   * 自己保存的绝对 deadlineAt。
   */
  checkTimeout(
    state: GameState,
    config: GameConfig,
    responseStartTime: number,
    now: number = Date.now(),
  ): TimeoutCheckResult {
    const deadlineAt = state.responseWindow?.deadlineAt ?? responseStartTime + config.responseTimeout;
    if (now < deadlineAt) {
      return {
        isTimeout: false,
        timeoutPlayers: [],
        autoResponses: [],
      };
    }

    const respondedPlayers = new Set(
      (state.responseWindow?.responses || state.pendingResponses).map((response) => response.playerIndex),
    );
    const discardPlayerIndex = state.discardPile.lastDiscardPlayerIndex;
    const targetCard = state.responseWindow?.activeCard || state.discardPile.lastDiscard;
    const currentResponderIndex = state.responseWindow?.currentResponderIndex;
    const candidateIndices = typeof currentResponderIndex === 'number'
      ? [currentResponderIndex]
      : state.players.map((_, index) => index);
    const timeoutPlayers: number[] = [];
    const autoResponses: PlayerResponse[] = [];

    for (const playerIndex of candidateIndices) {
      if (playerIndex === discardPlayerIndex || respondedPlayers.has(playerIndex)) {
        continue;
      }

      timeoutPlayers.push(playerIndex);
      autoResponses.push(this.generateAutoResponse(state, playerIndex, targetCard, now));
    }

    return {
      isTimeout: true,
      timeoutPlayers,
      autoResponses,
    };
  }

  /**
   * 使用正式 TurnManager 的 availableActions 生成兼容响应，不自行判定碰/招。
   */
  private generateAutoResponse(
    state: GameState,
    playerIndex: number,
    targetCard: GameState['discardPile']['lastDiscard'],
    timestamp: number,
  ): PlayerResponse {
    const responseState: GameState = {
      ...state,
      phase: GamePhase.RESPONSE_COLLECTING,
      currentPlayerIndex: playerIndex,
      pendingCardSource: state.pendingCardSource || 'discard',
      responseWindow: state.responseWindow
        ? { ...state.responseWindow, currentResponderIndex: playerIndex }
        : undefined,
    };
    const offeredActions = this.turnManager.getAvailableActions(responseState);
    const timeoutType = this.normalizeTimeoutType(state.responseWindow?.timeoutAction);
    const forcedAction = offeredActions.find((action) =>
      action.isMandatory && (action.type === 'zhao' || action.type === 'peng'));
    const selectedType = timeoutType && offeredActions.some((action) => action.type === timeoutType)
      ? timeoutType
      : forcedAction?.type;
    const responseType: ResponseType = selectedType === 'zhao' || selectedType === 'peng'
      ? selectedType
      : 'pass';

    return {
      playerIndex,
      responseType,
      cards: targetCard ? [targetCard] : [],
      timestamp,
    };
  }

  private normalizeTimeoutType(timeoutAction?: ResponseTimeoutAction): 'peng' | 'zhao' | 'pass' | undefined {
    if (timeoutAction === 'timeout_peng') return 'peng';
    if (timeoutAction === 'timeout_zhao') return 'zhao';
    if (timeoutAction === 'timeout_pass') return 'pass';
    return undefined;
  }

  /**
   * 验证响应窗口时间配置。
   */
  validateResponseTimeout(timeout: number, config: GameConfig): number {
    if (timeout < config.minResponseTimeout) {
      return config.minResponseTimeout;
    }
    if (timeout > config.maxResponseTimeout) {
      return config.maxResponseTimeout;
    }
    return timeout;
  }

  /**
   * 旧调用方的纯状态适配，不参与正式 GameManager 推进。
   */
  applyTimeoutResponses(
    state: GameState,
    autoResponses: PlayerResponse[],
  ): GameState {
    let newState = { ...state };

    for (const response of autoResponses) {
      const existingIndex = newState.pendingResponses.findIndex(
        (item) => item.playerIndex === response.playerIndex,
      );
      const newResponses = [...newState.pendingResponses];

      if (existingIndex >= 0) {
        newResponses[existingIndex] = response;
      } else {
        newResponses.push(response);
      }

      newState = {
        ...newState,
        pendingResponses: newResponses,
      };
    }

    return newState;
  }
}

/** @deprecated 使用 GameManager 的 ResponseWindow 定时器。 */
export const timeoutHandler = new TimeoutHandler();
