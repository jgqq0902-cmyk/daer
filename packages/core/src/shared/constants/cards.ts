/**
 * 牌面常量定义
 * 泸州大贰使用80张牌
 */

import { CardRank, CardSize, CardColor, CardValue } from '../types';

/**
 * 小写牌面 (1-10)
 */
export const SMALL_RANKS: CardRank[] = [
  '一', '二', '三', '四', '五',
  '六', '七', '八', '九', '十'
];

/**
 * 大写牌面 (1-10)
 */
export const BIG_RANKS: CardRank[] = [
  '壹', '贰', '叁', '肆', '伍',
  '陆', '柒', '捌', '玖', '拾'
];

/**
 * 所有牌面 (20种)
 */
export const ALL_RANKS: CardRank[] = [
  ...SMALL_RANKS,
  ...BIG_RANKS
];

/**
 * 红牌的数字值 (2, 7, 10)
 */
export const RED_VALUES: CardValue[] = [2, 7, 10];

/**
 * 牌面到数字值的映射
 */
export const RANK_TO_VALUE: Readonly<Record<CardRank, CardValue>> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5,
  '陆': 6, '柒': 7, '捌': 8, '玖': 9, '拾': 10
} as const;

/**
 * 数字值到小写牌面的映射
 */
export const VALUE_TO_SMALL_RANK: Readonly<Record<CardValue, CardRank>> = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
  6: '六', 7: '七', 8: '八', 9: '九', 10: '十'
} as const;

/**
 * 数字值到大写牌面的映射
 */
export const VALUE_TO_BIG_RANK: Readonly<Record<CardValue, CardRank>> = {
  1: '壹', 2: '贰', 3: '叁', 4: '肆', 5: '伍',
  6: '陆', 7: '柒', 8: '捌', 9: '玖', 10: '拾'
} as const;

/**
 * 判断牌面是否为红牌
 */
export function isRedRank(rank: CardRank): boolean {
  const value = RANK_TO_VALUE[rank];
  return RED_VALUES.includes(value);
}

/**
 * 判断牌面是否为小写
 */
export function isSmallRank(rank: CardRank): boolean {
  return SMALL_RANKS.includes(rank);
}

/**
 * 判断牌面是否为大写
 */
export function isBigRank(rank: CardRank): boolean {
  return BIG_RANKS.includes(rank);
}

/**
 * 获取牌面的颜色
 */
export function getRankColor(rank: CardRank): CardColor {
  return isRedRank(rank) ? CardColor.RED : CardColor.BLACK;
}

/**
 * 获取牌面的大小写
 */
export function getRankSize(rank: CardRank): CardSize {
  return isSmallRank(rank) ? CardSize.SMALL : CardSize.BIG;
}

/**
 * 判断牌面值是否为红牌 (2, 7, 10)
 */
export function isRedCard(value: CardValue): boolean {
  return RED_VALUES.includes(value);
}

/**
 * 特殊组合：2/7/10
 */
export const SPECIAL_2710_VALUES = [2, 7, 10];

/**
 * 判断是否为2/7/10特殊组合
 */
export function isSpecial2710(values: CardValue[]): boolean {
  if (values.length !== 3) return false;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[0] === 2 && sorted[1] === 7 && sorted[2] === 10;
}

/**
 * 顺子检测 - 判断是否为连续的三张牌
 */
export function isSequential(values: CardValue[]): boolean {
  if (values.length !== 3) return false;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
}

/**
 * 牌组配置
 */
export const DECK_CONFIG = {
  /** 总牌数 */
  TOTAL_CARDS: 80,
  /** 每种牌的张数 */
  CARDS_PER_TYPE: 4,
  /** 牌面种类数 */
  RANK_TYPES: 20,
  /** 小写种类数 */
  SMALL_RANK_COUNT: 10,
  /** 大写种类数 */
  BIG_RANK_COUNT: 10
} as const;

/**
 * 发牌配置
 */
export const DEAL_CONFIG = {
  /** 固定三人游戏 */
  THREE_PLAYERS: {
    /** 庄家牌数 */
    DEALER_CARDS: 21,
    /** 闲家牌数 */
    PLAYER_CARDS: 20,
    /** 底牌数 */
    BOTTOM_CARDS: 2,
    /** 可摸牌数 */
    DRAWABLE_CARDS: 17,
    /** 总发牌数 */
    TOTAL_DEALT: 21 + 20 * 2
  }
} as const;

/**
 * 牌的 Unicode 显示
 */
export const CARD_DISPLAY: Readonly<Record<CardRank, string>> = {
  '一': '一', '二': '二', '三': '三', '四': '四', '五': '五',
  '六': '六', '七': '七', '八': '八', '九': '九', '十': '十',
  '壹': '壹', '贰': '贰', '叁': '叁', '肆': '肆', '伍': '伍',
  '陆': '陆', '柒': '柒', '捌': '捌', '玖': '玖', '拾': '拾'
} as const;
