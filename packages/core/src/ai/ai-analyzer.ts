/**
 * AI 分析引擎
 * 综合分析游戏局势，提供更偏教学的出牌建议
 */

import { Card, Meld, AIAnalysis, GameState, CardColor, CardSize, AvailableAction } from '../shared/types';
import type { AIPlayRecommendation } from './types';
import { OpponentInference } from './opponent-inference';
import { WinRateCalculator } from './win-rate-calculator';
import { StrategyEvaluator } from './strategy-evaluator';
import { AIExplanationEngine } from './explanation-engine';
import { ActionEvEvaluator } from './action-ev-evaluator';
import { AIRecommendationGenerator, type ListeningInfo, type CardProfile, type DangerInfo, type ProjectedStateInfo } from './recommendation-generator';
import { HandAnalyzer } from '../game-engine/hand-analyzer';
import { RulesValidator } from '../game-engine/rules-validator';
import { ScoreCalculator } from '../game-engine/score-calculator';
import type { AIDecisionEvidence, AIRankedAction, ActionScoreBreakdown } from './types';

export interface AnalysisConfig {
  simulationCount?: number;
  maxTime?: number;
  discardTopK?: number;
  chiOptionTopK?: number;
  policyMode?: 'heuristic' | 'learned';
}

const DEFAULT_ANALYSIS_CONFIG: Required<Pick<AnalysisConfig, 'discardTopK' | 'chiOptionTopK' | 'policyMode'>> = {
  discardTopK: 5,
  chiOptionTopK: 3,
  policyMode: 'heuristic',
};

export class AIAnalyzer {
  private opponentInference: OpponentInference;
  private winRateCalculator: WinRateCalculator;
  private strategyEvaluator: StrategyEvaluator;
  private explanationEngine: AIExplanationEngine;
  private actionEvEvaluator: ActionEvEvaluator;
  private recommendationGenerator: AIRecommendationGenerator;
  private handAnalyzer: HandAnalyzer;
  private rulesValidator: RulesValidator;
  private scoreCalculator: ScoreCalculator;
  private listeningCache: Map<string, ListeningInfo>;
  private visibleCountsCache: Map<string, Map<string, number>>;
  private projectedStateCache: Map<string, ProjectedStateInfo>;
  private currentAnalysisConfig: AnalysisConfig;

  constructor() {
    this.opponentInference = new OpponentInference();
    this.winRateCalculator = new WinRateCalculator();
    this.strategyEvaluator = new StrategyEvaluator();
    this.explanationEngine = new AIExplanationEngine();
    this.actionEvEvaluator = new ActionEvEvaluator();
    this.handAnalyzer = new HandAnalyzer();
    this.rulesValidator = new RulesValidator();
    this.scoreCalculator = new ScoreCalculator();
    this.listeningCache = new Map();
    this.visibleCountsCache = new Map();
    this.projectedStateCache = new Map();
    this.currentAnalysisConfig = { ...DEFAULT_ANALYSIS_CONFIG };
    this.recommendationGenerator = new AIRecommendationGenerator({
      handAnalyzer: this.handAnalyzer,
      rulesValidator: this.rulesValidator,
      evaluateProjectedState: this.evaluateProjectedState.bind(this),
      evaluateDiscardListening: this.evaluateDiscardListening.bind(this),
      buildDecisionEvidence: this.buildDecisionEvidence.bind(this),
      buildEvBreakdown: this.buildEvBreakdown.bind(this),
      buildTeachingPayload: this.buildTeachingPayload.bind(this),
      buildRecommendationSummary: this.buildRecommendationSummary.bind(this),
      buildDiscardKeyPoints: this.buildDiscardKeyPoints.bind(this),
      getCardConnectionProfile: this.getCardConnectionProfile.bind(this),
      calculateKeepValue: this.calculateKeepValue.bind(this),
      generateDiscardReasoning: this.generateDiscardReasoning.bind(this),
      formatCardCode: this.formatCardCode.bind(this),
      assessDiscardDanger: this.assessDiscardDanger.bind(this),
    });
  }

  private formatCardCode(card: Card): string {
    return `${card.size === CardSize.SMALL ? 'S' : 'B'}${card.value}`;
  }

  private buildListeningCacheKey(handCards: Card[], melds: Meld[]): string {
    const handSignature = handCards
      .map((card) => `${card.size}_${card.value}`)
      .sort()
      .join('|');
    const meldSignature = melds
      .map((meld) => `${meld.type}:${meld.cards.map((card) => `${card.size}_${card.value}`).sort().join(',')}`)
      .sort()
      .join('|');

    return `${handSignature}__${meldSignature}`;
  }

  private buildGameStateCacheKey(gameState: GameState): string {
    return [
      gameState.phase,
      gameState.turnCount,
      gameState.currentPlayerIndex,
      gameState.remainingDeckCards,
      gameState.discardPile?.cards?.length || 0,
      gameState.discardPile?.lastDiscard?.id || 'none',
      gameState.pendingCardSource || 'none',
    ].join('|');
  }

  private buildProjectedStateCacheKey(
    handCards: Card[],
    melds: Meld[],
    discardedCards: Card[],
    gameState?: GameState,
  ): string {
    const base = this.buildListeningCacheKey(handCards, melds);
    const discardedSignature = discardedCards.length === 0
      ? 'none'
      : discardedCards.slice(-4).map((card) => card.id).join(',');
    const stateSignature = gameState ? this.buildGameStateCacheKey(gameState) : 'no_state';
    return `${base}__d:${discardedCards.length}:${discardedSignature}__g:${stateSignature}`;
  }

  private createVirtualCard(size: CardSize, value: number): Card {
    const smallRanks = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;
    const bigRanks = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'] as const;
    const isRed = value === 2 || value === 7 || value === 10;

    return {
      id: `analysis_${size}_${value}`,
      rank: size === CardSize.SMALL ? smallRanks[value - 1] : bigRanks[value - 1],
      size,
      color: isRed ? CardColor.RED : CardColor.BLACK,
      value: value as Card['value'],
      isRed,
    };
  }

  private collectVisibleCardCodeCounts(gameState: GameState): Map<string, number> {
    const stateKey = this.buildGameStateCacheKey(gameState);
    const cached = this.visibleCountsCache.get(stateKey);
    if (cached) {
      return cached;
    }

    const counts = new Map<string, number>();
    const seenIds = new Set<string>();
    const addCard = (card?: Card) => {
      if (!card || seenIds.has(card.id)) return;
      seenIds.add(card.id);
      const code = this.formatCardCode(card);
      counts.set(code, (counts.get(code) || 0) + 1);
    };

    for (const player of gameState.players || []) {
      for (const card of player.cards || []) addCard(card);
      for (const meld of player.melds || []) {
        for (const card of meld.cards || []) addCard(card);
      }
    }

    for (const card of gameState.discardPile?.cards || []) addCard(card);
    addCard(gameState.discardPile?.lastDiscard);
    this.visibleCountsCache.set(stateKey, counts);
    return counts;
  }

  private evaluateDiscardListening(gameState: GameState, handCards: Card[], melds: Meld[]): ListeningInfo {
    const cacheKey = this.buildListeningCacheKey(handCards, melds);
    const cached = this.listeningCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const visibleCounts = this.collectVisibleCardCodeCounts(gameState);
    const waitOutcomes: Array<{ code: string; remaining: number; huPoints: number; roundScore: number; mingTangNames: string[] }> = [];
    const currentAnalysis = this.handAnalyzer.analyze(handCards, melds);
    const shouldUseLightweightListening = gameState.phase === 'discarding' && (currentAnalysis.stepsToWin || 3) > 1;

    if (shouldUseLightweightListening) {
      const improvementOutcomes = this.evaluateImprovementTiles(handCards, melds, visibleCounts, currentAnalysis);
      const result = {
        waitCards: improvementOutcomes.map((item) => item.code),
        remainingWaitCount: improvementOutcomes.reduce((sum, item) => sum + item.remaining, 0),
        maxHuPoints: 0,
        avgHuPoints: 0,
        maxRoundScore: 0,
        avgRoundScore: 0,
        bestMingTangNames: [],
      };
      this.listeningCache.set(cacheKey, result);
      return result;
    }

    for (const size of [CardSize.SMALL, CardSize.BIG]) {
      for (let value = 1; value <= 10; value++) {
        const virtualCard = this.createVirtualCard(size, value);
        const code = this.formatCardCode(virtualCard);
        const remaining = Math.max(0, 4 - (visibleCounts.get(code) || 0));
        if (remaining <= 0) continue;
        if (!this.rulesValidator.canHu(handCards, melds, virtualCard, 'draw', gameState.ruleProfile)) continue;

        const winningHandMelds = this.rulesValidator.findWinningHandMelds(
          [...handCards, virtualCard],
          melds,
          virtualCard,
          'draw',
          gameState.ruleProfile,
        );
        if (!winningHandMelds) continue;

        const scoreResult = this.scoreCalculator.calculateTotalScore([...melds, ...winningHandMelds], {
          winType: 'self_draw' as any,
        });

        waitOutcomes.push({
          code,
          remaining,
          huPoints: scoreResult.totalHuPoints,
          roundScore: scoreResult.roundScore,
          mingTangNames: (scoreResult.mingtangs || []).map((item) => item.name),
        });
      }
    }

    if (waitOutcomes.length === 0) {
      if (gameState.phase !== 'discarding') {
        const result = {
          waitCards: [],
          remainingWaitCount: 0,
          maxHuPoints: 0,
          avgHuPoints: 0,
          maxRoundScore: 0,
          avgRoundScore: 0,
          bestMingTangNames: [],
        };
        this.listeningCache.set(cacheKey, result);
        return result;
      }

      const improvementOutcomes = this.evaluateImprovementTiles(handCards, melds, visibleCounts, currentAnalysis);
      if (improvementOutcomes.length > 0) {
        const result = {
          waitCards: improvementOutcomes.map((item) => item.code),
          remainingWaitCount: improvementOutcomes.reduce((sum, item) => sum + item.remaining, 0),
          maxHuPoints: 0,
          avgHuPoints: 0,
          maxRoundScore: 0,
          avgRoundScore: 0,
          bestMingTangNames: [],
        };
        this.listeningCache.set(cacheKey, result);
        return result;
      }

      const result = {
        waitCards: [],
        remainingWaitCount: 0,
        maxHuPoints: 0,
        avgHuPoints: 0,
        maxRoundScore: 0,
        avgRoundScore: 0,
        bestMingTangNames: [],
      };
      this.listeningCache.set(cacheKey, result);
      return result;
    }

    const totalHu = waitOutcomes.reduce((sum, item) => sum + item.huPoints, 0);
    const totalRoundScore = waitOutcomes.reduce((sum, item) => sum + item.roundScore, 0);
    const bestOutcome = [...waitOutcomes].sort((left, right) => right.roundScore - left.roundScore || right.huPoints - left.huPoints)[0];

    const result = {
      waitCards: waitOutcomes.map((item) => item.code),
      remainingWaitCount: waitOutcomes.reduce((sum, item) => sum + item.remaining, 0),
      maxHuPoints: Math.max(...waitOutcomes.map((item) => item.huPoints)),
      avgHuPoints: totalHu / waitOutcomes.length,
      maxRoundScore: Math.max(...waitOutcomes.map((item) => item.roundScore)),
      avgRoundScore: totalRoundScore / waitOutcomes.length,
      bestMingTangNames: bestOutcome?.mingTangNames || [],
    };
    this.listeningCache.set(cacheKey, result);
    return result;
  }

  private evaluateImprovementTiles(
    handCards: Card[],
    melds: Meld[],
    visibleCounts: Map<string, number>,
    currentAnalysis: ReturnType<HandAnalyzer['analyze']>,
  ): Array<{ code: string; remaining: number }> {
    const currentStructureScore = this.scoreHandStructure(currentAnalysis);
    const outcomes: Array<{ code: string; remaining: number; improvementScore: number }> = [];

    for (const virtualCard of this.listImprovementCandidateTiles(handCards)) {
      const code = this.formatCardCode(virtualCard);
      const remaining = Math.max(0, 4 - (visibleCounts.get(code) || 0));
      if (remaining <= 0) continue;

      const nextAnalysis = this.handAnalyzer.analyze([...handCards, virtualCard], melds);
      const nextStructureScore = this.scoreHandStructure(nextAnalysis);
      const improvementScore = nextStructureScore - currentStructureScore;

      if (improvementScore > 0) {
        outcomes.push({ code, remaining, improvementScore });
      }
    }

    return outcomes
      .sort((left, right) => right.improvementScore - left.improvementScore || right.remaining - left.remaining)
      .map(({ code, remaining }) => ({ code, remaining }));
  }

  private scoreHandStructure(analysis: ReturnType<HandAnalyzer['analyze']>): number {
    const meldWeights: Record<string, number> = {
      quadruple: 4.8,
      triple: 4.2,
      special_2710: 4,
      mixed_size: 3.6,
      sequence: 3,
      pair: 1,
    };

    const potentialWeight = (analysis.potentialMelds || []).reduce((sum, meld) => sum + (meldWeights[meld.type] || 0), 0);
    const tingBonus = (analysis.tingCards?.length || 0) * 40;
    const stepPenalty = (analysis.stepsToWin || 3) * 1000;
    const loosePenalty = (analysis.looseCards?.length || 0) * 36;
    const completenessBonus = (analysis.completeness || 0) * 120;

    return potentialWeight * 25 + tingBonus + completenessBonus - stepPenalty - loosePenalty;
  }

  private listImprovementCandidateTiles(handCards: Card[]): Card[] {
    const candidates = new Map<string, Card>();
    const addCandidate = (size: CardSize, value: number) => {
      if (value < 1 || value > 10) {
        return;
      }

      const card = this.createVirtualCard(size, value);
      candidates.set(this.formatCardCode(card), card);
    };

    for (const card of handCards) {
      addCandidate(card.size, card.value);
      addCandidate(card.size === CardSize.SMALL ? CardSize.BIG : CardSize.SMALL, card.value);
      addCandidate(card.size, card.value - 2);
      addCandidate(card.size, card.value - 1);
      addCandidate(card.size, card.value + 1);
      addCandidate(card.size, card.value + 2);

      if ([2, 7, 10].includes(card.value)) {
        addCandidate(card.size, 2);
        addCandidate(card.size, 7);
        addCandidate(card.size, 10);
      }
    }

    return Array.from(candidates.values());
  }

  private buildCodeCountMap(cards: Card[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const card of cards) {
      const code = this.formatCardCode(card);
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    return counts;
  }

  private adjustCountMap(counts: Map<string, number>, code: string, delta: number): void {
    const next = Math.max(0, (counts.get(code) || 0) + delta);
    if (next === 0) {
      counts.delete(code);
      return;
    }
    counts.set(code, next);
  }

  private buildLockedHandContext(handCards: Card[]): { lockedCardIds: Set<string>; lockedHandCounts: Map<string, number> } {
    const groupedByCode = new Map<string, Card[]>();
    for (const card of handCards) {
      const code = this.formatCardCode(card);
      if (!groupedByCode.has(code)) {
        groupedByCode.set(code, []);
      }
      groupedByCode.get(code)!.push(card);
    }

    const lockedCardIds = new Set<string>();
    const lockedHandCounts = new Map<string, number>();
    for (const [code, group] of groupedByCode.entries()) {
      if (group.length < 3) {
        continue;
      }
      lockedHandCounts.set(code, group.length);
      for (const card of group) {
        lockedCardIds.add(card.id);
      }
    }

    return { lockedCardIds, lockedHandCounts };
  }

  private buildStableMeldCounts(analysis: ReturnType<HandAnalyzer['analyze']>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const meld of analysis.potentialMelds || []) {
      if (meld.type === 'pair') {
        continue;
      }
      for (const meldCard of meld.cards) {
        const code = this.formatCardCode(meldCard);
        counts.set(code, (counts.get(code) || 0) + 1);
      }
    }
    return counts;
  }

  private buildExposedMeldCodeCounts(gameState: GameState): Map<string, number> {
    const counts = new Map<string, number>();
    for (const player of gameState.players || []) {
      for (const meld of player.melds || []) {
        if (meld.isConcealed) {
          continue;
        }
        for (const meldCard of meld.cards) {
          const code = this.formatCardCode(meldCard);
          counts.set(code, (counts.get(code) || 0) + 1);
        }
      }
    }
    return counts;
  }

  private countUsableSupport(
    code: string,
    freeCounts: Map<string, number>,
    stableMeldCounts: Map<string, number>,
  ): number {
    return Math.max(0, (freeCounts.get(code) || 0) - (stableMeldCounts.get(code) || 0));
  }

  private countResponseSequenceOpportunities(
    card: Card,
    freeCounts: Map<string, number>,
    stableMeldCounts: Map<string, number>,
    visibleCounts: Map<string, number>,
    exposedMeldCounts: Map<string, number>,
  ): {
    liveResponseSequenceCount: number;
    liveResponse2710Count: number;
    deadResponseSequenceCount: number;
    deadResponse2710Count: number;
    stableResponseBlockCount: number;
    guiResponseCount: number;
  } {
    const prefix = card.size === CardSize.SMALL ? 'S' : 'B';
    let liveResponseSequenceCount = 0;
    let liveResponse2710Count = 0;
    let deadResponseSequenceCount = 0;
    let deadResponse2710Count = 0;
    let stableResponseBlockCount = 0;
    let guiResponseCount = 0;

    const applyResponseWindow = (codes: string[], category: 'sequence' | 'special_2710') => {
      const otherCodes = codes.filter((code) => code !== this.formatCardCode(card));
      const freePartners = otherCodes.filter((code) => (freeCounts.get(code) || 0) > 0);
      if (freePartners.length !== 1) {
        return;
      }

      const partnerCode = freePartners[0];
      const missingCode = otherCodes.find((code) => code !== partnerCode);
      if (!missingCode) {
        return;
      }

      const remaining = this.countRemainingCopies(visibleCounts, missingCode);
      if (remaining <= 0) {
        if (category === 'sequence') {
          deadResponseSequenceCount += 1;
        } else {
          deadResponse2710Count += 1;
        }
        return;
      }

      const usableSupport = this.countUsableSupport(partnerCode, freeCounts, stableMeldCounts);
      if (usableSupport <= 0) {
        stableResponseBlockCount += remaining;
        return;
      }

      if (category === 'sequence') {
        liveResponseSequenceCount += remaining;
      } else {
        liveResponse2710Count += remaining;
      }

      if ((exposedMeldCounts.get(missingCode) || 0) >= 3) {
        guiResponseCount += remaining;
      }
    };

    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }
      applyResponseWindow(
        [start, start + 1, start + 2].map((value) => `${prefix}${value}`),
        'sequence',
      );
    }

    if ([2, 7, 10].includes(card.value)) {
      applyResponseWindow([2, 7, 10].map((value) => `${prefix}${value}`), 'special_2710');
    }

    return {
      liveResponseSequenceCount,
      liveResponse2710Count,
      deadResponseSequenceCount,
      deadResponse2710Count,
      stableResponseBlockCount,
      guiResponseCount,
    };
  }

  private listSequenceSupportCodes(card: Card): string[] {
    const codes = new Set<string>();
    const prefix = card.size === CardSize.SMALL ? 'S' : 'B';
    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }
      for (const value of [start, start + 1, start + 2]) {
        if (value !== card.value) {
          codes.add(`${prefix}${value}`);
        }
      }
    }
    return Array.from(codes);
  }

  private listSpecialSupportCodes(card: Card): string[] {
    if (![2, 7, 10].includes(card.value)) {
      return [];
    }
    const prefix = card.size === CardSize.SMALL ? 'S' : 'B';
    return [2, 7, 10]
      .filter((value) => value !== card.value)
      .map((value) => `${prefix}${value}`);
  }

  private countRemainingCopies(visibleCounts: Map<string, number>, code: string): number {
    return Math.max(0, 4 - (visibleCounts.get(code) || 0));
  }

  private classifyTemplate(
    requirements: Array<[string, number]>,
    freeCounts: Map<string, number>,
    totalCounts: Map<string, number>,
  ): 'viable' | 'blocked' | 'unavailable' {
    let allFree = true;
    for (const [code, requiredCount] of requirements) {
      const totalCount = totalCounts.get(code) || 0;
      if (totalCount < requiredCount) {
        return 'unavailable';
      }
      if ((freeCounts.get(code) || 0) < requiredCount) {
        allFree = false;
      }
    }

    return allFree ? 'viable' : 'blocked';
  }

  private getCardConnectionProfile(card: Card, handCards: Card[], melds: Meld[], gameState: GameState): CardProfile {
    const visibleCounts = this.collectVisibleCardCodeCounts(gameState);
    const sameCode = this.formatCardCode(card);
    const mixedCode = `${card.size === CardSize.SMALL ? 'B' : 'S'}${card.value}`;
    const analysis = this.handAnalyzer.analyze(handCards, melds);
    const { lockedCardIds, lockedHandCounts } = this.buildLockedHandContext(handCards);
    const lockedSupportCounts = new Map<string, number>(lockedHandCounts);
    const stableMeldCounts = this.buildStableMeldCounts(analysis);
    const exposedMeldCounts = this.buildExposedMeldCodeCounts(gameState);
    const freeCounts = this.buildCodeCountMap(handCards);
    for (const [code, count] of lockedHandCounts.entries()) {
      this.adjustCountMap(freeCounts, code, -count);
    }

    const currentLocked = lockedCardIds.has(card.id);
    if (currentLocked) {
      this.adjustCountMap(lockedSupportCounts, sameCode, -1);
    } else {
      this.adjustCountMap(freeCounts, sameCode, -1);
    }

    const totalCounts = new Map<string, number>(freeCounts);
    for (const [code, count] of lockedSupportCounts.entries()) {
      this.adjustCountMap(totalCounts, code, count);
    }

    const sequenceSupportCodes = this.listSequenceSupportCodes(card);
    const specialSupportCodes = this.listSpecialSupportCodes(card);
    const supportCodes = new Set<string>([sameCode, mixedCode, ...sequenceSupportCodes, ...specialSupportCodes]);

    let viablePairTemplates = 0;
    let viableMixedTemplates = 0;
    let viableSequenceTemplates = 0;
    let viable2710Templates = 0;
    let blockedPairTemplates = 0;
    let blockedMixedTemplates = 0;
    let blockedSequenceTemplates = 0;
    let blocked2710Templates = 0;

    const applyTemplateResult = (
      templateType: 'pair' | 'mixed' | 'sequence' | 'special_2710',
      requirements: Array<[string, number]>,
    ) => {
      const result = this.classifyTemplate(requirements, freeCounts, totalCounts);
      if (result === 'unavailable') {
        return;
      }
      const isViable = result === 'viable';
      if (templateType === 'pair') {
        viablePairTemplates += isViable ? 1 : 0;
        blockedPairTemplates += isViable ? 0 : 1;
      } else if (templateType === 'mixed') {
        viableMixedTemplates += isViable ? 1 : 0;
        blockedMixedTemplates += isViable ? 0 : 1;
      } else if (templateType === 'sequence') {
        viableSequenceTemplates += isViable ? 1 : 0;
        blockedSequenceTemplates += isViable ? 0 : 1;
      } else {
        viable2710Templates += isViable ? 1 : 0;
        blocked2710Templates += isViable ? 0 : 1;
      }
    };

    applyTemplateResult('pair', [[sameCode, 1]]);
    applyTemplateResult('mixed', [[sameCode, 1], [mixedCode, 1]]);
    applyTemplateResult('mixed', [[mixedCode, 2]]);

    const prefix = card.size === CardSize.SMALL ? 'S' : 'B';
    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }
      const requirements = [start, start + 1, start + 2]
        .filter((value) => value !== card.value)
        .map((value) => [`${prefix}${value}`, 1] as [string, number]);
      applyTemplateResult('sequence', requirements);
    }

    if ([2, 7, 10].includes(card.value)) {
      const requirements = [2, 7, 10]
        .filter((value) => value !== card.value)
        .map((value) => [`${prefix}${value}`, 1] as [string, number]);
      applyTemplateResult('special_2710', requirements);
    }

    const sameCards = freeCounts.get(sameCode) || 0;
    const mixedSizeCards = freeCounts.get(mixedCode) || 0;
    const sequenceLinks = sequenceSupportCodes.reduce((sum, code) => sum + (freeCounts.get(code) || 0), 0);
    const specialLinks = specialSupportCodes.reduce((sum, code) => sum + (freeCounts.get(code) || 0), 0);
    const freeSupportCount = Array.from(supportCodes).reduce((sum, code) => sum + (freeCounts.get(code) || 0), 0);
    const lockedSupportCount = Array.from(supportCodes).reduce((sum, code) => sum + (lockedSupportCounts.get(code) || 0), 0);
    const responseOpportunities = this.countResponseSequenceOpportunities(
      card,
      freeCounts,
      stableMeldCounts,
      visibleCounts,
      exposedMeldCounts,
    );

    const liveSameCardCount = this.countRemainingCopies(visibleCounts, sameCode);
    const liveMixedCardCount = this.countRemainingCopies(visibleCounts, mixedCode);
    const liveSequenceCount = sequenceSupportCodes.reduce((sum, code) => sum + this.countRemainingCopies(visibleCounts, code), 0);
    const liveSpecialCount = specialSupportCodes.reduce((sum, code) => sum + this.countRemainingCopies(visibleCounts, code), 0);
    const totalLiveSupport = Array.from(supportCodes).reduce((sum, code) => sum + this.countRemainingCopies(visibleCounts, code), 0)
      + responseOpportunities.liveResponseSequenceCount
      + responseOpportunities.liveResponse2710Count;
    const totalTemplateCount = viablePairTemplates + viableMixedTemplates + viableSequenceTemplates + viable2710Templates;
    const blockedTemplateCount = blockedPairTemplates + blockedMixedTemplates + blockedSequenceTemplates + blocked2710Templates;

    return {
      isLocked: currentLocked,
      sameCards,
      mixedSizeCards,
      sequenceLinks,
      specialLinks,
      ...responseOpportunities,
      viablePairTemplates,
      viableMixedTemplates,
      viableSequenceTemplates,
      viable2710Templates,
      blockedPairTemplates,
      blockedMixedTemplates,
      blockedSequenceTemplates,
      blocked2710Templates,
      freeSupportCount,
      lockedSupportCount,
      totalTemplateCount,
      blockedTemplateCount,
      liveSameCardCount,
      liveMixedCardCount,
      liveSequenceCount,
      liveSpecialCount,
      totalLiveSupport,
      isIsolated: !currentLocked && totalTemplateCount === 0,
      isNearlyDead: !currentLocked && totalTemplateCount === 0 && (blockedTemplateCount > 0 || totalLiveSupport <= 4),
    };
  }

  private assessDiscardDanger(card: Card, gameState: GameState, playerIndex: number): DangerInfo {
    const visibleCounts = this.collectVisibleCardCodeCounts(gameState);
    const code = this.formatCardCode(card);
    const visibleSame = visibleCounts.get(code) || 0;
    const liveSame = Math.max(0, 4 - visibleSame);
    const discardCount = (gameState.discardPile?.cards || []).filter((item) => item.value === card.value && item.size === card.size).length;
    const aggressiveOpponents = gameState.players.filter((player, index) => index !== playerIndex && ((player.cards?.length || 0) <= 6 || (player.melds?.length || 0) >= 3 || !!player.isBao)).length;

    let score = 24;
    score += card.isRed ? 22 : 0;
    score += discardCount === 0 ? 14 : Math.max(0, 8 - discardCount * 4);
    score += liveSame * 5;
    score += aggressiveOpponents * 6;
    score += gameState.remainingDeckCards <= 10 ? 8 : 0;
    score += gameState.turnCount >= 12 ? 6 : 0;

    const label: DangerInfo['label'] = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
    const summary = label === 'high'
      ? '这张偏生，且对手成牌压力大，打出去有放炮风险'
      : label === 'medium'
        ? '这张还不算绝对安全，若没有明显进攻收益，要留意后手'
        : '这张相对更熟，打出去的失误成本较低';

    return { score: Math.min(100, score), label, summary };
  }

  private getStagePressure(gameState: GameState): number {
    const turnPressure = Math.min(1, gameState.turnCount / 18);
    const deckPressure = gameState.remainingDeckCards <= 0
      ? 1
      : Math.max(0, 1 - Math.min(gameState.remainingDeckCards, 20) / 20);

    return Math.min(1, turnPressure * 0.55 + deckPressure * 0.45);
  }

  private buildProjectedSummary(
    posture: 'attack' | 'balance' | 'defense',
    speedScore: number,
    scorePotential: number,
    defensePressure: number,
  ): string {
    if (posture === 'attack') {
      return scorePotential >= 10
        ? '这手更适合主动提速，同时保留做大空间'
        : '这手更适合主动抢节奏，先把听口和进张做出来';
    }

    if (posture === 'defense') {
      return defensePressure >= 0.65
        ? '当前防守压力偏大，先处理危险张和低效率牌更稳'
        : '这手需要稳着整理，别为了小利把自己送进被动局';
    }

    return speedScore >= 0.55
      ? '这手属于边整理边提速的均衡局面'
      : '这手先稳住主干，再看后续转攻还是转守';
  }

  private buildRecommendationSummary(
    action: AIPlayRecommendation['action'],
    posture: 'attack' | 'balance' | 'defense',
    reasoning: string,
  ): string {
    if (action === 'discard') {
      return posture === 'attack'
        ? '这张是当前最适合的提速舍张'
        : posture === 'defense'
          ? '这张是当前最适合先处理的风险牌'
          : '这张最不伤主干，适合当前整理节奏';
    }

    if (action === 'chi' || action === 'peng' || action === 'zhao') {
      return reasoning.length > 24 ? reasoning.slice(0, 24) : reasoning;
    }

    if (action === 'hu') {
      return '收益已经成熟，先把分数稳稳收下';
    }

    if (action === 'pass') {
      return '这一手先过，更能保住后续弹性';
    }

    return reasoning;
  }

  private buildDiscardKeyPoints(
    listening: ListeningInfo,
    profile: CardProfile,
    danger: DangerInfo,
    evaluation: ProjectedStateInfo,
  ): string[] {
    const points: string[] = [];

    points.push(evaluation.summary);

    if (listening.waitCards.length > 0) {
      points.push(`打完后有机会听 ${listening.waitCards.join('、')}，进张总量约 ${listening.remainingWaitCount} 张`);
    }

    if (profile.isIsolated) {
      points.push(profile.blockedTemplateCount > 0
        ? '它看似还能连张，但关键支撑已被锁死，继续留着多半只是伪活张'
        : '它基本是孤张，继续留着很难转化成有效牌组');
    } else if (profile.isNearlyDead) {
      points.push('这张活张很少，后续大概率只是继续拖手');
    }

    points.push(danger.summary);
    return points.slice(0, 3);
  }

  private determinePosture(
    gameState: GameState,
    handCards: Card[],
    melds: Meld[],
    listening: ListeningInfo,
    strategyScore: number,
    riskLevel: number,
  ): 'attack' | 'balance' | 'defense' {
    const analysis = this.handAnalyzer.analyze(handCards, melds);
    const stagePressure = this.getStagePressure(gameState);

    if (analysis.canWin || listening.waitCards.length > 0 || (analysis.stepsToWin || 3) <= 1 || (strategyScore >= 68 && riskLevel <= 58)) {
      return 'attack';
    }
    if (riskLevel >= 66 || ((analysis.looseCards.length || 0) >= Math.max(4, Math.ceil(handCards.length * 0.45)) && stagePressure >= 0.45)) {
      return 'defense';
    }
    return 'balance';
  }

  private buildDecisionEvidence(params: {
    evaluation?: ProjectedStateInfo;
    listening?: ListeningInfo;
    danger?: DangerInfo;
    tempoGain?: number;
    flexibility?: number;
    breakdown?: ActionScoreBreakdown;
    extraSignals?: string[];
  }): AIDecisionEvidence {
    const { evaluation, listening, danger, tempoGain, flexibility, breakdown, extraSignals = [] } = params;
    const evidence: AIDecisionEvidence = {
      speedScore: evaluation?.speedScore,
      ukeireCount: listening?.remainingWaitCount,
      scorePotential: evaluation?.scorePotential,
      dangerScore: danger?.score,
      waitCount: listening?.waitCards.length,
      maxHuPoints: listening?.maxHuPoints,
      maxRoundScore: listening?.maxRoundScore,
      tempoGain,
      flexibility,
      breakdown,
      tags: [],
      signals: [],
    };

    if ((evaluation?.speedScore || 0) >= 0.55 || (tempoGain || 0) >= 1) {
      evidence.tags?.push('speed');
      evidence.signals?.push(`这步的提速收益明显，当前速度评分约 ${Math.round((evaluation?.speedScore || 0) * 100)}%`);
    }

    if ((listening?.remainingWaitCount || 0) > 0) {
      evidence.tags?.push('ukeire');
      evidence.signals?.push(`后续有效进张总量约 ${listening?.remainingWaitCount || 0} 张，听口数 ${listening?.waitCards.length || 0}`);
    }

    if ((evaluation?.scorePotential || 0) >= 10 || (listening?.maxRoundScore || 0) >= 10) {
      evidence.tags?.push('score');
      evidence.signals?.push(`这条路线的最高单局分潜力约 ${Math.max(evaluation?.scorePotential || 0, listening?.maxRoundScore || 0)}`);
    }

    if ((danger?.score || 0) >= 45) {
      evidence.tags?.push('risk');
      evidence.signals?.push(`当前危险分约 ${danger?.score || 0}，需要兼顾安全处理`);
    }

    if ((flexibility || 0) >= 0.45) {
      evidence.tags?.push('flexibility');
    }

    if ((evaluation?.speedScore || 0) >= 0.4 || (flexibility || 0) >= 0.3) {
      evidence.tags?.push('shape');
    }

    evidence.tags = Array.from(new Set(evidence.tags));
    evidence.signals = Array.from(new Set([...(evidence.signals || []), ...extraSignals])).slice(0, 4);
    return evidence;
  }

  private buildEvBreakdown(params: {
    gameState: GameState;
    playerIndex: number;
    beforeSteps?: number;
    afterSteps?: number;
    beforeUkeire?: number;
    afterUkeire?: number;
    beforeScorePotential?: number;
    afterScorePotential?: number;
    dangerScore?: number;
  }): ActionScoreBreakdown {
    return this.actionEvEvaluator.evaluate({
      gameState: params.gameState,
      playerIndex: params.playerIndex,
      beforeSteps: params.beforeSteps,
      afterSteps: params.afterSteps,
      beforeUkeire: params.beforeUkeire,
      afterUkeire: params.afterUkeire,
      beforeScorePotential: params.beforeScorePotential,
      afterScorePotential: params.afterScorePotential,
      dangerScore: params.dangerScore,
    });
  }

  private buildTeachingPayload(
    action: AIPlayRecommendation['action'],
    posture: AIPlayRecommendation['posture'],
    evidence: AIDecisionEvidence,
    fallbackSummary: string,
    fallbackPoints: string[],
  ): Pick<AIPlayRecommendation, 'summary' | 'keyPoints' | 'evidence'> {
    const explanation = this.explanationEngine.buildExplanation({
      action,
      posture,
      evidence,
      fallbackSummary,
      fallbackPoints,
    });

    return {
      summary: explanation.summary,
      keyPoints: explanation.keyPoints,
      evidence,
    };
  }

  private matchRecommendationToAction(
    action: AvailableAction,
    recommendations: AIPlayRecommendation[],
  ): AIPlayRecommendation | undefined {
    const actionIds = (action.cards || []).map((card) => card.id).sort();

    const matchesActionOption = (recommendation: AIPlayRecommendation): boolean => {
      const recommendationCards = recommendation.card
        ? [recommendation.card]
        : (recommendation.meldCards || []);
      const recommendationIds = recommendationCards.map((card) => card.id).sort();

      if (actionIds.length === recommendationIds.length && actionIds.every((id, index) => id === recommendationIds[index])) {
        return true;
      }

      if (action.type === 'chi' && action.chiOptions?.length) {
        return action.chiOptions.some((option) => {
          const optionIds = option.selectedCards.map((card) => card.id).sort();
          return optionIds.length === recommendationIds.length && optionIds.every((id, index) => id === recommendationIds[index]);
        });
      }

      if (action.type === 'hu' && action.huOptions?.length) {
        return action.huOptions.some((option) => {
          const optionIds = option.selectedCards.map((card) => card.id).sort();
          return optionIds.length === recommendationIds.length && optionIds.every((id, index) => id === recommendationIds[index]);
        });
      }

      return false;
    };

    const exact = recommendations.find((recommendation) => {
      if (recommendation.action !== action.type) return false;

      if (actionIds.length === 0 && !(action.type === 'chi' || action.type === 'hu')) {
        const recommendationCards = recommendation.card
          ? [recommendation.card]
          : (recommendation.meldCards || []);
        const recommendationIds = recommendationCards.map((card) => card.id).sort();
        if (recommendationIds.length === 0) {
          return true;
        }
      }

      if ((action.type === 'chi' || action.type === 'hu') && matchesActionOption(recommendation)) {
        return true;
      }

      return matchesActionOption(recommendation);
    });

    if (exact) return exact;

    if (actionIds.length > 0) {
      return undefined;
    }

    return recommendations.find((recommendation) => recommendation.action === action.type);
  }

  private fallbackActionScore(action: AvailableAction): number {
    const baseByType: Record<AvailableAction['type'], number> = {
      hu: 100,
      zhao: 78,
      peng: 64,
      chi: 50,
      discard: 46,
      draw: 12,
      pass: 24,
      bao: 70,
      pass_bao: 18,
    };

    return (baseByType[action.type] || 0) + (action.isMandatory ? 1000 : 0);
  }

  private buildRankedActions(
    availableActions: AvailableAction[],
    recommendations: AIPlayRecommendation[],
  ): AIRankedAction[] {
    const hasAnalyzedRecommendations = recommendations.length > 0;

    return availableActions
      .map((action) => {
        const recommendation = this.matchRecommendationToAction(action, recommendations);
        const score = action.isMandatory
          ? 1000 + (recommendation?.priority || 0)
          : recommendation
            ? recommendation.priority
            : this.fallbackActionScore(action) - (hasAnalyzedRecommendations ? 100 : 0);

        return {
          availableAction: action,
          score,
          recommendation,
          summary: recommendation?.summary || recommendation?.reasoning || action.description,
          evidence: recommendation?.evidence,
        } satisfies AIRankedAction;
      })
      .sort((left, right) => right.score - left.score);
  }

  async analyze(gameState: GameState, playerIndex: number, _config: AnalysisConfig = {}): Promise<AIAnalysis> {
    this.listeningCache.clear();
    this.visibleCountsCache.clear();
    this.projectedStateCache.clear();
    this.currentAnalysisConfig = {
      ...DEFAULT_ANALYSIS_CONFIG,
      ..._config,
    };
    const player = gameState.players[playerIndex];
    if (!player) {
      throw new Error(`Player at index ${playerIndex} not found`);
    }

    const handCards = player.cards;
    const melds = player.melds;
    const knownCards = this.collectKnownCards(gameState, playerIndex);
    const winRate = this.winRateCalculator.calculateHeuristicWinRate(handCards, melds);
    const discardedCards = gameState.discardPile?.cards || [];
    const strategy = this.strategyEvaluator.evaluate(handCards, melds, discardedCards);
    const opponentInferences = gameState.players
      .filter((_, index) => index !== playerIndex)
      .map((opponent) => this.opponentInference.inferOpponentHands(opponent.playerId, knownCards, discardedCards, opponent.melds));

    const recommendations = this.generateRecommendations(gameState, playerIndex, handCards, melds, knownCards);
    const rankedActions = this.buildRankedActions(gameState.availableActions || [], recommendations);
    const topReasoning = recommendations[0]?.summary
      ? [recommendations[0].summary, ...(recommendations[0].keyPoints || [])]
      : recommendations[0]?.reasoning
        ? [recommendations[0].reasoning]
        : [];

    return {
      winRate,
      strategy,
      opponentInferences,
      recommendations,
      rankedActions,
      handStrength: strategy.handStrength,
      reasoning: [...(strategy.suggestions || []), ...topReasoning].join('；'),
    };
  }

  private collectKnownCards(gameState: GameState, playerIndex: number): Set<string> {
    const knownCards = new Set<string>();
    const player = gameState.players[playerIndex];
    for (const card of player.cards) knownCards.add(card.id);

    for (const currentPlayer of gameState.players) {
      for (const meld of currentPlayer.melds) {
        if (!meld.isConcealed) {
          for (const card of meld.cards) knownCards.add(card.id);
        }
      }
    }

    for (const card of gameState.discardPile?.cards || []) knownCards.add(card.id);
    return knownCards;
  }

  private generateRecommendations(gameState: GameState, playerIndex: number, handCards: Card[], melds: Meld[], knownCards: Set<string>): AIPlayRecommendation[] {
    void knownCards;
    return this.recommendationGenerator.generateRecommendations(gameState, playerIndex, handCards, melds, {
      discardTopK: this.currentAnalysisConfig.discardTopK ?? DEFAULT_ANALYSIS_CONFIG.discardTopK,
      chiOptionTopK: this.currentAnalysisConfig.chiOptionTopK ?? DEFAULT_ANALYSIS_CONFIG.chiOptionTopK,
      policyMode: this.currentAnalysisConfig.policyMode ?? DEFAULT_ANALYSIS_CONFIG.policyMode,
    });
  }

  private evaluateProjectedState(handCards: Card[], melds: Meld[], discardedCards: Card[], gameState?: GameState): ProjectedStateInfo {
    const cacheKey = this.buildProjectedStateCacheKey(handCards, melds, discardedCards, gameState);
    const cached = this.projectedStateCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const strategy = this.strategyEvaluator.evaluate(handCards, melds, discardedCards);
    const handAnalysis = this.handAnalyzer.analyze(handCards, melds);
    const winRate = this.winRateCalculator.calculateHeuristicWinRate(handCards, melds).currentWinRate;
    const listening = gameState ? this.evaluateDiscardListening(gameState, handCards, melds) : { waitCards: [], remainingWaitCount: 0, maxHuPoints: 0, avgHuPoints: 0, maxRoundScore: 0, avgRoundScore: 0, bestMingTangNames: [] };
    const scoreSnapshot = this.scoreCalculator.calculateTotalScore(melds);
    const speedScore = Math.max(0, 1 - ((handAnalysis.stepsToWin || 3) - 1) * 0.25) + Math.min(0.35, handAnalysis.tingCards.length * 0.08);
    const scorePotential = Math.max(scoreSnapshot.roundScore, listening.maxRoundScore, (handAnalysis.totalHuPoints || 0) + listening.bestMingTangNames.length * 2);
    const defensePressure = Math.min(1, ((strategy.riskLevel || 0) / 100) + ((gameState?.remainingDeckCards || 20) <= 10 ? 0.12 : 0));
    const expectedScore = Math.round(Math.max(scoreSnapshot.roundScore, listening.maxRoundScore, (handAnalysis.totalHuPoints || 0) + (handAnalysis.tingCards.length * 2)));
    const posture = gameState
      ? this.determinePosture(gameState, handCards, melds, listening, strategy.overallScore, strategy.riskLevel || 0)
      : 'balance';
    const compositeScore = strategy.overallScore * 0.34
      + winRate * 100 * 0.16
      + speedScore * 22
      + scorePotential * 2.2
      + (handAnalysis.tingCards.length * 5)
      + ((handAnalysis.completeness || 0) * 16)
      + listening.remainingWaitCount * 0.85
      - defensePressure * 18;
    const confidence = Math.max(0.4, Math.min(0.96,
      0.45
      + Math.min(0.18, speedScore * 0.18)
      + Math.min(0.16, winRate * 0.2)
      + Math.min(0.1, (listening.waitCards.length > 0 ? 0.1 : 0))
      - Math.min(0.12, defensePressure * 0.12),
    ));
    const summary = this.buildProjectedSummary(posture, speedScore, scorePotential, defensePressure);

    const result = {
      winRate,
      expectedScore,
      compositeScore,
      posture,
      speedScore,
      scorePotential,
      defensePressure,
      confidence,
      summary,
    };
    this.projectedStateCache.set(cacheKey, result);
    return result;
  }

  private calculateKeepValue(card: Card, handCards: Card[], melds: Meld[], gameState: GameState): number {
    const profile = this.getCardConnectionProfile(card, handCards, melds, gameState);
    if (profile.isLocked) {
      return 48 + profile.lockedSupportCount * 2;
    }

    const responseLinkValue = profile.liveResponseSequenceCount * 2.8
      + profile.liveResponse2710Count * 3.2
      + profile.guiResponseCount * 2.4;
    const deadRoutePenalty = profile.deadResponseSequenceCount * 5.4
      + profile.deadResponse2710Count * 4.8
      + profile.stableResponseBlockCount * 1.2;

    if (profile.isIsolated) {
      return (card.isRed ? 2 : 0)
        + Math.min(1.8, profile.liveSameCardCount * 0.18 + profile.liveMixedCardCount * 0.1 + profile.liveSequenceCount * 0.03)
        + responseLinkValue
        - Math.min(1.2, profile.blockedTemplateCount * 0.4)
        - deadRoutePenalty;
    }

    const currentLinkValue = profile.viablePairTemplates * 12
      + profile.viableMixedTemplates * 7.5
      + profile.viableSequenceTemplates * 5.2
      + profile.viable2710Templates * 6.2;
    const futureLinkValue = (profile.viablePairTemplates > 0 ? profile.liveSameCardCount * 1.4 : profile.liveSameCardCount * 0.25)
      + (profile.viableMixedTemplates > 0 ? profile.liveMixedCardCount * 0.9 : profile.liveMixedCardCount * 0.15)
      + (profile.viableSequenceTemplates > 0 ? profile.liveSequenceCount * 0.4 : profile.liveSequenceCount * 0.08)
      + (profile.viable2710Templates > 0 ? profile.liveSpecialCount * 0.7 : profile.liveSpecialCount * 0.15);
    const bridgeKeepBonus = (profile.viableSequenceTemplates >= 2 ? 10 : 0)
      + (profile.viable2710Templates > 0 ? 8 : 0)
      + (profile.viablePairTemplates > 0 ? 6 : 0)
      + (profile.liveResponseSequenceCount >= 4 ? 9 : profile.liveResponseSequenceCount > 0 ? 4 : 0)
      + (profile.liveResponse2710Count > 0 ? 5 : 0)
      + (profile.guiResponseCount > 0 ? 7 : 0);
    const pseudoLivePenalty = this.calculatePseudoLivePenalty(card, handCards, profile);
    const stalePenalty = profile.isNearlyDead ? 3 : 0;

    return currentLinkValue + futureLinkValue + bridgeKeepBonus + responseLinkValue + (card.isRed ? 3 : 0) - pseudoLivePenalty - stalePenalty - deadRoutePenalty;
  }

  private calculatePseudoLivePenalty(card: Card, handCards: Card[], profile: CardProfile): number {
    void card;
    void handCards;

    if (profile.totalTemplateCount > 0 && (profile.viablePairTemplates > 0 || profile.viableMixedTemplates > 0)) {
      return 0;
    }

    let penalty = 0;
    if (profile.blockedSequenceTemplates > 0) {
      penalty += 18 + profile.blockedSequenceTemplates * 8;
    }
    if (profile.blocked2710Templates > 0) {
      penalty += 10 + profile.blocked2710Templates * 6;
    }
    if (profile.blockedMixedTemplates > 0 && profile.viablePairTemplates === 0) {
      penalty += 8;
    }
    if (profile.lockedSupportCount >= 2) {
      penalty += Math.min(12, profile.lockedSupportCount * 2);
    }
    if (profile.deadResponseSequenceCount > 0) {
      penalty += profile.deadResponseSequenceCount * 6;
    }
    if (profile.stableResponseBlockCount > 0 && profile.liveResponseSequenceCount + profile.liveResponse2710Count === 0) {
      penalty += Math.min(10, profile.stableResponseBlockCount * 0.8);
    }

    return penalty;
  }

  private generateDiscardReasoning(card: Card, evaluation: ProjectedStateInfo, keepValue: number, listening: ListeningInfo, profile: CardProfile, danger: DangerInfo): string {
    const reasons: string[] = [];

    reasons.push(card.isRed ? `建议先处理 ${card.rank}，这是一张红牌，留着虽有番数空间，但当前弃它的综合损失更小` : `建议先出${card.size === 'small' ? '小' : '大'}${card.rank}`);

    if (evaluation.posture === 'attack' && listening.waitCards.length > 0) {
      reasons.push(`这步偏进攻，打完后可听 ${listening.waitCards.join('、')}，大约还有 ${listening.remainingWaitCount} 张进张，最高单局分可做到 ${listening.maxRoundScore} 分`);
    } else if (evaluation.posture === 'defense') {
      reasons.push('这步更偏防守，先把低效率牌和危险生张处理掉，避免后面被迫放炮');
    } else {
      reasons.push('这步属于稳手整理，目标是让后面的搭子和听口都更顺');
    }

    if (profile.isIsolated) {
      reasons.push(profile.blockedTemplateCount > 0
        ? '这张看似还有搭子，但关键支撑其实已经被锁死，属于典型伪活张，优先处理更稳'
        : '这张基本是孤张，已经进入优先清理队列，先处理它能尽量保住其他更有进张价值的主干');
    } else if (profile.guiResponseCount > 0) {
      reasons.push('它还保留了吃张与归的双重价值，过早拆掉会同时损失进张和名堂空间');
    } else if (profile.isNearlyDead) {
      reasons.push('这张衔接已经很弱，活张不多，继续留着大多是拖手');
    } else if (profile.deadResponseSequenceCount + profile.deadResponse2710Count > 0 && profile.liveResponseSequenceCount + profile.liveResponse2710Count === 0) {
      reasons.push('它表面上像能继续连张，但关键补张已经见光见尽，继续留着多半只是死路');
    } else if (profile.mixedSizeCards > 0 && profile.sequenceLinks === 0 && profile.sameCards === 0) {
      reasons.push('它现在主要只剩大小搭的可能，成组效率偏低');
    } else if (keepValue <= 8) {
      reasons.push('它和主干联动少，先舍弃对整体伤害最小');
    } else {
      reasons.push('虽然它也能配牌，但和其他候选比起来，先出它更不伤主结构');
    }

    if (listening.bestMingTangNames.length > 0) {
      reasons.push(`后续若进张顺利，还有机会带出 ${listening.bestMingTangNames.join('、')} 这样的名堂空间`);
    }

    reasons.push(danger.summary);
    return reasons.join('，');
  }
}
