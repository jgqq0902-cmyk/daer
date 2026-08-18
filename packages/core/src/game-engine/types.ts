/**
 * 游戏引擎内部类型
 */

import { Card, Meld, MingTang } from '../shared/types';

/**
 * 牌型检测结果
 */
export interface MeldDetectionResult {
  melds: Meld[];
  remaining: Card[];
}

/**
 * 计分结果
 */
export interface ScoreResult {
  totalHuPoints: number;
  baseScore: number;
  meldScores: {
    meld: Meld;
    score: number;
  }[];
  bonusPoints: number;
  mingtangs: MingTang[];
  totalFans: number;
  roundScore: number;
  finalScore: number;
}

/**
 * 手牌分析结果
 */
export interface HandAnalysis {
  melds: Meld[];
  potentialMelds: Meld[];
  looseCards: Card[];
  tingCards: Card[];
  tingPositions: number[];
  lockedCardIds?: string[];
  lockedCountsByCode?: Record<string, number>;
  /** 是否可以胡牌 */
  canWin?: boolean;
  /** 总胡息 */
  totalHuPoints?: number;
  /** 手牌完整度 (0-1) */
  completeness?: number;
  /** 距离胡牌的步数 */
  stepsToWin?: number;
}

/**
 * 牌组统计
 */
export interface HandStats {
  pairs: number;
  triples: number;
  quadruples: number;
  sequences: number;
  special2710: number;
}
