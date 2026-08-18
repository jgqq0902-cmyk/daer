/**
 * 计分规则常量
 * 泸州大贰胡息计算表
 */

import { MeldType, MingTangType } from '../types';
import { CardSize, CardColor } from '../types';

/**
 * 胡息计算表
 */
export const HU_POINTS_TABLE: Readonly<Record<MeldType, {
  blackSmall: number;
  redSmall: number;
  blackBig: number;
  redBig: number;
}>> = {
  [MeldType.PAIR]: {
    blackSmall: 0,
    redSmall: 0,
    blackBig: 0,
    redBig: 0
  },
  [MeldType.PENG]: {
    blackSmall: 1,
    redSmall: 6,
    blackBig: 3,
    redBig: 9
  },
  [MeldType.TRIPLE]: {
    blackSmall: 6,
    redSmall: 9,
    blackBig: 9,
    redBig: 12
  },
  [MeldType.DRAW_QUADRUPLE]: {
    blackSmall: 9,
    redSmall: 12,
    blackBig: 12,
    redBig: 15
  },
  [MeldType.QUADRUPLE]: {
    blackSmall: 12,
    redSmall: 15,
    blackBig: 15,
    redBig: 18
  },
  [MeldType.SEQUENCE]: {
    blackSmall: 0,
    redSmall: 0,
    blackBig: 0,
    redBig: 0
  },
  [MeldType.SPECIAL_2710]: {
    blackSmall: 0,
    redSmall: 6,
    blackBig: 0,
    redBig: 9
  },
  [MeldType.MIXED_SIZE]: {
    blackSmall: 0,
    redSmall: 0,
    blackBig: 0,
    redBig: 0
  }
} as const;

/**
 * 特殊吃牌顺子的胡息
 */
export const SPECIAL_SEQUENCE_HU: Readonly<{
  small123: number;
  small2710: number;
  big123: number;
  big2710: number;
}> = {
  small123: 3,
  small2710: 6,
  big123: 6,
  big2710: 9
} as const;

/**
 * 判断牌的组合类型用于计分
 */
export interface ScoreCardInfo {
  size: CardSize;
  color: CardColor;
}

/**
 * 获取牌型的胡息
 */
export function getHuPoints(
  meldType: MeldType,
  cardInfo: ScoreCardInfo
): number {
  const table = HU_POINTS_TABLE[meldType];

  if (cardInfo.size === CardSize.SMALL) {
    return cardInfo.color === CardColor.RED
      ? table.redSmall
      : table.blackSmall;
  } else {
    return cardInfo.color === CardColor.RED
      ? table.redBig
      : table.blackBig;
  }
}

/**
 * 获取特殊吃牌顺子的胡息
 */
export function getSpecialSequenceHu(
  ranks: string[],
  size: CardSize
): number | null {
  const isSmall = size === CardSize.SMALL;

  if (isSmall && ranks.join('') === '一二三') {
    return SPECIAL_SEQUENCE_HU.small123;
  }
  if (isSmall && ranks.sort().join('') === '二十七') {
    return SPECIAL_SEQUENCE_HU.small2710;
  }
  if (!isSmall && ranks.join('') === '壹贰叁') {
    return SPECIAL_SEQUENCE_HU.big123;
  }
  if (!isSmall && ranks.sort().join('') === '贰柒拾') {
    return SPECIAL_SEQUENCE_HU.big2710;
  }

  return null;
}

/**
 * 游戏胜利条件
 */
export const WIN_CONDITIONS = {
  REQUIRED_MELDS: 7,
  HEAVENLY_WIN_CONDITIONS: {
    threeQuadruples: 3,
    fourTriples: 4
  }
} as const;

export interface WinConditionProfile {
  minHuPoints: number;
  allowZeroHu: boolean;
}

/**
 * 名堂番数表
 * 当前先落最明确、低争议的基础名堂；后续可按地方口径继续扩展。
 */
export const MING_TANG_FAN_TABLE: Readonly<Record<MingTangType, {
  name: string;
  fan: number;
  description: string;
}>> = {
  [MingTangType.QIA]: {
    name: '恰',
    fan: 1,
    description: '胡息正好为整十数，如10/20/30/40胡'
  },
  [MingTangType.LUAN]: {
    name: '乱',
    fan: 1,
    description: '胡牌时总胡息为0'
  },
  [MingTangType.HONG]: {
    name: '红',
    fan: 1,
    description: '胡牌后所有牌中红牌数量不少于10张'
  },
  [MingTangType.HEI]: {
    name: '黑',
    fan: 3,
    description: '胡牌后所有牌中没有红牌（全黑）'
  },
  [MingTangType.TIAN_HU]: {
    name: '天胡',
    fan: 1,
    description: '发完牌后庄家即胡牌'
  },
  [MingTangType.SHUI_SHANG_PIAO]: {
    name: '水上漂',
    fan: 1,
    description: '响应牌山翻出的第一张牌即胡牌'
  },
  [MingTangType.HAI_DI_LAO]: {
    name: '海底捞',
    fan: 1,
    description: '响应牌山翻出的最后一张牌胡牌'
  },
  [MingTangType.KUN]: {
    name: '昆',
    fan: 1,
    description: '除将牌外，所有牌组都有胡息'
  },
  [MingTangType.GUI]: {
    name: '归',
    fan: 1,
    description: '每出现1组四张同样的牌计1番'
  },
  [MingTangType.ZI_MO]: {
    name: '自摸',
    fan: 1,
    description: '玩家自己的轮次翻牌响应胡牌'
  },
  [MingTangType.BAO]: {
    name: '爆',
    fan: 1,
    description: '开局20张听牌后选择爆牌，并以爆牌状态胡牌'
  },
  [MingTangType.SHA_BAO]: {
    name: '杀爆',
    fan: 1,
    description: '除胡牌玩家外，其余宣爆玩家形成杀爆'
  }
} as const;

export const BASE_SCORE_TABLE = {
  ZERO_HU: 2,
  TEN_TO_NINETEEN: 2,
  TWENTY_TO_TWENTY_NINE: 3,
  THIRTY_TO_THIRTY_NINE: 4,
  FORTY_PLUS: 5,
} as const;

export const BASE_FAN = 1;

export function getBaseScoreByHu(totalHuPoints: number): number {
  if (totalHuPoints === 0) {
    return BASE_SCORE_TABLE.ZERO_HU;
  }
  if (totalHuPoints < 20) {
    return BASE_SCORE_TABLE.TEN_TO_NINETEEN;
  }
  if (totalHuPoints < 30) {
    return BASE_SCORE_TABLE.TWENTY_TO_TWENTY_NINE;
  }
  if (totalHuPoints < 40) {
    return BASE_SCORE_TABLE.THIRTY_TO_THIRTY_NINE;
  }
  return BASE_SCORE_TABLE.FORTY_PLUS;
}

/**
 * 检查是否满足胡牌条件
 */
export function checkWinCondition(
  totalHuPoints: number,
  groupCount: number,
  pairCount: number,
  isZeroHu: boolean,
  profile: WinConditionProfile,
): boolean {
  const validStructure =
    (groupCount === WIN_CONDITIONS.REQUIRED_MELDS && pairCount === 0) ||
    (groupCount === WIN_CONDITIONS.REQUIRED_MELDS - 1 && pairCount === 1);

  if (!validStructure) {
    return false;
  }

  if (isZeroHu) {
    return profile.allowZeroHu && totalHuPoints === 0;
  }
  return totalHuPoints >= profile.minHuPoints &&
      validStructure;
}

/**
 * 八块机制
 */
export const EIGHT_BLOCKS_CONFIG = {
  REQUIRED_COUNT: 2,
  SKIP_DISCARD: true,
  PRIVILEGE_ACTIVE: true
} as const;

/**
 * 检查是否激活八块
 */
export function hasEightBlocks(
  quadrupleCount: number,
  drawQuadrupleCount: number
): boolean {
  return quadrupleCount + drawQuadrupleCount >= EIGHT_BLOCKS_CONFIG.REQUIRED_COUNT;
}

/**
 * 计分权重（用于AI评估）
 */
export const SCORING_WEIGHTS = {
  HU_POINTS: 1.0,
  RED_CARD_BONUS: 0.5,
  BIG_CARD_BONUS: 0.3,
  SPECIAL_BONUS: 2.0,
  EIGHT_BLOCKS_BONUS: 5.0
} as const;

/**
 * 导出计分相关常量
 */
export const SCORING_CONSTANTS = {
  HU_POINTS_TABLE,
  SPECIAL_SEQUENCE_HU,
  MING_TANG_FAN_TABLE,
  WIN_CONDITIONS,
  EIGHT_BLOCKS_CONFIG,
  SCORING_WEIGHTS
} as const;
