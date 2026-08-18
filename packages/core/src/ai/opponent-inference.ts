/**
 * 对手手牌推断器
 * 基于已出牌和弃牌推断对手可能的手牌
 */

import { Card, OpponentInference as OpponentInferenceType, Meld } from '../shared/types';
import { CardFactory } from '../shared/types/card';

/**
 * 对手推断器类
 */
export class OpponentInference {
  /**
   * 推断对手手牌
   */
  inferOpponentHands(
    playerId: string,
    knownCards: Set<string>,
    discardedCards: Card[],
    _tableMelds: Meld[]
  ): OpponentInferenceType {
    // 创建完整牌组
    const fullDeck = CardFactory.createDeck();

    // 移除已知的牌
    const possibleCards = fullDeck.filter(card => {
      if (knownCards.has(card.id)) return false;
      if (discardedCards.some(d =>
        d.rank === card.rank && d.size === card.size
      )) {
        const discardedCount = discardedCards.filter(d =>
          d.rank === card.rank && d.size === card.size
        ).length;
        if (discardedCount >= 4) return false;
      }
      return true;
    });

    // 计算每张牌的概率
    const cardProbabilities = new Map<string, number>();
    const totalUnknown = 80 - knownCards.size - discardedCards.length;

    for (const card of possibleCards) {
      const key = `${card.rank}_${card.size}`;
      const currentCount = discardedCards.filter(d =>
        d.rank === card.rank && d.size === card.size
      ).length;
      const remainingCount = 4 - currentCount;
      const probability = remainingCount / totalUnknown;
      cardProbabilities.set(key, probability);
    }

    const possibleMelds: Meld[] = [];
    const confidence = this.calculateConfidence(knownCards.size, discardedCards.length);
    const reasoning = this.generateReasoning(knownCards.size, discardedCards.length, possibleCards.length);

    return {
      playerId,
      possibleCards,
      possibleMelds,
      confidence,
      reasoning,
      keyCards: this.identifyKeyCards(possibleCards)
    };
  }

  private calculateConfidence(knownCount: number, discardedCount: number): number {
    const infoRatio = (knownCount + discardedCount) / 80;
    return Math.min(1, infoRatio * 1.5);
  }

  private generateReasoning(
    knownCount: number,
    discardedCount: number,
    possibleCount: number
  ): string {
    const infoPercent = Math.round(((knownCount + discardedCount) / 80) * 100);
    return `基于 ${infoPercent}% 的已知信息推断，还剩 ${possibleCount} 张可能牌`;
  }

  private identifyKeyCards(possibleCards: Card[]): Card[] {
    const keyCards: Card[] = [];
    const redCards = possibleCards.filter(c => c.isRed);
    keyCards.push(...redCards.slice(0, 3));
    return keyCards;
  }

  inferTingProbability(
    playerId: string,
    opponentMelds: Meld[],
    discardedCards: Card[]
  ): number {
    let probability = 0;
    const meldCount = opponentMelds.reduce((sum, m) =>
      sum + (m.type !== 'pair' ? 1 : 0), 0
    );
    probability += meldCount * 0.1;
    const playCount = discardedCards.length;
    probability += playCount * 0.02;
    return Math.min(1, probability);
  }
}
