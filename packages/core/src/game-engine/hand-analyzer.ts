/**
 * 手牌分析器
 * 分析手牌结构和潜力
 */

import { Card, Meld } from '../shared/types';
import { MeldDetector } from './meld-detector';
import { ScoreCalculator } from './score-calculator';
import { HandAnalysis } from './types';
import { RulesValidator } from './rules-validator';

/**
 * 手牌分析器类
 */
export class HandAnalyzer {
  private meldDetector: MeldDetector;
  private scoreCalculator: ScoreCalculator;
  private rulesValidator: RulesValidator;
  private potentialMeldMemo: Map<string, Meld[]>;

  constructor() {
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
    this.rulesValidator = new RulesValidator();
    this.potentialMeldMemo = new Map();
  }

  /**
   * 分析手牌
   */
  analyze(handCards: Card[], knownMelds: Meld[] = []): HandAnalysis {
    const melds = [...knownMelds];
    const potentialMelds = this.selectBestPotentialMelds(handCards);
    const lockedCardIds = new Set<string>();
    const lockedCountsByCode: Record<string, number> = {};

    const addLockedCard = (card: Card) => {
      lockedCardIds.add(card.id);
      const code = `${card.size}_${card.value}`;
      lockedCountsByCode[code] = (lockedCountsByCode[code] || 0) + 1;
    };

    for (const meld of melds) {
      for (const card of meld.cards) {
        addLockedCard(card);
      }
    }

    const groupedByCode = new Map<string, Card[]>();
    for (const card of handCards) {
      const code = `${card.size}_${card.value}`;
      if (!groupedByCode.has(code)) {
        groupedByCode.set(code, []);
      }
      groupedByCode.get(code)!.push(card);
    }

    for (const group of groupedByCode.values()) {
      if (group.length < 3) {
        continue;
      }
      for (const card of group) {
        addLockedCard(card);
      }
    }

    const usedCardIds = new Set<string>();
    melds.forEach(m => m.cards.forEach(c => usedCardIds.add(c.id)));
    potentialMelds.forEach(m => m.cards.forEach(c => usedCardIds.add(c.id)));
    const looseCards = handCards.filter(c => !usedCardIds.has(c.id));

    const tingCards = this.rulesValidator.getBaoTingCards(handCards, melds);
    const scoreResult = this.scoreCalculator.calculateTotalScore([...melds, ...potentialMelds]);
    const canWin = this.rulesValidator.canHu(handCards, knownMelds);
    const completeness = handCards.length === 0
      ? 1
      : Math.max(0, Math.min(1, 1 - looseCards.length / handCards.length));
    const stepsToWin = canWin
      ? 0
      : tingCards.length > 0
        ? 1
        : Math.max(1, Math.ceil(Math.max(1, looseCards.length) / 3));

    return {
      melds,
      potentialMelds,
      looseCards,
      tingCards,
      tingPositions: [],
      lockedCardIds: Array.from(lockedCardIds),
      lockedCountsByCode,
      canWin,
      totalHuPoints: scoreResult.totalHuPoints,
      completeness,
      stepsToWin,
    };
  }

  private selectBestPotentialMelds(cards: Card[]): Meld[] {
    const rootCounts = this.buildRootCountMap(cards);
    const rootSignature = this.buildRootCountSignature(rootCounts);
    return this.solveBestPotentialMelds(cards, rootCounts, rootSignature);
  }

  private solveBestPotentialMelds(cards: Card[], rootCounts: Map<string, number>, rootSignature: string): Meld[] {
    const signature = `${rootSignature}__${this.buildExactCardSignature(cards)}`;
    const cached = this.potentialMeldMemo.get(signature);
    if (cached) {
      return cached;
    }

    const candidates = this.listCandidateMelds(cards);
    if (candidates.length === 0) {
      this.storePotentialMeldMemo(signature, []);
      return [];
    }

    let best: Meld[] = [];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const usedIds = new Set(candidate.cards.map((card) => card.id));
      const remaining = cards.filter((card) => !usedIds.has(card.id));
      const next = this.solveBestPotentialMelds(remaining, rootCounts, rootSignature);
      const combo = [candidate, ...next];
      const score = this.scorePotentialCombo(combo, rootCounts);

      if (score > bestScore) {
        bestScore = score;
        best = combo;
      }
    }

    this.storePotentialMeldMemo(signature, best);
    return best;
  }

  private storePotentialMeldMemo(key: string, melds: Meld[]): void {
    if (this.potentialMeldMemo.size >= 4000) {
      this.potentialMeldMemo.clear();
    }
    this.potentialMeldMemo.set(key, melds);
  }

  private buildCardSignature(cards: Card[]): string {
    const counts = new Map<string, number>();
    for (const card of cards) {
      const key = `${card.size}_${card.value}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => `${key}:${count}`)
      .join('|');
  }

  private buildExactCardSignature(cards: Card[]): string {
    return cards
      .map((card) => String(card.id))
      .sort()
      .join('|');
  }

  private buildRootCountMap(cards: Card[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const card of cards) {
      const key = `${card.size}_${card.value}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return counts;
  }

  private buildRootCountSignature(rootCounts: Map<string, number>): string {
    return Array.from(rootCounts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => `${key}:${count}`)
      .join('|');
  }

  private scorePotentialCombo(melds: Meld[], rootCounts: Map<string, number>): number {
    const weightByType: Record<string, number> = {
      quadruple: 4.8,
      triple: 4.2,
      special_2710: 4,
      mixed_size: 3.6,
      sequence: 3,
      pair: 0.2,
    };

    const coveredCards = melds.reduce((sum, meld) => sum + meld.cards.length, 0);
    const nonPairs = melds.filter((meld) => meld.type !== 'pair').length;
    const buriedTriplePenalty = melds.reduce((sum, meld) => {
      if (meld.type !== 'pair') {
        return sum;
      }

      const anchor = meld.cards[0];
      if (!anchor) {
        return sum;
      }

      const key = `${anchor.size}_${anchor.value}`;
      return sum + ((rootCounts.get(key) || 0) >= 3 ? 1.4 : 0);
    }, 0);

    return melds.reduce((sum, meld) => sum + (weightByType[meld.type] || 0), 0) + coveredCards * 0.18 + nonPairs * 0.35 - buriedTriplePenalty;
  }

  private listCandidateMelds(cards: Card[]): Meld[] {
    const candidates: Meld[] = [];
    const byCode = new Map<string, Card[]>();
    const bySizeValue = new Map<string, Card[]>();

    for (const card of cards) {
      const code = `${card.size}_${card.value}`;
      if (!byCode.has(code)) {
        byCode.set(code, []);
      }
      byCode.get(code)!.push(card);

      if (!bySizeValue.has(code)) {
        bySizeValue.set(code, []);
      }
      bySizeValue.get(code)!.push(card);
    }

    for (const group of byCode.values()) {
      if (group.length >= 4) {
        candidates.push({
          type: 'quadruple' as Meld['type'],
          cards: group.slice(0, 4),
          isConcealed: true,
          position: 'hand',
          huPoints: 0,
        });
      }

      if (group.length >= 3) {
        candidates.push({
          type: 'triple' as Meld['type'],
          cards: group.slice(0, 3),
          isConcealed: true,
          position: 'hand',
          huPoints: 0,
        });
      }

      if (group.length >= 2) {
        candidates.push({
          type: 'pair' as Meld['type'],
          cards: group.slice(0, 2),
          isConcealed: true,
          position: 'hand',
          huPoints: 0,
        });
      }
    }

    for (const size of ['small', 'big'] as const) {
      for (let start = 1; start <= 8; start++) {
        const first = bySizeValue.get(`${size}_${start}`)?.[0];
        const second = bySizeValue.get(`${size}_${start + 1}`)?.[0];
        const third = bySizeValue.get(`${size}_${start + 2}`)?.[0];

        if (first && second && third) {
          candidates.push({
            type: 'sequence' as Meld['type'],
            cards: [first, second, third],
            isConcealed: true,
            position: 'hand',
            huPoints: 0,
          });
        }
      }

      const two = bySizeValue.get(`${size}_2`)?.[0];
      const seven = bySizeValue.get(`${size}_7`)?.[0];
      const ten = bySizeValue.get(`${size}_10`)?.[0];
      if (two && seven && ten) {
        candidates.push({
          type: 'special_2710' as Meld['type'],
          cards: [two, seven, ten],
          isConcealed: true,
          position: 'hand',
          huPoints: 0,
        });
      }
    }

    for (let value = 1; value <= 10; value++) {
      const smallCards = bySizeValue.get(`small_${value}`) || [];
      const bigCards = bySizeValue.get(`big_${value}`) || [];

      if (bigCards.length >= 2 && smallCards.length >= 1) {
        candidates.push({
          type: 'mixed_size' as Meld['type'],
          cards: [bigCards[0], bigCards[1], smallCards[0]],
          isConcealed: true,
          position: 'hand',
          huPoints: 0,
        });
      }

      if (smallCards.length >= 2 && bigCards.length >= 1) {
        candidates.push({
          type: 'mixed_size' as Meld['type'],
          cards: [smallCards[0], smallCards[1], bigCards[0]],
          isConcealed: true,
          position: 'hand',
          huPoints: 0,
        });
      }
    }

    return candidates;
  }

  /**
   * 计算手牌强度
   */
  calculateStrength(handCards: Card[], melds: Meld[]): number {
    let strength = 0;

    for (const meld of melds) {
      strength += this.scoreCalculator.calculateMeldValue(meld);
    }

    const analysis = this.analyze(handCards, melds);
    for (const potential of analysis.potentialMelds) {
      const meldWeight = potential.type === 'pair' ? 0.35 : 0.65;
      strength += this.scoreCalculator.calculateMeldValue(potential) * meldWeight;
    }

    if (analysis.tingCards.length > 0) {
      strength += analysis.tingCards.length * 2;
    }

    strength += (analysis.totalHuPoints || 0) * 0.8;
    strength += (analysis.completeness || 0) * 18;
    strength -= analysis.looseCards.length * 1.5;

    return Math.min(100, strength);
  }

  /**
   * 计算改善潜力
   */
  calculateImprovementPotential(handCards: Card[], melds: Meld[]): number {
    let potential = 0;
    const analysis = this.analyze(handCards, melds);

    potential += analysis.potentialMelds.length * 5;
    potential += analysis.tingCards.length * 3;
    potential -= analysis.looseCards.length * 2;

    return Math.max(0, Math.min(100, potential));
  }

  /**
   * 查找最佳出牌
   */
  findBestDiscard(handCards: Card[], melds: Meld[]): { card: Card; score: number } | null {
    if (handCards.length === 0) return null;

    let bestCard = handCards[0];
    let bestScore = -Infinity;

    for (const card of handCards) {
      const remainingCards = handCards.filter(c => c.id !== card.id);
      const analysis = this.analyze(remainingCards, melds);
      const sameRankCount = handCards.filter(c => c.rank === card.rank && c.size === card.size).length;

      let score = 0;
      score += analysis.potentialMelds.filter((meld) => meld.type !== 'pair').length * 6;
      score += analysis.tingCards.length * 8;
      score += (analysis.totalHuPoints || 0) * 1.4;
      score -= analysis.looseCards.length * 2.5;
      score += (analysis.completeness || 0) * 14;
      score -= (analysis.stepsToWin || 0) * 2.5;

      if (sameRankCount >= 2) {
        score -= 3;
      }

      if (card.isRed) {
        score -= 2.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
      }
    }

    return { card: bestCard, score: bestScore };
  }
}
