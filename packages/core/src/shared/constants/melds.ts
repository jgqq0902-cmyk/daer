/**
 * 牌型组合常量定义
 */

import { MeldType } from '../types';

/**
 * 牌型定义
 */
export const MELD_DEFINITIONS = {
  /** 对子 - 2张相同 */
  [MeldType.PAIR]: {
    name: '对子',
    cardCount: 2,
    description: '2张一模一样的牌'
  },
  /** 碰牌 - 桌面3张相同 */
  [MeldType.PENG]: {
    name: '碰牌',
    cardCount: 3,
    description: '桌面3张相同的牌'
  },
  /** 坎牌 - 起手3张相同，固定不可拆 */
  [MeldType.TRIPLE]: {
    name: '坎牌',
    cardCount: 3,
    description: '起手就有的3张一模一样的牌（固定组合，绝对不能拆散）'
  },
  /** 垅牌 - 起手4张相同，必须晒出 */
  [MeldType.QUADRUPLE]: {
    name: '垅牌',
    cardCount: 4,
    description: '起手就有的4张一模一样的牌（必须放在桌面示众）',
    isMandatory: true
  },
  /** 招牌 - 已有3张，摸到第4张 */
  [MeldType.DRAW_QUADRUPLE]: {
    name: '招牌',
    cardCount: 4,
    description: '手中已有坎牌，当别人打出或摸出第4张时必须招牌',
    isMandatory: true
  },
  /** 列牌 - 3张顺子 */
  [MeldType.SEQUENCE]: {
    name: '列牌',
    cardCount: 3,
    description: '3张相邻的牌（如：小四五六）'
  },
  /** 特殊组合 - 2/7/10 */
  [MeldType.SPECIAL_2710]: {
    name: '二七十',
    cardCount: 3,
    description: '2、7、10组合（必须同为大写或同为小写）'
  },
  /** 大小混搭 */
  [MeldType.MIXED_SIZE]: {
    name: '大小混搭',
    cardCount: 3,
    description: '2张相同的大牌+1张同数字的小牌，或反之'
  }
} as const;

/**
 * 强制执行的牌型
 */
export const MANDATORY_MELDS = [
  MeldType.QUADRUPLE,
  MeldType.DRAW_QUADRUPLE
] as const;

/**
 * 碰牌（对子碰成坎）也是强制执行
 */
export const MANDATORY_PENG = true;

/**
 * 获取牌型名称
 */
export function getMeldName(type: MeldType): string {
  return MELD_DEFINITIONS[type]?.name || '未知牌型';
}

/**
 * 获取牌型描述
 */
export function getMeldDescription(type: MeldType): string {
  return MELD_DEFINITIONS[type]?.description || '';
}

/**
 * 获取牌型所需牌数
 */
export function getMeldCardCount(type: MeldType): number {
  return MELD_DEFINITIONS[type]?.cardCount || 0;
}

/**
 * 判断牌型是否强制执行
 */
export function isMandatoryMeld(type: MeldType): boolean {
  return (MANDATORY_MELDS as readonly MeldType[]).includes(type);
}

/**
 * 吃牌规则
 */
export const CHI_RULES = {
  /** 只能吃下家的牌（牌局按逆时针进行） */
  ONLY_PREVIOUS_PLAYER: true,
  /** 过张后不能再吃这张牌 */
  PASS_NO_RETRY: true,
  /** 吃牌后需要比牌（手中有相同牌必须一起组合） */
  MUST_COMPARE: true
} as const;

/**
 * 比牌规则
 */
export const COMPARE_RULES = {
  /** 吃牌后，手中如有和吃的牌相同的牌，必须同时组合 */
  MANDATORY: true,
  /** 必须用剩余牌组合相同的牌型 */
  SAME_MELD_TYPE: true
} as const;

/**
 * 优先级顺序
 */
export const ACTION_PRIORITY = {
  /** 胡牌优先级最高 */
  HU: 1,
  /** 招牌 */
  ZHAO: 2,
  /** 碰牌 */
  PENG: 3,
  /** 吃牌 */
  CHI: 4,
  /** 出牌 */
  DISCARD: 5
} as const;

/**
 * 天胡条件
 */
export const HEAVENLY_WIN = {
  /** 3个垅牌 */
  THREE_QUADRUPLES: 3,
  /** 4个坎牌 */
  FOUR_TRIPLES: 4
} as const;

/**
 * 检查是否为天胡
 */
export function isHeavenlyWin(
  quadrupleCount: number,
  tripleCount: number
): boolean {
  return quadrupleCount >= HEAVENLY_WIN.THREE_QUADRUPLES ||
         tripleCount >= HEAVENLY_WIN.FOUR_TRIPLES;
}

/**
 * 判断是否为2/7/10特殊组合
 */
export function isSpecial2710(values: number[]): boolean {
  if (values.length !== 3) return false;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[0] === 2 && sorted[1] === 7 && sorted[2] === 10;
}

/**
 * 顺子检测 - 判断是否为连续的三张牌
 */
export function isSequential(values: number[]): boolean {
  if (values.length !== 3) return false;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
}

/**
 * 检查是否激活八块
 */
export function hasEightBlocks(
  quadrupleCount: number,
  drawQuadrupleCount: number
): boolean {
  return quadrupleCount + drawQuadrupleCount >= 2;
}
