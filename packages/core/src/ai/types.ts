/**
 * AI 服务内部类型
 */

import { Card } from '../shared/types';

// 从共享类型中重新导出，供 ai-analyzer 等模块使用
export type { AIPlayRecommendation, AIRankedAction, AIDecisionEvidence, AITeachingTag, ActionScoreBreakdown, AITutorTrace, AITutorDimensionTrace } from '../shared/types/ai';

/**
 * 模拟结果
 */
export interface SimulationResult {
  win: boolean;
  score: number;
  turns: number;
}

/**
 * 牌组概率
 */
export interface CardProbability {
  card: Card;
  probability: number;
}

/**
 * 模拟状态
 */
export interface SimulationState {
  deck: Card[];
  players: Card[][];
  currentPlayer: number;
}
