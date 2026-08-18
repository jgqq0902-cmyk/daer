/**
 * 牌型检测器
 * 检测所有有效的牌型组合
 */

import { Card, Meld, MeldType, CardSize } from '../shared/types';
import { CardComparator } from '../shared/types/card';
import { MeldDetectionResult, HandStats } from './types';

/**
 * 牌型检测器类
 */
export class MeldDetector {
  /**
   * 检测所有可能的牌型
   */
  detectAllMelds(cards: Card[]): Meld[] {
    const melds: Meld[] = [];
    let remaining = [...cards];

    const quadruples = this.detectQuadruples(remaining);
    melds.push(...quadruples.melds);
    remaining = quadruples.remaining;

    const triples = this.detectTriples(remaining);
    melds.push(...triples.melds);
    remaining = triples.remaining;

    const sequences = this.detectSequences(remaining);
    melds.push(...sequences.melds);
    remaining = sequences.remaining;

    const special2710 = this.detectSpecial2710(remaining);
    melds.push(...special2710.melds);
    remaining = special2710.remaining;

    const mixedSize = this.detectMixedSize(remaining);
    melds.push(...mixedSize.melds);
    remaining = mixedSize.remaining;

    // 对子最后检测，避免与列牌重叠计数导致虚假可胡
    const pairs = this.detectPairs(remaining);
    melds.push(...pairs.melds);

    return melds;
  }

  /**
   * 检测垅牌 (起手4张相同)
   */
  detectQuadruples(cards: Card[]): MeldDetectionResult {
    const melds: Meld[] = [];
    const remaining: Card[] = [];
    const used = new Set<string>();

    for (const card of cards) {
      if (used.has(card.id)) continue;

      const sameCards = cards.filter(c =>
        !used.has(c.id) && CardComparator.isSame(card, c)
      );

      if (sameCards.length >= 4) {
        const meldCards = sameCards.slice(0, 4);
        meldCards.forEach(c => used.add(c.id));

        melds.push({
          type: MeldType.QUADRUPLE,
          cards: meldCards,
          isConcealed: true,
          position: 'hand',
          huPoints: 0
        });
      }
    }

    cards.forEach(c => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });

    return { melds, remaining };
  }

  /**
   * 检测坎牌 (3张相同)
   */
  detectTriples(cards: Card[]): MeldDetectionResult {
    const melds: Meld[] = [];
    const remaining: Card[] = [];
    const used = new Set<string>();

    for (const card of cards) {
      if (used.has(card.id)) continue;

      const sameCards = cards.filter(c =>
        !used.has(c.id) && CardComparator.isSame(card, c)
      );

      if (sameCards.length >= 3) {
        const meldCards = sameCards.slice(0, 3);
        meldCards.forEach(c => used.add(c.id));

        melds.push({
          type: MeldType.TRIPLE,
          cards: meldCards,
          isConcealed: true,
          position: 'hand',
          huPoints: 0
        });
      }
    }

    cards.forEach(c => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });

    return { melds, remaining };
  }

  /**
   * 检测对子 (2张相同)
   */
  detectPairs(cards: Card[]): MeldDetectionResult {
    const melds: Meld[] = [];
    const remaining: Card[] = [];
    const used = new Set<string>();

    for (const card of cards) {
      if (used.has(card.id)) continue;

      const sameCard = cards.find(c =>
        !used.has(c.id) && c.id !== card.id && CardComparator.isSame(card, c)
      );

      if (sameCard) {
        used.add(card.id);
        used.add(sameCard.id);

        melds.push({
          type: MeldType.PAIR,
          cards: [card, sameCard],
          isConcealed: true,
          position: 'hand',
          huPoints: 0
        });
      }
    }

    cards.forEach(c => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });

    return { melds, remaining };
  }

  /**
   * 检测列牌 (顺子)
   */
  detectSequences(cards: Card[]): MeldDetectionResult {
    const melds: Meld[] = [];
    const remaining: Card[] = [];
    const used = new Set<string>();

    const smallCards = cards.filter(c => c.size === CardSize.SMALL && !used.has(c.id));
    const bigCards = cards.filter(c => c.size === CardSize.BIG && !used.has(c.id));

    const smallSequences = this.detectSequencesBySize(smallCards, CardSize.SMALL);
    smallSequences.melds.forEach(m => {
      m.cards.forEach(c => used.add(c.id));
      melds.push(m);
    });

    const bigSequences = this.detectSequencesBySize(bigCards, CardSize.BIG);
    bigSequences.melds.forEach(m => {
      m.cards.forEach(c => used.add(c.id));
      melds.push(m);
    });

    cards.forEach(c => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });

    return { melds, remaining };
  }

  /**
   * 按大小写检测顺子
   */
  private detectSequencesBySize(cards: Card[], _size: CardSize): MeldDetectionResult {
    const melds: Meld[] = [];
    const used = new Set<string>();

    const byValue: Map<number, Card[]> = new Map();
    for (const card of cards) {
      if (!byValue.has(card.value)) {
        byValue.set(card.value, []);
      }
      byValue.get(card.value)!.push(card);
    }

    for (let start = 1; start <= 8; start++) {
      const v1 = byValue.get(start);
      const v2 = byValue.get(start + 1);
      const v3 = byValue.get(start + 2);

      if (v1 && v1.length > 0 && !used.has(v1[0].id) &&
          v2 && v2.length > 0 && !used.has(v2[0].id) &&
          v3 && v3.length > 0 && !used.has(v3[0].id)) {

        const meldCards = [v1[0], v2[0], v3[0]];
        meldCards.forEach(c => used.add(c.id));

        melds.push({
          type: MeldType.SEQUENCE,
          cards: meldCards,
          isConcealed: true,
          position: 'hand',
          huPoints: 0
        });
      }
    }

    return { melds, remaining: cards.filter(c => !used.has(c.id)) };
  }

  /**
   * 检测特殊组合 (2/7/10)
   */
  detectSpecial2710(cards: Card[]): MeldDetectionResult {
    const melds: Meld[] = [];
    const remaining: Card[] = [];
    const used = new Set<string>();

    const smallCards = cards.filter(c => c.size === CardSize.SMALL);
    const bigCards = cards.filter(c => c.size === CardSize.BIG);

    const smallSpecial = this.detectSpecial2710BySize(smallCards, CardSize.SMALL);
    smallSpecial.melds.forEach(m => {
      m.cards.forEach(c => used.add(c.id));
      melds.push(m);
    });

    const bigSpecial = this.detectSpecial2710BySize(bigCards, CardSize.BIG);
    bigSpecial.melds.forEach(m => {
      m.cards.forEach(c => used.add(c.id));
      melds.push(m);
    });

    cards.forEach(c => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });

    return { melds, remaining };
  }

  /**
   * 按大小写检测 2/7/10
   */
  private detectSpecial2710BySize(cards: Card[], _size: CardSize): MeldDetectionResult {
    const melds: Meld[] = [];
    const used = new Set<string>();

    const two = cards.find(c => c.value === 2 && !used.has(c.id));
    const seven = cards.find(c => c.value === 7 && !used.has(c.id));
    const ten = cards.find(c => c.value === 10 && !used.has(c.id));

    if (two && seven && ten) {
      used.add(two.id);
      used.add(seven.id);
      used.add(ten.id);

      melds.push({
        type: MeldType.SPECIAL_2710,
        cards: [two, seven, ten],
        isConcealed: true,
        position: 'hand',
        huPoints: 0
      });
    }

    return { melds, remaining: cards.filter(c => !used.has(c.id)) };
  }

  /**
   * 检测大小混搭
   */
  detectMixedSize(cards: Card[]): MeldDetectionResult {
    const melds: Meld[] = [];
    const remaining: Card[] = [];
    const used = new Set<string>();

    const byValue: Map<number, { small: Card[]; big: Card[] }> = new Map();
    for (const card of cards) {
      if (!byValue.has(card.value)) {
        byValue.set(card.value, { small: [], big: [] });
      }
      if (card.size === CardSize.SMALL) {
        byValue.get(card.value)!.small.push(card);
      } else {
        byValue.get(card.value)!.big.push(card);
      }
    }

    for (const [, group] of byValue.entries()) {
      if (group.big.length >= 2 && group.small.length >= 1) {
        const meldCards = [group.big[0], group.big[1], group.small[0]];
        meldCards.forEach(c => used.add(c.id));

        melds.push({
          type: MeldType.MIXED_SIZE,
          cards: meldCards,
          isConcealed: true,
          position: 'hand',
          huPoints: 0
        });
      } else if (group.small.length >= 2 && group.big.length >= 1) {
        const meldCards = [group.small[0], group.small[1], group.big[0]];
        meldCards.forEach(c => used.add(c.id));

        melds.push({
          type: MeldType.MIXED_SIZE,
          cards: meldCards,
          isConcealed: true,
          position: 'hand',
          huPoints: 0
        });
      }
    }

    cards.forEach(c => {
      if (!used.has(c.id)) {
        remaining.push(c);
      }
    });

    return { melds, remaining };
  }

  /**
   * 统计手牌
   */
  calculateStats(cards: Card[]): HandStats {
    const pairs = this.detectPairs(cards).melds.length;
    const triples = this.detectTriples(cards).melds.length;
    const quadruples = this.detectQuadruples(cards).melds.length;
    const sequences = this.detectSequences(cards).melds.length;
    const special2710 = this.detectSpecial2710(cards).melds.length;

    return { pairs, triples, quadruples, sequences, special2710 };
  }
}
