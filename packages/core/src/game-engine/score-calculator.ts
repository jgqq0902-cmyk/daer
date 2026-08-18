/**
 * 计分器
 * 计算胡息和游戏得分
 */

import {
  Card,
  Meld,
  MeldType,
  CardSize,
  MingTang,
  MingTangType,
  WinType,
  DEFAULT_ENABLED_MINGTANG_TYPES,
  EnabledMingTangMap,
} from '../shared/types';
import {
  getHuPoints,
  getSpecialSequenceHu,
  checkWinCondition,
  MING_TANG_FAN_TABLE,
  getBaseScoreByHu,
  BASE_FAN,
} from '../shared/constants';
import { ScoreResult } from './types';
import { MeldDetector } from './meld-detector';
import { CardFactory } from '../shared/types/card';
import { DEFAULT_RULE_PROFILE, RuleProfile } from '../shared/types/game';

/**
 * 计分器类
 */
export class ScoreCalculator {
  private buildMingTang(type: MingTangType): MingTang {
    const definition = MING_TANG_FAN_TABLE[type];
    return {
      type,
      name: definition.name,
      fan: definition.fan,
      description: definition.description,
    };
  }

  private isMingTangEnabled(type: MingTangType, enabledMingTangTypes?: EnabledMingTangMap): boolean {
    const enabled = enabledMingTangTypes || DEFAULT_ENABLED_MINGTANG_TYPES;
    return enabled[type] !== false;
  }

  private getAllCardsFromMelds(melds: Meld[]): Card[] {
    return melds.flatMap((meld) => meld.cards || []);
  }

  private countGui(cards: Card[]): number {
    const grouped = new Map<string, number>();
    for (const card of cards) {
      const key = `${card.size}-${card.rank}`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }

    return Array.from(grouped.values()).filter((count) => count >= 4).length;
  }

  private calculateMingTangs(
    melds: Meld[],
    totalHuPoints: number,
    options: {
      winType?: WinType;
      isHeavenlyWin?: boolean;
      isFirstDrawWin?: boolean;
      isLastDrawWin?: boolean;
      isBaoWin?: boolean;
      isShaBao?: boolean;
      enabledMingTangTypes?: EnabledMingTangMap;
    }
  ): MingTang[] {
    const mingtangs: MingTang[] = [];
    const allCards = this.getAllCardsFromMelds(melds);
    const redCardCount = allCards.filter((card) => card.isRed).length;

    if (this.isMingTangEnabled(MingTangType.QIA, options.enabledMingTangTypes)
      && totalHuPoints > 0
      && totalHuPoints % 10 === 0) {
      mingtangs.push(this.buildMingTang(MingTangType.QIA));
    }

    if (this.isMingTangEnabled(MingTangType.LUAN, options.enabledMingTangTypes)
      && totalHuPoints === 0) {
      mingtangs.push(this.buildMingTang(MingTangType.LUAN));
    }

    if (this.isMingTangEnabled(MingTangType.HONG, options.enabledMingTangTypes)
      && redCardCount >= 10) {
      mingtangs.push(this.buildMingTang(MingTangType.HONG));
    }

    if (this.isMingTangEnabled(MingTangType.HEI, options.enabledMingTangTypes)
      && redCardCount === 0) {
      mingtangs.push(this.buildMingTang(MingTangType.HEI));
    }

    if (this.isMingTangEnabled(MingTangType.TIAN_HU, options.enabledMingTangTypes) && options.isHeavenlyWin) {
      mingtangs.push(this.buildMingTang(MingTangType.TIAN_HU));
    }

    if (this.isMingTangEnabled(MingTangType.SHUI_SHANG_PIAO, options.enabledMingTangTypes) && options.isFirstDrawWin) {
      mingtangs.push(this.buildMingTang(MingTangType.SHUI_SHANG_PIAO));
    }

    if (this.isMingTangEnabled(MingTangType.HAI_DI_LAO, options.enabledMingTangTypes) && options.isLastDrawWin) {
      mingtangs.push(this.buildMingTang(MingTangType.HAI_DI_LAO));
    }

    if (this.isMingTangEnabled(MingTangType.KUN, options.enabledMingTangTypes)) {
      const nonPairMelds = melds.filter((meld) => meld.type !== MeldType.PAIR);
      if (nonPairMelds.length > 0 && nonPairMelds.every((meld) => meld.huPoints > 0)) {
        mingtangs.push(this.buildMingTang(MingTangType.KUN));
      }
    }

    if (this.isMingTangEnabled(MingTangType.GUI, options.enabledMingTangTypes)) {
      const guiCount = this.countGui(allCards);
      if (guiCount > 0) {
        const guiMingTang = this.buildMingTang(MingTangType.GUI);
        mingtangs.push({
          ...guiMingTang,
          fan: guiCount,
          description: `共有${guiCount}个归`,
        });
      }
    }

    if (this.isMingTangEnabled(MingTangType.ZI_MO, options.enabledMingTangTypes)
      && options.winType === WinType.SELF_DRAW) {
      mingtangs.push(this.buildMingTang(MingTangType.ZI_MO));
    }

    if (this.isMingTangEnabled(MingTangType.BAO, options.enabledMingTangTypes) && options.isBaoWin) {
      mingtangs.push(this.buildMingTang(MingTangType.BAO));
    }

    if (this.isMingTangEnabled(MingTangType.SHA_BAO, options.enabledMingTangTypes) && options.isShaBao) {
      mingtangs.push(this.buildMingTang(MingTangType.SHA_BAO));
    }

    return mingtangs;
  }

  /**
   * 计算牌型的胡息
   */
  calculateMeldHuPoints(meld: Meld): number {
    // 特殊吃牌顺子单独计算
    if (meld.type === MeldType.SEQUENCE) {
      const ranks = meld.cards.map(c => c.rank);
      const specialHu = getSpecialSequenceHu(ranks, meld.cards[0].size);
      if (specialHu !== null) {
        return specialHu;
      }
    }

    const cardInfo = {
      size: meld.cards[0].size,
      color: meld.cards[0].color
    };

    return getHuPoints(meld.type, cardInfo);
  }

  /**
   * 计算总分
   */
  calculateTotalScore(
    melds: Meld[],
    options: {
      winType?: WinType;
      isHeavenlyWin?: boolean;
      isFirstDrawWin?: boolean;
      isLastDrawWin?: boolean;
      isBaoWin?: boolean;
      isShaBao?: boolean;
      enabledMingTangTypes?: EnabledMingTangMap;
    } = {}
  ): ScoreResult {
    let totalHuPoints = 0;
    const meldScores: ScoreResult['meldScores'] = [];

    for (const meld of melds) {
      const score = this.calculateMeldHuPoints(meld);
      meld.huPoints = score;
      totalHuPoints += score;

      meldScores.push({
        meld,
        score
      });
    }

    const mingtangs = this.calculateMingTangs(melds, totalHuPoints, options);
    const baseScore = getBaseScoreByHu(totalHuPoints);
    const totalFans = BASE_FAN + mingtangs.reduce((sum, item) => sum + item.fan, 0);
    const bonusPoints = totalFans - BASE_FAN;
    const roundScore = baseScore * totalFans;
    const finalScore = roundScore;

    return {
      totalHuPoints,
      baseScore,
      meldScores,
      bonusPoints,
      mingtangs,
      totalFans,
      roundScore,
      finalScore
    };
  }

  /**
   * 检查是否胡牌
   */
  checkCanWin(
    melds: Meld[],
    totalHuPoints: number,
    isZeroHu: boolean,
    profile: Pick<RuleProfile, 'minHuPoints' | 'allowZeroHu'> = DEFAULT_RULE_PROFILE,
  ): boolean {
    const pairCount = melds.filter((m) => m.type === MeldType.PAIR).length;
    const groupCount = melds.length - pairCount;
    return checkWinCondition(totalHuPoints, groupCount, pairCount, isZeroHu, profile);
  }

  /**
   * 计算听牌（可以胡哪些牌）
   */
  calculateTingCards(handCards: Card[], knownCards: Set<string>): Card[] {
    const tingCards: Card[] = [];
    const meldDetector = new MeldDetector();

    const fullDeck = CardFactory.createDeck();
    const possibleCards = fullDeck.filter(card => !knownCards.has(card.id));

    const pairs = meldDetector.detectPairs(handCards);
    const triples = meldDetector.detectTriples(handCards);

    for (const card of possibleCards) {
      const newHandCards = [...handCards, card];

      const allMelds: Meld[] = [];
      allMelds.push(...pairs.melds);
      allMelds.push(...triples.melds);

      const newPairs = meldDetector.detectPairs(newHandCards);
      allMelds.push(...newPairs.melds);

      const newTriples = meldDetector.detectTriples(newHandCards);
      allMelds.push(...newTriples.melds);

      const sequences = meldDetector.detectSequences(newHandCards);
      allMelds.push(...sequences.melds);

      const special2710 = meldDetector.detectSpecial2710(newHandCards);
      allMelds.push(...special2710.melds);

      const { totalHuPoints } = this.calculateTotalScore(allMelds);

      const isZeroHu = totalHuPoints === 0;
      if (this.checkCanWin(allMelds, totalHuPoints, isZeroHu)) {
        tingCards.push(card);
      }
    }

    return tingCards;
  }

  /**
   * 计算牌型价值（用于AI评估）
   */
  calculateMeldValue(meld: Meld): number {
    let value = meld.huPoints;

    const redCards = meld.cards.filter(c => c.isRed);
    value += redCards.length * 0.5;

    const bigCards = meld.cards.filter(c => c.size === CardSize.BIG);
    value += bigCards.length * 0.3;

    if (meld.type === MeldType.SPECIAL_2710) {
      value += 2;
    }

    return value;
  }

  /**
   * 计算手牌总价值
   */
  calculateHandValue(melds: Meld[]): number {
    return melds.reduce((sum, meld) => sum + this.calculateMeldValue(meld), 0);
  }

  /**
   * 比较两个手牌的强弱
   */
  compareHands(melds1: Meld[], melds2: Meld[]): number {
    const value1 = this.calculateHandValue(melds1);
    const value2 = this.calculateHandValue(melds2);
    return value1 - value2;
  }
}
