/**
 * 模拟对局相关类型
 */

import { Card, GameState, GameConfig, ResponseTimeoutAction } from './game';

/**
 * 玩家行动类型
 */
export type PlayerActionType =
  | 'draw'      // 摸牌
  | 'discard'   // 出牌
  | 'chi'       // 吃牌
  | 'peng'      // 碰牌
  | 'zhao'      // 招牌
  | 'hu'        // 胡牌
  | 'bao'       // 宣爆
  | 'pass_bao'  // 选择不爆
  | 'pass'      // 过/放弃
  | ResponseTimeoutAction;

/**
 * 玩家行动
 */
export interface PlayerAction {
  /** 行动类型 */
  type: PlayerActionType;
  /** 玩家ID */
  playerId: string;
  /** 涉及的牌 */
  cards: Card[];
  /** 吃牌方案ID（用于同一选牌下存在多种比牌方案时） */
  chiOptionId?: string;
  /** 胡牌方案ID（用于吃后可胡等需要落地具体方案的场景） */
  huOptionId?: string;
  /** 目标玩家ID（用于吃/碰/胡别人的牌） */
  targetPlayerId?: string;
  /** 时间戳 */
  timestamp: number;
  /** 响应窗口 ID；系统超时动作必须与当前窗口精确匹配。 */
  responseWindowId?: string;
  /** 仅 Bridge/核心内部可提交的系统动作标记。 */
  isSystem?: boolean;
}

/**
 * 发牌结果
 */
export interface DealResult {
  /** 玩家手牌 */
  hands: Card[][];
  /** 庄家索引 */
  dealerIndex: number;
  /** 剩余牌堆 */
  remainingDeck: Card[];
  /** 庄家起手待处理的第21张牌 */
  dealerPendingCard?: Card;
}

/**
 * 模拟结果
 */
export interface SimulationResult {
  /** 游戏是否完成 */
  completed: boolean;
  /** 获胜玩家索引 */
  winnerIndex?: number;
  /** 总回合数 */
  totalTurns: number;
  /** 游戏历史 */
  history: {
    state: GameState;
    action: PlayerAction;
  }[];
  /** 最终得分 */
  scores: number[];
}

/**
 * 模拟配置
 */
export interface SimulationConfig {
  /** 玩家数量 */
  playerCount: 3;
  /** 覆盖游戏配置 */
  gameConfig?: Partial<GameConfig>;
  /** AI玩家索引列表 */
  aiPlayers: number[];
  aiModeByPlayer?: Partial<Record<number, 'fast' | 'medium' | 'learned'>>;
  /** 最大回合数（防止无限循环） */
  maxTurns?: number;
  /** 是否记录详细历史 */
  recordHistory?: boolean;
  /** 随机种子（用于可重现的模拟） */
  seed?: number;
}

/**
 * 游戏日志
 */
export interface GameLog {
  /** 时间戳 */
  timestamp: number;
  /** 回合数 */
  turn: number;
  /** 玩家ID */
  playerId: string;
  /** 行动 */
  action: PlayerAction;
  /** 描述 */
  description: string;
}

/**
 * 游戏统计
 */
export interface GameStats {
  /** 总游戏数 */
  totalGames: number;
  /** 各玩家胜场 */
  wins: number[];
  /** 各玩家胜率 */
  winRates: number[];
  /** 平均回合数 */
  averageTurns: number;
  /** 各玩家平均得分 */
  averageScores: number[];
}
