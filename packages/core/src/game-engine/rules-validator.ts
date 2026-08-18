/**
 * 规则验证器
 * 验证游戏动作是否符合规则
 */

import { Card, Meld, MeldType, GameState, AvailableAction, GamePhase, CardSize, CompareCardResult, ChiOption, RuleProfile } from '../shared/types';
import { CardComparator, CardFactory } from '../shared/types/card';
import { isHeavenlyWin } from '../shared/constants';
import { MeldDetector } from './meld-detector';
import { ScoreCalculator } from './score-calculator';
import { canClaimActiveCard } from './passed-play';

/**
 * 规则验证器类
 */
export class RulesValidator {
  private meldDetector: MeldDetector;
  private scoreCalculator: ScoreCalculator;

  constructor() {
    this.meldDetector = new MeldDetector();
    this.scoreCalculator = new ScoreCalculator();
  }

  /**
   * 验证牌型是否有效
   */
  isValidMeld(cards: Card[], type: MeldType): boolean {
    if (cards.length === 0) return false;

    switch (type) {
      case MeldType.PAIR:
        return cards.length === 2 && CardComparator.isSame(cards[0], cards[1]);

      case MeldType.PENG:
      case MeldType.TRIPLE:
        return cards.length === 3 && cards.every(c => CardComparator.isSame(cards[0], c));

      case MeldType.QUADRUPLE:
      case MeldType.DRAW_QUADRUPLE:
        return cards.length === 4 && cards.every(c => CardComparator.isSame(cards[0], c));

      case MeldType.SEQUENCE:
        if (cards.length !== 3) return false;
        if (!cards.every(c => c.size === cards[0].size)) return false;
        {
          const seqValues = cards.map(c => c.value).sort((a, b) => a - b);
          return seqValues[1] === seqValues[0] + 1 && seqValues[2] === seqValues[1] + 1;
        }

      case MeldType.SPECIAL_2710:
        if (cards.length !== 3) return false;
        if (!cards.every(c => c.size === cards[0].size)) return false;
        {
          const specialValues = cards.map(c => c.value).sort((a, b) => a - b);
          return specialValues[0] === 2 && specialValues[1] === 7 && specialValues[2] === 10;
        }

      case MeldType.MIXED_SIZE:
        if (cards.length !== 3) return false;
        if (!cards.every(c => c.value === cards[0].value)) return false;
        const sizes = new Set(cards.map(c => c.size));
        return sizes.size === 2;

      default:
        return false;
    }
  }

  /**
   * 检查是否可以吃牌
   */
  canChi(handCards: Card[], targetCard: Card): boolean {
    return this.getValidChiOptions(handCards, targetCard).length > 0;
  }

  getValidChiOptions(handCards: Card[], targetCard: Card): ChiOption[] {
    const chiOptions: ChiOption[] = [];
    const seen = new Set<string>();
    const lockedCardIds = this.getLockedMeldCardIds(handCards);
    const unlockedCards = handCards.filter(c => !lockedCardIds.has(c.id));

    for (let i = 0; i < unlockedCards.length; i++) {
      for (let j = i + 1; j < unlockedCards.length; j++) {
        const selected = [unlockedCards[i], unlockedCards[j]];
        const allCards = [...selected, targetCard];
        const meldType = this.detectChiMeldType(allCards);
        if (!meldType || !this.isValidMeld(allCards, meldType)) continue;

        const compareResults = this.findCompareCardResults(handCards, allCards);
        for (const compareResult of compareResults) {
          const signature = this.buildChiOptionDisplaySignature(selected, targetCard, compareResult.additionalMelds);

          if (seen.has(signature)) {
            continue;
          }
          seen.add(signature);

          chiOptions.push({
            id: this.buildChiOptionId(selected, compareResult.additionalMelds),
            mainMeldCards: allCards,
            selectedCards: selected,
            additionalMelds: compareResult.additionalMelds,
            remainingCards: compareResult.remainingCards,
            description: this.buildChiOptionDescription(selected, targetCard, compareResult.additionalMelds),
          });
        }
      }
    }

    return chiOptions;
  }

  getValidChiSelections(handCards: Card[], targetCard: Card): Card[][] {
    const seen = new Set<string>();
    return this.getValidChiOptions(handCards, targetCard)
      .map(option => option.selectedCards)
      .filter((cards) => {
        const signature = cards.map(card => card.id).sort().join(',');
        if (seen.has(signature)) {
          return false;
        }
        seen.add(signature);
        return true;
      });
  }

  checkCompareCards(handCards: Card[], chiCards: Card[]): CompareCardResult {
    const results = this.findCompareCardResults(handCards, chiCards);
    if (results.length > 0) {
      return results[0];
    }

    const failureReason = this.getCompareCardFailureReason(handCards, chiCards);
    return {
      canChi: false,
      remainingCards: handCards,
      additionalMelds: [],
      reason: failureReason,
    };
  }

  canFormSequenceWithCard(
    handCards: Card[], 
    targetCard: Card,
    lockedCardIds?: Set<string>
  ): { canForm: boolean; meld?: Meld; usedCards: Card[] } {
    const options = this.getSequenceOptionsWithCard(handCards, targetCard, lockedCardIds);
    if (options.length === 0) {
      return { canForm: false, usedCards: [] };
    }

    return {
      canForm: true,
      meld: options[0].meld,
      usedCards: options[0].usedCards,
    };
  }

  private getSequenceOptionsWithCard(
    handCards: Card[],
    targetCard: Card,
    lockedCardIds?: Set<string>
  ): Array<{ meld: Meld; usedCards: Card[] }> {
    if (lockedCardIds?.has(targetCard.id)) {
      return [];
    }

    const pushOption = (
      options: Array<{ meld: Meld; usedCards: Card[] }>,
      seen: Set<string>,
      type: MeldType,
      cards: Card[],
    ) => {
      const signature = cards.map(card => card.id).sort().join(',');
      if (seen.has(signature)) {
        return;
      }
      seen.add(signature);

      const meld: Meld = {
        type,
        cards,
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      };
      meld.huPoints = this.scoreCalculator.calculateMeldHuPoints(meld);
      options.push({ meld, usedCards: cards });
    };

    const options: Array<{ meld: Meld; usedCards: Card[] }> = [];
    const seen = new Set<string>();
    const sameTypeCards = handCards.filter(c => c.size === targetCard.size);
    const targetValue = targetCard.value;

    if (targetValue <= 8) {
      const nextCards = sameTypeCards.filter(c => c.value === targetValue + 1 && !lockedCardIds?.has(c.id));
      const nextNextCards = sameTypeCards.filter(c => c.value === targetValue + 2 && !lockedCardIds?.has(c.id));
      for (const card2 of nextCards) {
        for (const card3 of nextNextCards) {
          pushOption(options, seen, MeldType.SEQUENCE, [targetCard, card2, card3]);
        }
      }
    }

    if (targetValue >= 2 && targetValue <= 9) {
      const prevCards = sameTypeCards.filter(c => c.value === targetValue - 1 && !lockedCardIds?.has(c.id));
      const nextCards = sameTypeCards.filter(c => c.value === targetValue + 1 && !lockedCardIds?.has(c.id));
      for (const card1 of prevCards) {
        for (const card3 of nextCards) {
          pushOption(options, seen, MeldType.SEQUENCE, [card1, targetCard, card3]);
        }
      }
    }

    if (targetValue >= 3) {
      const prevPrevCards = sameTypeCards.filter(c => c.value === targetValue - 2 && !lockedCardIds?.has(c.id));
      const prevCards = sameTypeCards.filter(c => c.value === targetValue - 1 && !lockedCardIds?.has(c.id));
      for (const card1 of prevPrevCards) {
        for (const card2 of prevCards) {
          pushOption(options, seen, MeldType.SEQUENCE, [card1, card2, targetCard]);
        }
      }
    }

    if ([2, 7, 10].includes(targetValue)) {
      const twos = targetValue === 2 ? [targetCard] : sameTypeCards.filter(c => c.value === 2 && !lockedCardIds?.has(c.id));
      const sevens = targetValue === 7 ? [targetCard] : sameTypeCards.filter(c => c.value === 7 && !lockedCardIds?.has(c.id));
      const tens = targetValue === 10 ? [targetCard] : sameTypeCards.filter(c => c.value === 10 && !lockedCardIds?.has(c.id));

      for (const card2 of twos) {
        for (const card7 of sevens) {
          for (const card10 of tens) {
            pushOption(options, seen, MeldType.SPECIAL_2710, [card2, card7, card10]);
          }
        }
      }
    }

    const sameValueCards = handCards.filter(c =>
      c.value === targetCard.value && c.id !== targetCard.id && !lockedCardIds?.has(c.id)
    );
    const sameSizeCards = sameValueCards.filter(c => c.size === targetCard.size);
    const diffSizeCards = sameValueCards.filter(c => c.size !== targetCard.size);

    for (const sameSizeCard of sameSizeCards) {
      for (const diffSizeCard of diffSizeCards) {
        pushOption(options, seen, MeldType.MIXED_SIZE, [targetCard, sameSizeCard, diffSizeCard]);
      }
    }

    for (let i = 0; i < diffSizeCards.length; i++) {
      for (let j = i + 1; j < diffSizeCards.length; j++) {
        pushOption(options, seen, MeldType.MIXED_SIZE, [targetCard, diffSizeCards[i], diffSizeCards[j]]);
      }
    }

    return options;
  }

  private findCompareCardResults(handCards: Card[], chiCards: Card[]): CompareCardResult[] {
    const usedCardIds = new Set<string>();
    chiCards.forEach(c => usedCardIds.add(c.id));

    const targetCard = chiCards[chiCards.length - 1];
    const lockedCardIds = this.getLockedMeldCardIds(handCards);
    const compareCards = handCards.filter(card =>
      !usedCardIds.has(card.id) &&
      card.rank === targetCard.rank &&
      card.size === targetCard.size
    );

    if (compareCards.some(card => lockedCardIds.has(card.id))) {
      return [];
    }

    const availableCards = handCards.filter(card =>
      !usedCardIds.has(card.id) &&
      !compareCards.some(compareCard => compareCard.id === card.id)
    );

    const search = (
      pendingCompareCards: Card[],
      remainingCards: Card[],
      additionalMelds: Meld[],
      consumedIds: Set<string>,
    ): CompareCardResult[] => {
      if (pendingCompareCards.length === 0) {
        const finalUsedIds = new Set<string>([...usedCardIds, ...consumedIds]);
        return [{
          canChi: true,
          remainingCards: handCards.filter(card => !finalUsedIds.has(card.id)),
          additionalMelds,
        }];
      }

      const [currentCompareCard, ...restCompareCards] = pendingCompareCards;
      const sequenceOptions = this.getSequenceOptionsWithCard(remainingCards, currentCompareCard, lockedCardIds);
      if (sequenceOptions.length === 0) {
        return [];
      }

      const results: CompareCardResult[] = [];
      for (const option of sequenceOptions) {
        const nextRemainingCards = remainingCards.filter(card =>
          !option.usedCards.some(usedCard => usedCard.id === card.id)
        );
        const nextConsumedIds = new Set<string>([
          ...consumedIds,
          currentCompareCard.id,
          ...option.usedCards.map(card => card.id),
        ]);
        results.push(...search(restCompareCards, nextRemainingCards, [...additionalMelds, option.meld], nextConsumedIds));
      }

      return results;
    };

    return search(compareCards, availableCards, [], new Set<string>());
  }

  private getCompareCardFailureReason(handCards: Card[], chiCards: Card[]): string {
    const usedCardIds = new Set<string>(chiCards.map(card => card.id));
    const targetCard = chiCards[chiCards.length - 1];
    const lockedCardIds = this.getLockedMeldCardIds(handCards);
    const compareCards = handCards.filter(card =>
      !usedCardIds.has(card.id) &&
      card.rank === targetCard.rank &&
      card.size === targetCard.size
    );

    for (const compareCard of compareCards) {
      if (lockedCardIds.has(compareCard.id)) {
        return `比牌${compareCard.rank}位于坎/垅中，不能拆坎比牌`;
      }
    }

    for (const compareCard of compareCards) {
      const remainingCards = handCards.filter(card =>
        !usedCardIds.has(card.id) &&
        !compareCards.some(compare => compare.id === card.id)
      );
      if (this.getSequenceOptionsWithCard(remainingCards, compareCard, lockedCardIds).length === 0) {
        return `比牌${compareCard.rank}无法组成顺子，不能吃牌`;
      }
    }

    return '当前吃牌方案不存在合法比牌组合';
  }

  private buildChiOptionDescription(selectedCards: Card[], targetCard: Card, additionalMelds: Meld[]): string {
    const formatCards = (cards: Card[]) => cards.map(card => `${card.rank}${card.size === CardSize.SMALL ? '小' : '大'}`).join(' ');
    const mainText = `吃牌：${formatCards([targetCard, ...selectedCards])}`;
    if (additionalMelds.length === 0) {
      return mainText;
    }

    const compareText = additionalMelds
      .map((meld, index) => `比牌${index + 1}：${formatCards(meld.cards)}`)
      .join('；');
    return `${mainText}；${compareText}`;
  }

  private buildChiOptionId(selectedCards: Card[], additionalMelds: Meld[]): string {
    const selectedPart = selectedCards.map(card => card.id).sort().join('_');
    const comparePart = additionalMelds
      .map((meld) => meld.cards.map(card => card.id).sort().join('_'))
      .sort()
      .join('__');
    return `chi_${selectedPart}__${comparePart || 'base'}`;
  }

  private buildChiOptionDisplaySignature(selectedCards: Card[], targetCard: Card, additionalMelds: Meld[]): string {
    const toCardKey = (card: Card) => `${card.value}-${card.size}`;
    return [[targetCard, ...selectedCards], ...additionalMelds.map((meld) => meld.cards)]
      .map((cards) => cards.map(toCardKey).sort().join('_'))
      .sort()
      .join('__');
  }

  getLockedMeldCardIds(handCards: Card[]): Set<string> {
    const locked = new Set<string>();
    const triples = this.meldDetector.detectTriples(handCards).melds;
    const quads = this.meldDetector.detectQuadruples(handCards).melds;

    for (const meld of [...triples, ...quads]) {
      for (const card of meld.cards) {
        locked.add(card.id);
      }
    }

    return locked;
  }

  detectChiMeldType(cards: Card[]): MeldType | null {
    if (cards.length !== 3) return null;

    const sameValue = cards.every(c => c.value === cards[0].value);
    const mixedSize = new Set(cards.map(c => c.size)).size === 2;
    if (sameValue && mixedSize) {
      return MeldType.MIXED_SIZE;
    }

    const values = cards.map(c => c.value).sort((a, b) => a - b);
    if (values[0] === 2 && values[1] === 7 && values[2] === 10) {
      return MeldType.SPECIAL_2710;
    }

    const sameSize = cards.every(c => c.size === cards[0].size);
    if (sameSize && values[1] === values[0] + 1 && values[2] === values[1] + 1) {
      return MeldType.SEQUENCE;
    }

    return null;
  }

  canPeng(handCards: Card[], targetCard: Card): boolean {
    const sameCards = handCards.filter(c => CardComparator.isSame(c, targetCard));
    return sameCards.length >= 2;
  }

  /**
   * 检查是否可以招牌
   */
  canZhao(handCards: Card[], targetCard: Card): boolean {
    const sameCards = handCards.filter(c => CardComparator.isSame(c, targetCard));
    return sameCards.length >= 3;
  }

  getBaoTingCards(
    handCards: Card[],
    melds: Meld[] = [],
    profile?: Pick<RuleProfile, 'minHuPoints' | 'allowZeroHu'>,
  ): Card[] {
    const fullDeck = CardFactory.createDeck();
    const existingCounts = new Map<string, number>();

    for (const card of [...handCards, ...melds.flatMap((meld) => meld.cards || [])]) {
      const key = `${card.size}-${card.value}`;
      existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
    }

    const candidates = new Map<string, Card>();
    for (const card of fullDeck) {
      const key = `${card.size}-${card.value}`;
      if ((existingCounts.get(key) || 0) >= 4 || candidates.has(key)) {
        continue;
      }
      candidates.set(key, card);
    }

    return Array.from(candidates.values()).filter((card) => (
      this.canHu(handCards, melds, card, 'draw', profile)
      || this.getHuChiOptions(handCards, melds, card, profile).length > 0
    ));
  }

  getBaoDiscardCandidates(
    handCards: Card[],
    melds: Meld[] = [],
    profile?: Pick<RuleProfile, 'minHuPoints' | 'allowZeroHu'>,
  ): Array<{ discardCard: Card; tingCards: Card[] }> {
    const lockedCardIds = this.getLockedOpeningCardIds(handCards);
    return handCards
      .map((discardCard) => {
        const remainingCards = handCards.filter((card) => card.id !== discardCard.id);
        return {
          discardCard,
          tingCards: this.getBaoTingCards(remainingCards, melds, profile),
        };
      })
      .filter((candidate) => !lockedCardIds.has(candidate.discardCard.id) && candidate.tingCards.length > 0);
  }

  private getLockedOpeningCardIds(handCards: Card[]): Set<string> {
    const lockedCardIds = new Set<string>();
    const lockedQuadruples = this.meldDetector.detectQuadruples(handCards).melds;
    for (const meld of lockedQuadruples) {
      for (const card of meld.cards) {
        lockedCardIds.add(card.id);
      }
    }

    const tripleCandidates = handCards.filter((card) => !lockedCardIds.has(card.id));
    const lockedTriples = this.meldDetector.detectTriples(tripleCandidates).melds;
    for (const meld of lockedTriples) {
      for (const card of meld.cards) {
        lockedCardIds.add(card.id);
      }
    }
    return lockedCardIds;
  }

  /**
   * 检查是否可以胡牌
   */
  canHu(
    handCards: Card[],
    melds: Meld[],
    activeCard?: Card,
    activeCardSource?: 'discard' | 'draw',
    profile?: Pick<RuleProfile, 'minHuPoints' | 'allowZeroHu'>,
  ): boolean {
    const effectiveHandCards = activeCard ? [...handCards, activeCard] : handCards;
    const winningHandMelds = this.findWinningHandMelds(effectiveHandCards, melds, activeCard, activeCardSource, profile);
    if (!winningHandMelds) return false;

    const allMelds = [...melds, ...winningHandMelds];
    if (!this.isValidHuStructure(allMelds)) return false;
    const { totalHuPoints } = this.scoreCalculator.calculateTotalScore(allMelds);
    const isZeroHu = totalHuPoints === 0;
    return this.scoreCalculator.checkCanWin(allMelds, totalHuPoints, isZeroHu, profile);
  }

  getHuChiOptions(
    handCards: Card[],
    melds: Meld[],
    activeCard?: Card,
    profile?: Pick<RuleProfile, 'minHuPoints' | 'allowZeroHu'>,
  ): ChiOption[] {
    if (!activeCard) {
      return [];
    }

    const chiOptions = this.getValidChiOptions(handCards, activeCard);
    return chiOptions.filter((option) => {
      const mainMeldType = this.detectChiMeldType(option.mainMeldCards);
      if (!mainMeldType) {
        return false;
      }

      const mainMeld: Meld = {
        type: mainMeldType,
        cards: option.mainMeldCards,
        isConcealed: false,
        position: 'table',
        huPoints: 0,
      };
      mainMeld.huPoints = this.scoreCalculator.calculateMeldHuPoints(mainMeld);

      const landedMelds = [...melds, mainMeld, ...option.additionalMelds];
      const winningHandMelds = this.findWinningHandMelds(option.remainingCards, landedMelds, undefined, undefined, profile);
      if (!winningHandMelds) {
        return false;
      }

      const allMelds = [...landedMelds, ...winningHandMelds];
      if (!this.isValidHuStructure(allMelds)) {
        return false;
      }

      const { totalHuPoints } = this.scoreCalculator.calculateTotalScore(allMelds);
      const isZeroHu = totalHuPoints === 0;
      return this.scoreCalculator.checkCanWin(allMelds, totalHuPoints, isZeroHu, profile);
    });
  }

  /**
   * 新胡牌结构规则（V3修订）：
   * 1) 总是7个牌组单元
   * 2) 4张组仅统计 ZHAO/LONG（DRAW_QUADRUPLE/QUADRUPLE）
   * 3) 若4张组数=0，则将牌数必须=0
   * 4) 若4张组数>=1，则将牌数必须=1
   * 5) 3张组数量满足 g = 7 - h - p
   */
  private isValidHuStructure(allMelds: Meld[]): boolean {
    const heavyQuadCount = allMelds.filter(
      (m) => m.type === MeldType.QUADRUPLE || m.type === MeldType.DRAW_QUADRUPLE,
    ).length;

    const pairCount = allMelds.filter((m) => m.type === MeldType.PAIR).length;

    const expectedPairCount = heavyQuadCount >= 1 ? 1 : 0;
    if (pairCount !== expectedPairCount) {
      return false;
    }

    const tripleGroupCount = allMelds.filter(
      (m) => m.type !== MeldType.PAIR && m.type !== MeldType.QUADRUPLE && m.type !== MeldType.DRAW_QUADRUPLE,
    ).length;

    const expectedTripleGroupCount = 7 - heavyQuadCount - expectedPairCount;
    if (expectedTripleGroupCount < 0) {
      return false;
    }

    if (tripleGroupCount !== expectedTripleGroupCount) {
      return false;
    }

    if (allMelds.length !== 7) {
      return false;
    }

    // 兜底校验：每个牌组张数必须匹配其类型
    for (const meld of allMelds) {
      if (meld.type === MeldType.PAIR && meld.cards.length !== 2) return false;
      if ((meld.type === MeldType.QUADRUPLE || meld.type === MeldType.DRAW_QUADRUPLE) && meld.cards.length !== 4) return false;
      if (
        meld.type !== MeldType.PAIR &&
        meld.type !== MeldType.QUADRUPLE &&
        meld.type !== MeldType.DRAW_QUADRUPLE &&
        meld.cards.length !== 3
      ) {
        return false;
      }
    }

    return true;
  }

  public findWinningHandMelds(
    handCards: Card[],
    tableMelds: Meld[],
    activeCard?: Card,
    _activeCardSource?: 'discard' | 'draw',
    profile?: Pick<RuleProfile, 'minHuPoints' | 'allowZeroHu'>,
  ): Meld[] | null {
    const tablePairCount = tableMelds.filter((m) => m.type === MeldType.PAIR).length;
    const tableGroupCount = tableMelds.length - tablePairCount;

    if (tablePairCount > 1 || tableGroupCount > 7) return null;

    const baseHandCards = activeCard
      ? handCards.filter((card) => card.id !== activeCard.id)
      : handCards;

    const lockedQuadruples = this.meldDetector.detectQuadruples(baseHandCards).melds;
    const lockedTriples = this.meldDetector.detectTriples(
      baseHandCards.filter(
        (card) => !lockedQuadruples.some((meld) => meld.cards.some((meldCard) => meldCard.id === card.id)),
      ),
    ).melds;

    const lockedCardIds = new Set<string>();
    const lockedCardGroupSizes = new Map<string, 3 | 4>();
    for (const meld of lockedQuadruples) {
      for (const card of meld.cards) {
        lockedCardIds.add(card.id);
        lockedCardGroupSizes.set(card.id, 4);
      }
    }
    for (const meld of lockedTriples) {
      for (const card of meld.cards) {
        if (lockedCardIds.has(card.id)) {
          continue;
        }
        lockedCardIds.add(card.id);
        lockedCardGroupSizes.set(card.id, 3);
      }
    }

    const sorted = [...handCards].sort((a, b) => {
      if (a.value !== b.value) return a.value - b.value;
      if (a.size !== b.size) return a.size === CardSize.SMALL ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

    const removeCards = (source: Card[], toRemove: Card[]): Card[] => {
      const ids = new Set(toRemove.map((c) => c.id));
      return source.filter((c) => !ids.has(c.id));
    };

    const toMeld = (type: MeldType, cards: Card[]): Meld => ({
      type,
      cards,
      isConcealed: true,
      position: 'hand',
      huPoints: 0,
    });

    const resolveTripleLikeMeldType = (cards: Card[]): MeldType => {
      const includesActiveCard = !!activeCard && cards.some((card) => card.id === activeCard.id);
      if (includesActiveCard) {
        return MeldType.PENG;
      }
      return MeldType.TRIPLE;
    };

    const dfs = (remaining: Card[], acc: Meld[], pairCountInHand: number): Meld[] | null => {
      const currentPairCount = tablePairCount + pairCountInHand;
      const currentGroupCount = tableGroupCount + acc.filter((m) => m.type !== MeldType.PAIR).length;

      if (currentPairCount > 1 || currentGroupCount > 7) {
        return null;
      }

      if (remaining.length === 0) {
        const all = [...tableMelds, ...acc];
        if (!this.isValidHuStructure(all)) {
          return null;
        }
        const { totalHuPoints } = this.scoreCalculator.calculateTotalScore(all);
        const isZeroHu = totalHuPoints === 0;
        if (this.scoreCalculator.checkCanWin(all, totalHuPoints, isZeroHu, profile)) {
          return acc;
        }
        return null;
      }

      const pivot = remaining[0];
      const same = remaining.filter((c) => CardComparator.isSame(c, pivot));
      const lockedGroupSize = lockedCardGroupSizes.get(pivot.id);
      const isLockedPivot = lockedGroupSize === 3 || lockedGroupSize === 4;
      const lockedSame = same.filter((card) => lockedCardIds.has(card.id));
      const unlockedSame = same.filter((card) => !lockedCardIds.has(card.id));

      // 对子（最多1对）
      if (!isLockedPivot && unlockedSame.length >= 2 && currentPairCount === 0) {
        const used = [unlockedSame[0], unlockedSame[1]];
        const found = dfs(removeCards(remaining, used), [...acc, toMeld(MeldType.PAIR, used)], pairCountInHand + 1);
        if (found) return found;
      }

      // 坎
      const canUseLockedTriple = lockedGroupSize === 3 && lockedSame.length >= 3;
      if (canUseLockedTriple || (!isLockedPivot && unlockedSame.length >= 3)) {
        const used = canUseLockedTriple ? lockedSame.slice(0, 3) : unlockedSame.slice(0, 3);
        const found = dfs(
          removeCards(remaining, used),
          [...acc, toMeld(resolveTripleLikeMeldType(used), used)],
          pairCountInHand,
        );
        if (found) return found;
      }

      // 垅
      const canUseLockedQuadruple = lockedGroupSize === 4 && lockedSame.length >= 4;
      if (canUseLockedQuadruple || (!isLockedPivot && unlockedSame.length >= 4)) {
        const used = canUseLockedQuadruple ? lockedSame.slice(0, 4) : unlockedSame.slice(0, 4);
        const found = dfs(removeCards(remaining, used), [...acc, toMeld(MeldType.QUADRUPLE, used)], pairCountInHand);
        if (found) return found;
      }

      // 顺子
      if (!isLockedPivot) {
        const seq2 = remaining.find((c) => c.size === pivot.size && c.value === pivot.value + 1 && c.id !== pivot.id && !lockedCardIds.has(c.id));
        const seq3 = remaining.find((c) => c.size === pivot.size && c.value === pivot.value + 2 && c.id !== pivot.id && !lockedCardIds.has(c.id));
        if (seq2 && seq3) {
          const used = [pivot, seq2, seq3];
          const found = dfs(removeCards(remaining, used), [...acc, toMeld(MeldType.SEQUENCE, used)], pairCountInHand);
          if (found) return found;
        }

        // 二七十
        if ([2, 7, 10].includes(pivot.value)) {
          const need = [2, 7, 10].filter((v) => v !== pivot.value);
          const c1 = remaining.find((c) => c.size === pivot.size && c.value === need[0] && c.id !== pivot.id && !lockedCardIds.has(c.id));
          const c2 = remaining.find((c) => c.size === pivot.size && c.value === need[1] && c.id !== pivot.id && !lockedCardIds.has(c.id));
          if (c1 && c2) {
            const used = [pivot, c1, c2];
            const found = dfs(removeCards(remaining, used), [...acc, toMeld(MeldType.SPECIAL_2710, used)], pairCountInHand);
            if (found) return found;
          }
        }

        // 大小搭
        const sameValue = remaining.filter((c) => c.value === pivot.value && !lockedCardIds.has(c.id));
        const sameSize = sameValue.filter((c) => c.size === pivot.size);
        const diffSize = sameValue.filter((c) => c.size !== pivot.size);
        if (sameSize.length >= 2 && diffSize.length >= 1) {
          const used = [sameSize[0], sameSize[1], diffSize[0]];
          const found = dfs(removeCards(remaining, used), [...acc, toMeld(MeldType.MIXED_SIZE, used)], pairCountInHand);
          if (found) return found;
        }
        if (diffSize.length >= 2) {
          const used = [pivot, diffSize[0], diffSize[1]];
          const found = dfs(removeCards(remaining, used), [...acc, toMeld(MeldType.MIXED_SIZE, used)], pairCountInHand);
          if (found) return found;
        }
      }

      return null;
    };

    return dfs(sorted, [], 0);
  }

  /**
   * 获取强制操作
   * R7.4.1: 有招必招，除非可胡（胡牌优先）
   * R7.4.2: 有碰必碰，除非可胡或可招（优先级：胡>招>碰）
   */
  getMandatoryActions(state: GameState): AvailableAction[] {
    const actions: AvailableAction[] = [];
    const currentPlayer = state.players[state.currentPlayerIndex];
    const currentCard = state.discardPile.lastDiscard;

    // 仅在响应收集阶段才检查强制响应
    if (state.phase !== GamePhase.RESPONSE_COLLECTING) return actions;
    if (!currentCard) return actions;

    // 自己打出的牌不可响应（自己翻牌可响应）
    const isOwnDiscard = state.pendingCardSource === 'discard' &&
      state.discardPile.lastDiscardPlayerIndex === state.currentPlayerIndex;
    if (isOwnDiscard) {
      return actions;
    }

    // 首先检查是否可以胡牌（最高优先级）
    const canHuNow = canClaimActiveCard(state, state.currentPlayerIndex, currentCard, 'hu').allowed && this.canHu(
      currentPlayer.cards,
      currentPlayer.melds,
      currentCard,
      state.pendingCardSource,
      state.ruleProfile,
    );
    if (canHuNow) {
      // 如果可以胡牌，不强制其他操作
      return actions;
    }

    // R7.4.1: 有招必招（除非可胡）
    if (state.ruleProfile?.mandatoryZhao !== false && this.canZhao(currentPlayer.cards, currentCard)) {
      actions.push({
        type: 'zhao',
        cards: [currentCard],
        isMandatory: true,
        description: '必须招牌（R7.4.1）'
      });
      // 招牌优先级高于碰牌，返回招牌
      return actions;
    }

    // R7.4.2: 有碰必碰（除非可胡或可招）
    if (state.ruleProfile?.mandatoryPeng !== false && !currentPlayer.isBao && this.canPeng(currentPlayer.cards, currentCard)) {
      actions.push({
        type: 'peng',
        cards: [currentCard],
        isMandatory: true,
        description: '必须碰牌（R7.4.2）'
      });
    }

    return actions;
  }

  /**
   * 检查是否形成八块
   */
  hasEightBlocks(melds: Meld[]): boolean {
    let count = 0;
    for (const meld of melds) {
      if (meld.type === MeldType.QUADRUPLE || meld.type === MeldType.DRAW_QUADRUPLE) {
        count++;
      }
    }
    return count >= 2;
  }

  /**
   * 检查是否可以胜利（供胜率计算器使用）
   */
  checkCanWin(
    remainingCards: Card[],
    melds: Meld[],
    totalHuPoints: number,
    profile?: Pick<RuleProfile, 'minHuPoints' | 'allowZeroHu'>,
  ): boolean {
    const isZeroHu = totalHuPoints === 0;
    return this.scoreCalculator.checkCanWin(melds, totalHuPoints, isZeroHu, profile);
  }

  /**
   * 检查是否为天胡
   */
  checkHeavenlyWin(handCards: Card[]): boolean {
    const stats = this.meldDetector.calculateStats(handCards);
    return isHeavenlyWin(stats.quadruples, stats.triples);
  }

  /**
   * 验证游戏状态
   */
  validateGameState(state: GameState): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (state.players.length !== 3) {
      errors.push(`无效的玩家数量: ${state.players.length}`);
    }

    if (state.currentPlayerIndex < 0 || state.currentPlayerIndex >= state.players.length) {
      errors.push(`无效的当前玩家索引: ${state.currentPlayerIndex}`);
    }

    for (let i = 0; i < state.players.length; i++) {
      const player = state.players[i];
      // 爆牌选择阶段所有玩家都只有正式的20张基础牌；庄家第21张牌
      // 只存在于 dealerPendingCard，不能同时计入庄家手牌。
      const expectedCards = state.phase === GamePhase.BAO_SELECTION
        ? 20
        : (player.isDealer && player.isBao ? 20 : (player.isDealer ? 21 : 20));
      const totalCards = player.cards.length +
        player.melds.reduce((sum, m) => sum + m.cards.length, 0);

      if (player.hasEightBlocks && totalCards === expectedCards + 1) {
        continue;
      }

      if (totalCards !== expectedCards && !state.isGameOver) {
        errors.push(`玩家 ${i} 手牌数异常: 期望 ${expectedCards}, 实际 ${totalCards}`);
      }
    }

    if (state.phase === GamePhase.BAO_SELECTION && !state.dealerPendingCard) {
      errors.push('爆牌选择阶段缺少庄家待处理第21张牌');
    }

    if (state.phase === GamePhase.BAO_SELECTION && state.dealerPendingCard) {
      const playerOwnedIds = new Set(state.players.flatMap((player) => [
        ...player.cards,
        ...player.melds.flatMap((meld) => meld.cards),
      ].map((card) => card.id)));
      const discardOwnedIds = new Set((state.discardPile.cards || []).map((card) => card.id));
      if (playerOwnedIds.has(state.dealerPendingCard.id) || discardOwnedIds.has(state.dealerPendingCard.id)) {
        errors.push('庄家待处理牌同时存在于其他所有权区域');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
