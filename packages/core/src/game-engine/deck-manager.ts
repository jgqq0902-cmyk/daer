/**
 * 牌组管理器
 * 负责创建、洗牌、发牌等牌组操作
 */

import { Card, CardSize, CardColor, CardValue } from '../shared/types';
import { DEAL_CONFIG } from '../shared/constants';
import { DealResult } from '../shared/types/simulation';

// 牌面定义
const SMALL_RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;
const BIG_RANKS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'] as const;

// 获取数字值
function getNumericValue(rank: typeof SMALL_RANKS[number] | typeof BIG_RANKS[number]): CardValue {
  const valueMap: Record<string, CardValue> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5,
    '陆': 6, '柒': 7, '捌': 8, '玖': 9, '拾': 10
  };
  return valueMap[rank];
}

// 判断是否为红牌
function isRedCard(value: CardValue): boolean {
  return value === 2 || value === 7 || value === 10;
}

/**
 * 牌组管理器类
 */
export class DeckManager {
  private idCounter = 0;

  /**
   * 创建标准80张牌组
   */
  createDeck(): Card[] {
    const deck: Card[] = [];

    // 每次创建牌组时重置 ID 计数器
    this.idCounter = 0;

    // 创建所有牌
    for (const rank of SMALL_RANKS) {
      for (let i = 0; i < 4; i++) {
        const value = getNumericValue(rank);
        deck.push({
          id: `card_${rank}_small_${++this.idCounter}`,
          rank,
          size: CardSize.SMALL,
          color: isRedCard(value) ? CardColor.RED : CardColor.BLACK,
          value,
          isRed: isRedCard(value)
        });
      }
    }

    for (const rank of BIG_RANKS) {
      for (let i = 0; i < 4; i++) {
        const value = getNumericValue(rank);
        deck.push({
          id: `card_${rank}_big_${++this.idCounter}`,
          rank,
          size: CardSize.BIG,
          color: isRedCard(value) ? CardColor.RED : CardColor.BLACK,
          value,
          isRed: isRedCard(value)
        });
      }
    }

    return deck;
  }

  /**
   * 洗牌（Fisher-Yates算法）
   */
  shuffle(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * 洗牌（带种子，用于可重现的模拟）
   */
  shuffleWithSeed(deck: Card[], seed: number): Card[] {
    const shuffled = [...deck];
    let random = this.seededRandom(seed);

    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * 带种子的随机数生成器（简单的线性同余生成器）
   */
  private seededRandom(seed: number): () => number {
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  /**
   * 发牌
   */
  deal(
    deck: Card[],
    playerCount: 3,
    dealerIndex: number = 0,
    bottomCardCountOverride?: 0 | 1 | 2,
    holdDealerPendingCard: boolean = false,
  ): DealResult {
    if (playerCount !== 3) {
      throw new Error('Only three-player games are supported.');
    }
    const config = DEAL_CONFIG.THREE_PLAYERS;

    const hands: Card[][] = [];
    let cardIndex = 0;
    let dealerPendingCard: Card | undefined;

    // 为每个玩家发牌
    for (let i = 0; i < 3; i++) {
      const isDealer = i === dealerIndex;
      const cardCount = isDealer
        ? (holdDealerPendingCard ? config.PLAYER_CARDS : config.DEALER_CARDS)
        : config.PLAYER_CARDS;

      const hand: Card[] = [];
      for (let j = 0; j < cardCount; j++) {
        if (cardIndex < deck.length) {
          hand.push(deck[cardIndex++]);
        }
      }

      // 排序手牌（方便查看）
      hand.sort((a, b) => {
        if (a.size !== b.size) {
          return a.size === 'big' ? 1 : -1;
        }
        if (a.value !== b.value) {
          return a.value - b.value;
        }
        return 0;
      });

      hands.push(hand);
    }

    if (holdDealerPendingCard && dealerIndex >= 0 && dealerIndex < 3 && cardIndex < deck.length) {
      dealerPendingCard = deck[cardIndex++];
    }

    // 剩余的牌：最后2张是底牌（不可用），前面的是可摸牌
    const remainingAfterDeal = deck.slice(cardIndex);
    // 底牌数量（不可用）
    const bottomCardCount = bottomCardCountOverride ?? config.BOTTOM_CARDS;
    // Array.slice(0, -0) 会得到空数组；底牌为 0 时应保留全部剩余牌。
    const drawableDeck = bottomCardCount === 0
      ? remainingAfterDeal
      : remainingAfterDeal.slice(0, -bottomCardCount);

    return {
      hands,
      dealerIndex,
      remainingDeck: drawableDeck,
      dealerPendingCard,
    };
  }

  /**
   * 从牌堆摸一张牌
   */
  draw(deck: Card[]): Card | null {
    return deck.pop() ?? null;
  }

  /**
   * 获取剩余牌数
   */
  remainingCount(deck: Card[]): number {
    return deck.length;
  }

  /**
   * 检查牌堆是否为空
   */
  isEmpty(deck: Card[]): boolean {
    return deck.length === 0;
  }

  /**
   * 创建一副洗好的牌
   */
  createShuffledDeck(): Card[] {
    const deck = this.createDeck();
    return this.shuffle(deck);
  }

  /**
   * 创建一副洗好的牌（带种子）
   */
  createShuffledDeckWithSeed(seed: number): Card[] {
    const deck = this.createDeck();
    return this.shuffleWithSeed(deck, seed);
  }
}

// 导出单例
export const deckManager = new DeckManager();
