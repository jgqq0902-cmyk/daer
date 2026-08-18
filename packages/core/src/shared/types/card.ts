/**
 * 牌的类型定义
 * 泸州大贰使用80张牌：大小写各40张，20种牌面每种4张
 */

/** 牌的大小写 */
export enum CardSize {
  BIG = 'big',      // 大字：壹贰叁肆伍陆柒捌玖拾
  SMALL = 'small'   // 小字：一二三四五六七八九十
}

/** 牌的颜色 */
export enum CardColor {
  RED = 'red',
  BLACK = 'black'
}

/** 牌面等级 - 20种 */
export type CardRank =
  // 小写 (1-10)
  | '一' | '二' | '三' | '四' | '五'
  | '六' | '七' | '八' | '九' | '十'
  // 大写 (1-10)
  | '壹' | '贰' | '叁' | '肆' | '伍'
  | '陆' | '柒' | '捌' | '玖' | '拾';

/** 数字值 (1-10) */
export type CardValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * 单张牌
 */
export interface Card {
  /** 唯一标识 */
  id: string;
  /** 牌面 */
  rank: CardRank;
  /** 大小写 */
  size: CardSize;
  /** 颜色 */
  color: CardColor;
  /** 数字值 (1-10) */
  value: CardValue;
  /** 是否为红牌 (2/7/10) */
  isRed: boolean;
}

/**
 * 牌的位置信息
 */
export interface CardPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 创建牌的工具函数
 */
export class CardFactory {
  private static idCounter = 0;

  /**
   * 创建单张牌
   */
  static create(rank: CardRank, size: CardSize): Card {
    const value = this.getNumericValue(rank);
    const isRed = this.isRedCard(value);
    const color = isRed ? CardColor.RED : CardColor.BLACK;

    return {
      id: `card_${rank}_${size}_${++this.idCounter}`,
      rank,
      size,
      color,
      value,
      isRed
    };
  }

  /**
   * 获取数字值
   */
  private static getNumericValue(rank: CardRank): CardValue {
    const valueMap: Record<CardRank, CardValue> = {
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
      '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
      '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5,
      '陆': 6, '柒': 7, '捌': 8, '玖': 9, '拾': 10
    };
    return valueMap[rank];
  }

  /**
   * 判断是否为红牌 (2/7/10)
   */
  private static isRedCard(value: CardValue): boolean {
    return value === 2 || value === 7 || value === 10;
  }

  /**
   * 创建完整牌组 (80张)
   */
  static createDeck(): Card[] {
    const deck: Card[] = [];
    const ranks: CardRank[] = [
      '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'
    ];
    const sizes: CardSize[] = [CardSize.SMALL, CardSize.BIG];

    // 每种牌4张 (相同rank和size)
    for (const rank of ranks) {
      for (const size of sizes) {
        for (let i = 0; i < 4; i++) {
          deck.push(this.create(rank, size));
        }
      }
    }

    return deck;
  }

  /**
   * 重置ID计数器
   */
  static resetIdCounter(): void {
    this.idCounter = 0;
  }

  /**
   * 洗牌
   */
  static shuffle(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}

/**
 * 牌的比较工具
 */
export class CardComparator {
  /**
   * 判断两张牌是否相同（等级和大小写都相同）
   */
  static isSame(a: Card, b: Card): boolean {
    return a.rank === b.rank && a.size === b.size;
  }

  /**
   * 判断两张牌是否等值（等级相同，忽略大小写）
   */
  static isEquivalent(a: Card, b: Card): boolean {
    return a.value === b.value;
  }

  /**
   * 判断是否为大小混搭（2张相同大写+1张同数字小写，或反之）
   */
  static isMixedSize(cards: Card[]): boolean {
    if (cards.length !== 3) return false;
    const values = cards.map(c => c.value);
    return values.every(v => v === values[0]) &&
           new Set(cards.map(c => c.size)).size === 2;
  }
}
