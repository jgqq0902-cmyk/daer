import {
  GameState,
  Card,
  AvailableAction,
  AIAnalysis,
  AIDecisionTrace,
  AIDecisionOptionTrace,
  AIPlayRecommendation,
} from '../shared/types';
import { PlayerAction, PlayerActionType } from '../shared/types/simulation';
import { SPECIAL_2710_VALUES } from '../shared/constants/cards';
import { AIAnalyzer } from './ai-analyzer';
import { HandAnalyzer } from '../game-engine/hand-analyzer';
import type { AITutorDimensionTrace, AITutorTrace } from './types';

type DecisionSource = AIDecisionTrace['source'];

const COMPLETE_2710_KEEP_BONUS = 18;
const SPECIAL_2710_LINK_BONUS = 2.5;

interface DecisionOutcome {
  action: PlayerAction;
  source: DecisionSource;
  analysis?: AIAnalysis;
  summary?: string;
  legalMeta?: {
    normalized: boolean;
    fallbackApplied: boolean;
    fallbackReason?: string;
  };
}

interface AIPlayerAgentOptions {
  mode?: 'fast' | 'medium' | 'learned';
  analyzer?: AIAnalyzer;
  handAnalyzer?: HandAnalyzer;
  analysisConfig?: {
    discardTopK?: number;
    chiOptionTopK?: number;
  };
}

interface AnalysisCandidate {
  action: PlayerAction;
  summary?: string;
  score?: number;
  dangerScore?: number;
}

export class AIPlayerAgent {
  private readonly aiAnalyzer: AIAnalyzer;
  private readonly handAnalyzer: HandAnalyzer;
  private readonly playerId: string;
  private readonly mode: 'fast' | 'medium' | 'learned';
  private readonly analysisConfig: NonNullable<AIPlayerAgentOptions['analysisConfig']>;

  constructor(playerId: string, options: AIPlayerAgentOptions = {}) {
    this.playerId = playerId;
    this.mode = options.mode ?? 'learned';
    this.aiAnalyzer = options.analyzer ?? new AIAnalyzer();
    this.handAnalyzer = options.handAnalyzer ?? new HandAnalyzer();
    this.analysisConfig = {
      discardTopK: options.analysisConfig?.discardTopK,
      chiOptionTopK: options.analysisConfig?.chiOptionTopK,
    };
  }

  private formatCardCode(card: Card | undefined): string {
    if (!card) return '';
    return `${card.size === 'small' ? 'S' : 'B'}${card.value}`;
  }

  private formatCards(cards?: Card[]): string[] | undefined {
    if (!cards || cards.length === 0) return undefined;
    return cards.map((card) => this.formatCardCode(card));
  }

  private summarizeDecisionSource(source: DecisionSource, analysis?: AIAnalysis): string {
    switch (source) {
      case 'explicit_hu':
        return '显式胡牌可执行，直接收分。';
      case 'mandatory':
        return '命中强制动作，优先执行。';
      case 'analysis_top':
        return analysis?.recommendations?.[0]?.reasoning || '按综合评估选择最优合法动作。';
      case 'best_legal_discard':
        return '在合法弃牌中选择损失最小方案。';
      case 'meld_priority':
        return '按响应优先级选择可执行副露动作。';
      case 'default_available':
        return '执行当前可用的稳定默认动作。';
      case 'priority_fallback':
        return '分析不可用，按规则优先级回退。';
      case 'no_action_pass':
      default:
        return '当前无可执行动作，回退为过牌。';
    }
  }

  private buildTutorBullets(input: Array<string | undefined>, fallback: string): string[] {
    const unique = Array.from(new Set(input.filter((item): item is string => !!item && item.trim().length > 0)));
    if (unique.length === 0) {
      return [fallback];
    }
    return unique.slice(0, 2);
  }

  private findChosenRecommendation(
    analysis: AIAnalysis | undefined,
    chosenAction: PlayerActionType,
    chosenCards?: string[],
  ): AIPlayRecommendation | undefined {
    if (!analysis?.recommendations?.length) {
      return undefined;
    }

    const normalizedCards = [...(chosenCards || [])].sort();
    const exact = analysis.recommendations.find((recommendation) => {
      if (recommendation.action !== chosenAction) {
        return false;
      }

      const recommendationCards = recommendation.card
        ? this.formatCards([recommendation.card])
        : recommendation.meldCards
          ? this.formatCards(recommendation.meldCards)
          : undefined;
      const normalizedRecommendationCards = [...(recommendationCards || [])].sort();

      if (normalizedRecommendationCards.length === 0 && normalizedCards.length === 0) {
        return true;
      }
      if (normalizedRecommendationCards.length !== normalizedCards.length) {
        return false;
      }
      return normalizedRecommendationCards.every((card, index) => card === normalizedCards[index]);
    });

    return exact || analysis.recommendations.find((recommendation) => recommendation.action === chosenAction);
  }

  private buildTutorTrace(recommendation: AIPlayRecommendation | undefined, summary: string): AITutorTrace | undefined {
    if (!recommendation) {
      return undefined;
    }

    const evidence = recommendation.evidence;
    const breakdown = evidence?.breakdown;

    const dimensions: AITutorDimensionTrace[] = [
      {
        key: 'efficiency',
        title: '牌效与进张',
        diagnosis: recommendation.posture === 'attack' ? '本手以提速和进张效率为主。' : '本手先保持结构稳定与效率。',
        bullets: this.buildTutorBullets([
          evidence?.signals?.find((signal) => /提速|进张|听口|结构/.test(signal)),
          (evidence?.ukeireCount || 0) > 0 ? `后续有效进张约 ${evidence?.ukeireCount} 张` : undefined,
          recommendation.keyPoints?.[0],
        ], '优先保留后续可转化的结构。'),
      },
      {
        key: 'scoring',
        title: '做牌与算账',
        diagnosis: (breakdown?.scoreBonus || 0) > 0 ? '该选择在得分潜力上更优。' : '该选择至少不牺牲主路线收益。',
        bullets: this.buildTutorBullets([
          (evidence?.scorePotential || 0) > 0 ? `分数潜力约 ${Math.round(evidence?.scorePotential || 0)}` : undefined,
          (evidence?.maxHuPoints || 0) > 0 ? `可见最高胡息约 ${evidence?.maxHuPoints}` : undefined,
          evidence?.signals?.find((signal) => /名堂|得分|收益|胡息/.test(signal)),
        ], '优先保证可兑现收益，再追求上限。'),
      },
      {
        key: 'defense',
        title: '防守与风险',
        diagnosis: (evidence?.dangerScore || 0) >= 65 ? '当前风险偏高，先控制失误成本。' : '风险可控，继续推进当前节奏。',
        bullets: this.buildTutorBullets([
          (evidence?.dangerScore || 0) > 0 ? `危险分约 ${Math.round(evidence?.dangerScore || 0)}` : undefined,
          (breakdown?.dangerPenalty || 0) > 0 ? `风险惩罚约 ${Math.round(breakdown?.dangerPenalty || 0)}` : undefined,
          recommendation.keyPoints?.find((point) => /风险|防守|安全|放炮/.test(point)),
        ], '保持风险可控，避免被动高危弃牌。'),
      },
    ];

    return {
      headline: recommendation.summary || summary,
      posture: recommendation.posture,
      dimensions,
    };
  }

  private buildActionSignature(action: PlayerAction): string {
    const cardIds = (action.cards || []).map((card) => card.id).sort().join(',');
    return `${action.type}|${cardIds}|${action.chiOptionId || ''}|${action.huOptionId || ''}`;
  }

  private areSameCards(left: Card[] = [], right: Card[] = []): boolean {
    const leftIds = left.map((card) => card.id).sort();
    const rightIds = right.map((card) => card.id).sort();
    if (leftIds.length !== rightIds.length) {
      return false;
    }
    return leftIds.every((id, index) => id === rightIds[index]);
  }

  private resolveOptionAction(
    action: AvailableAction,
    candidate: Pick<PlayerAction, 'cards' | 'chiOptionId' | 'huOptionId'>,
  ): Pick<PlayerAction, 'cards' | 'chiOptionId' | 'huOptionId'> | null {
    if (action.type === 'chi' && action.chiOptions?.length) {
      if (candidate.chiOptionId) {
        const option = action.chiOptions.find((item) => item.id === candidate.chiOptionId);
        if (!option) return null;
        if (candidate.cards?.length && !this.areSameCards(candidate.cards, option.selectedCards)) return null;
        return { cards: option.selectedCards, chiOptionId: option.id };
      }

      const candidateCards = candidate.cards || [];
      if (candidateCards.length > 0) {
        const matched = action.chiOptions.filter((option) => this.areSameCards(option.selectedCards, candidateCards));
        if (matched.length === 1) {
          return { cards: matched[0].selectedCards, chiOptionId: matched[0].id };
        }
        if (matched.length > 1 && this.areSameCards(candidateCards, action.cards)) {
          return { cards: matched[0].selectedCards, chiOptionId: matched[0].id };
        }
        return null;
      }

      if (action.chiOptions.length > 0) {
        return { cards: action.chiOptions[0].selectedCards, chiOptionId: action.chiOptions[0].id };
      }
      return null;
    }

    if (action.type === 'hu' && action.huOptions?.length) {
      if (candidate.huOptionId) {
        const option = action.huOptions.find((item) => item.id === candidate.huOptionId);
        if (!option) return null;
        if (candidate.cards?.length && !this.areSameCards(candidate.cards, option.selectedCards)) return null;
        return { cards: option.selectedCards, huOptionId: option.id };
      }

      const candidateCards = candidate.cards || [];
      if (candidateCards.length > 0) {
        const matched = action.huOptions.filter((option) => this.areSameCards(option.selectedCards, candidateCards));
        if (matched.length === 1) {
          return { cards: matched[0].selectedCards, huOptionId: matched[0].id };
        }
        if (matched.length > 1 && this.areSameCards(candidateCards, action.cards)) {
          return { cards: matched[0].selectedCards, huOptionId: matched[0].id };
        }
        return null;
      }

      if (action.huOptions.length > 0) {
        return { cards: action.huOptions[0].selectedCards, huOptionId: action.huOptions[0].id };
      }
      return null;
    }

    return null;
  }

  private normalizeToAvailableAction(
    candidate: PlayerAction,
    availableActions: AvailableAction[],
  ): PlayerAction | null {
    for (const action of availableActions) {
      if (action.type !== candidate.type) {
        continue;
      }

      const optionResolved = this.resolveOptionAction(action, candidate);
      if (optionResolved) {
        return {
          ...candidate,
          type: action.type as PlayerActionType,
          cards: optionResolved.cards,
          chiOptionId: optionResolved.chiOptionId,
          huOptionId: optionResolved.huOptionId,
        };
      }

      if ((action.type === 'chi' && action.chiOptions?.length) || (action.type === 'hu' && action.huOptions?.length)) {
        continue;
      }

      if (!this.areSameCards(candidate.cards || [], action.cards || [])) {
        continue;
      }

      if ((candidate.type === 'chi' && candidate.chiOptionId) || (candidate.type === 'hu' && candidate.huOptionId)) {
        continue;
      }

      return {
        ...candidate,
        type: action.type as PlayerActionType,
        cards: action.cards,
        chiOptionId: undefined,
        huOptionId: undefined,
      };
    }

    return null;
  }

  private matchesAvailableAction(candidate: PlayerAction, action: AvailableAction): boolean {
    return this.normalizeToAvailableAction(candidate, [action]) !== null;
  }

  private buildActionFromAvailable(action: AvailableAction): PlayerAction {
    const optionResolved = this.resolveOptionAction(action, { cards: action.cards });
    return {
      type: action.type as PlayerActionType,
      playerId: this.playerId,
      cards: optionResolved?.cards || action.cards,
      chiOptionId: optionResolved?.chiOptionId,
      huOptionId: optionResolved?.huOptionId,
      timestamp: Date.now(),
    };
  }

  private buildActionFromRecommendation(
    action: AvailableAction,
    recommendation: AIPlayRecommendation,
  ): PlayerAction {
    const recommendationCards = recommendation.card ? [recommendation.card] : (recommendation.meldCards || []);
    const optionResolved = this.resolveOptionAction(action, { cards: recommendationCards });
    return {
      type: action.type as PlayerActionType,
      playerId: this.playerId,
      cards: optionResolved?.cards || recommendationCards || action.cards,
      chiOptionId: optionResolved?.chiOptionId,
      huOptionId: optionResolved?.huOptionId,
      timestamp: Date.now(),
    };
  }

  private buildDecisionTrace(
    state: GameState,
    availableActions: AvailableAction[],
    outcome: DecisionOutcome,
  ): AIDecisionTrace {
    const mandatoryAction = availableActions.find((action) => action.isMandatory);
    const explicitHu = availableActions.find((action) => action.type === 'hu');
    const normalized = this.normalizeToAvailableAction(outcome.action, availableActions);
    const chosenAction = (normalized?.type || outcome.action.type) as PlayerActionType;
    const chosenCards = this.formatCards(normalized?.cards || outcome.action.cards);
    const chosenSignature = this.buildActionSignature(normalized || outcome.action);

    const availableOptions: AIDecisionOptionTrace[] = availableActions.map((action) => {
      const availableAction = this.buildActionFromAvailable(action);
      return {
        action: action.type as PlayerActionType,
        cards: this.formatCards(action.cards),
        isMandatory: !!action.isMandatory,
        isAvailable: true,
        isChosen: this.buildActionSignature(availableAction) === chosenSignature,
        reasoning: action.description,
      };
    });

    const recommendationOptions: AIDecisionOptionTrace[] = (outcome.analysis?.recommendations || [])
      .slice(0, 4)
      .map((recommendation) => ({
        action: recommendation.action,
        cards: recommendation.card
          ? this.formatCards([recommendation.card])
          : recommendation.meldCards
            ? this.formatCards(recommendation.meldCards)
            : undefined,
        reasoning: recommendation.reasoning,
        winRate: recommendation.winRate,
        expectedScore: recommendation.expectedScore,
        priority: recommendation.priority,
        policyVersion: recommendation.policyVersion ?? 'heuristic-baseline',
        policySource: recommendation.policySource ?? 'heuristic',
        predictedWinRate: recommendation.predictedWinRate ?? recommendation.winRate,
        predictedExpectedScore: recommendation.predictedExpectedScore ?? recommendation.expectedScore,
        predictedScoreVariance: recommendation.predictedScoreVariance,
        deltaFromBest: recommendation.deltaFromBest,
        featureContributions: recommendation.featureContributions,
        baselinePriority: recommendation.baselinePriority,
        isAvailable: availableActions.some((action) => action.type === recommendation.action),
        isChosen: recommendation.action === chosenAction,
      }));

    const summary = outcome.summary || this.summarizeDecisionSource(outcome.source, outcome.analysis);
    const chosenRecommendation = this.findChosenRecommendation(outcome.analysis, chosenAction, chosenCards);
    const tracePolicyVersion = chosenRecommendation?.policyVersion
      ?? outcome.analysis?.recommendations?.[0]?.policyVersion
      ?? (this.mode === 'learned' ? 'learned-runtime' : this.mode === 'fast' ? 'rule-conditioned-fast-v1' : 'heuristic-baseline');
    const tracePolicySource = chosenRecommendation?.policySource
      ?? outcome.analysis?.recommendations?.[0]?.policySource
      ?? (this.mode === 'learned' ? 'learned' : 'heuristic');
    const normalizedFlag = outcome.legalMeta?.normalized ?? (
      normalized
        ? this.buildActionSignature(outcome.action) !== this.buildActionSignature(normalized)
        : false
    );

    return {
      playerId: this.playerId,
      phase: state.phase,
      policyVersion: tracePolicyVersion,
      policySource: tracePolicySource,
      source: outcome.source,
      chosenAction,
      chosenCards,
      availableActions: availableOptions,
      topOptions: recommendationOptions,
      legal: {
        withinAvailableActions: !!normalized,
        explicitHuAvailable: !!explicitHu,
        explicitHuTaken: !!explicitHu && chosenAction === 'hu',
        mandatoryAction: mandatoryAction?.type as PlayerActionType | undefined,
        mandatoryRespected: !mandatoryAction || chosenAction === mandatoryAction.type,
        normalized: normalizedFlag,
        fallbackApplied: outcome.legalMeta?.fallbackApplied,
        fallbackReason: outcome.legalMeta?.fallbackReason,
      },
      reasoning: outcome.analysis?.reasoning,
      summary,
      tutor: this.buildTutorTrace(chosenRecommendation, summary),
    };
  }

  private calculateResponseGainThreshold(gameState: GameState, dangerScore: number): number {
    const turnPressure = Math.min(1, gameState.turnCount / 18);
    const deckPressure = gameState.remainingDeckCards <= 0
      ? 1
      : Math.max(0, 1 - Math.min(gameState.remainingDeckCards, 20) / 20);
    const dangerPressure = Math.max(0, Math.min(1, (dangerScore - 45) / 55));
    return 1.0 + turnPressure * 1.6 + deckPressure * 2.0 + dangerPressure * 1.6;
  }

  private shouldSkipByResponseGate(
    gameState: GameState,
    candidateType: PlayerActionType,
    candidateScore: number | undefined,
    passScore: number | undefined,
    dangerScore: number | undefined,
  ): boolean {
    if (gameState.phase !== 'response_collecting') return false;
    if (!(candidateType === 'chi' || candidateType === 'peng' || candidateType === 'zhao')) return false;
    if (candidateScore === undefined || passScore === undefined) return false;
    const threshold = this.calculateResponseGainThreshold(gameState, dangerScore ?? 50);
    return candidateScore - passScore < threshold;
  }

  private deriveOutcomeSourceFromAction(action: AvailableAction): DecisionSource {
    if (action.isMandatory) return 'mandatory';
    switch (action.type) {
      case 'hu':
        return 'explicit_hu';
      case 'zhao':
      case 'peng':
      case 'chi':
        return 'meld_priority';
      case 'discard':
        return 'best_legal_discard';
      case 'draw':
      case 'pass':
        return 'default_available';
      default:
        return 'priority_fallback';
    }
  }

  private pickFallbackAction(availableActions: AvailableAction[]): AvailableAction | undefined {
    const mandatoryAction = availableActions.find((action) => action.isMandatory);
    if (mandatoryAction) {
      return mandatoryAction;
    }

    const orderedTypes: Array<AvailableAction['type']> = ['hu', 'zhao', 'peng', 'chi', 'discard', 'draw', 'pass'];
    for (const actionType of orderedTypes) {
      const action = availableActions.find((candidate) => candidate.type === actionType);
      if (action) return action;
    }

    return availableActions[0];
  }

  private buildFallbackOutcome(
    availableActions: AvailableAction[],
    fallbackReason: string,
    analysis?: AIAnalysis,
  ): DecisionOutcome {
    const fallbackAction = this.pickFallbackAction(availableActions);
    if (!fallbackAction) {
      return {
        source: 'no_action_pass',
        action: {
          type: 'pass',
          playerId: this.playerId,
          cards: [],
          timestamp: Date.now(),
        },
        analysis,
        legalMeta: {
          normalized: false,
          fallbackApplied: true,
          fallbackReason,
        },
      };
    }

    return {
      source: this.deriveOutcomeSourceFromAction(fallbackAction),
      action: this.buildActionFromAvailable(fallbackAction),
      analysis,
      legalMeta: {
        normalized: false,
        fallbackApplied: true,
        fallbackReason,
      },
    };
  }

  private buildAnalysisCandidates(
    analysis: AIAnalysis,
    availableActions: AvailableAction[],
  ): AnalysisCandidate[] {
    const candidates: AnalysisCandidate[] = [];
    const seen = new Set<string>();

    for (const ranked of analysis.rankedActions || []) {
      const action = ranked.recommendation
        ? this.buildActionFromRecommendation(ranked.availableAction, ranked.recommendation)
        : this.buildActionFromAvailable(ranked.availableAction);
      const signature = this.buildActionSignature(action);
      if (seen.has(signature)) continue;
      seen.add(signature);
      candidates.push({
        action,
        summary: ranked.recommendation?.summary || ranked.recommendation?.reasoning || ranked.summary,
        score: ranked.score,
        dangerScore: ranked.evidence?.dangerScore || ranked.recommendation?.evidence?.dangerScore,
      });
    }

    for (const recommendation of analysis.recommendations || []) {
      const matchedActions = availableActions.filter((action) => action.type === recommendation.action);
      for (const matchedAction of matchedActions) {
        const action = this.buildActionFromRecommendation(matchedAction, recommendation);
        const signature = this.buildActionSignature(action);
        if (seen.has(signature)) continue;
        seen.add(signature);
        candidates.push({
          action,
          summary: recommendation.summary || recommendation.reasoning,
          dangerScore: recommendation.evidence?.dangerScore,
        });
      }
    }

    return candidates;
  }

  private async pickBestLegalDiscard(
    state: GameState,
    playerIndex: number,
    availableActions: AvailableAction[],
  ): Promise<PlayerAction | null> {
    const discardActions = availableActions.filter((action) => action.type === 'discard' && action.cards?.[0]);
    if (discardActions.length === 0) {
      return null;
    }

    const player = state.players[playerIndex];
    let bestAction = discardActions[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const action of discardActions) {
      await new Promise((resolve) => (globalThis as any).setTimeout(resolve, 0));
      const discardCard = action.cards[0];
      const remainingCards = player.cards.filter((card) => card.id !== discardCard.id);
      const analysis = this.handAnalyzer.analyze(remainingCards, player.melds);
      const sameRankCount = player.cards.filter(
        (card) => card.value === discardCard.value && card.size === discardCard.size,
      ).length;

      let score = 0;
      score += analysis.potentialMelds.length * 5;
      score += analysis.tingCards.length * 4;
      score -= analysis.looseCards.length * 2;
      score += (analysis.completeness || 0) * 10;
      if (sameRankCount >= 2) score -= 2.5;
      if (discardCard.isRed) score -= 2;

      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    return this.buildActionFromAvailable(bestAction);
  }

  private pickFastDiscardAction(
    state: GameState,
    playerIndex: number,
    availableActions: AvailableAction[],
  ): PlayerAction | null {
    const discardActions = availableActions.filter((action) => action.type === 'discard' && action.cards?.[0]);
    if (discardActions.length === 0) {
      return null;
    }

    const handCards = state.players[playerIndex]?.cards || [];
    const exactCountMap = new Map<string, number>();
    const discardableCountMap = new Map<string, number>();
    const discardableSizes = new Set<Card['size']>();
    const valueCountMap = new Map<number, number>();

    for (const card of handCards) {
      const exactKey = `${card.size}_${card.value}`;
      exactCountMap.set(exactKey, (exactCountMap.get(exactKey) || 0) + 1);
      valueCountMap.set(card.value, (valueCountMap.get(card.value) || 0) + 1);
    }
    for (const action of discardActions) {
      const discardCard = action.cards?.[0];
      if (!discardCard) {
        continue;
      }
      const exactKey = `${discardCard.size}_${discardCard.value}`;
      discardableCountMap.set(exactKey, (discardableCountMap.get(exactKey) || 0) + 1);
      discardableSizes.add(discardCard.size);
    }

    const complete2710Sizes = new Set(
      Array.from(discardableSizes)
        .filter((size) => SPECIAL_2710_VALUES.every((value) => (discardableCountMap.get(`${size}_${value}`) || 0) > 0)),
    );

    const getKeepScore = (card: Card) => {
      const exactKey = `${card.size}_${card.value}`;
      const exactCount = exactCountMap.get(exactKey) || 0;
      // Protect only the unique legal-discard members of a complete 2710. A
      // redundant copy can still be discarded without destroying the combination.
      const isEssential2710Card = complete2710Sizes.has(card.size)
        && SPECIAL_2710_VALUES.includes(card.value)
        && (discardableCountMap.get(exactKey) || 0) === 1;
      const mixedSizeCount = Math.max(0, (valueCountMap.get(card.value) || 0) - exactCount);
      const sameSizeCards = handCards.filter((candidate) => candidate.id !== card.id && candidate.size === card.size);
      const nearLeft = sameSizeCards.some((candidate) => candidate.value === card.value - 1);
      const nearRight = sameSizeCards.some((candidate) => candidate.value === card.value + 1);
      // 2710 is an unordered combination: each distinct same-size 2710
      // member supports the current card as one adjacency link.
      const special2710PartnerCount = SPECIAL_2710_VALUES.includes(card.value)
        ? new Set(
            sameSizeCards
              .filter((candidate) => candidate.value !== card.value && SPECIAL_2710_VALUES.includes(candidate.value))
              .map((candidate) => candidate.value),
          ).size
        : 0;
      const skipLeft = sameSizeCards.some((candidate) => candidate.value === card.value - 2);
      const skipRight = sameSizeCards.some((candidate) => candidate.value === card.value + 2);

      let score = 0;
      score += (exactCount - 1) * 5;
      score += mixedSizeCount * 3;
      score += (nearLeft ? 2.5 : 0) + (nearRight ? 2.5 : 0);
      score += special2710PartnerCount * SPECIAL_2710_LINK_BONUS;
      score += (skipLeft ? 0.75 : 0) + (skipRight ? 0.75 : 0);
      score += card.isRed ? 1.5 : 0;
      score -= exactCount === 1 ? 4 : 0;
      score -= !nearLeft && !nearRight ? 1.25 : 0;
      score += isEssential2710Card ? COMPLETE_2710_KEEP_BONUS : 0;
      return score;
    };

    let bestAction = discardActions[0];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const action of discardActions) {
      const discardCard = action.cards?.[0];
      if (!discardCard) {
        continue;
      }

      const keepScore = getKeepScore(discardCard);
      if (
        keepScore < bestScore
        || (
          keepScore === bestScore
          && bestAction.cards?.[0]
          && Number(!!discardCard.isRed) < Number(!!bestAction.cards[0].isRed)
        )
      ) {
        bestScore = keepScore;
        bestAction = action;
      }
    }

    return this.buildActionFromAvailable(bestAction);
  }

  private async buildFastHeuristicOutcome(
    state: GameState,
    playerIndex: number,
    availableActions: AvailableAction[],
  ): Promise<DecisionOutcome> {
    if (availableActions.length === 0) {
      return this.buildFallbackOutcome([], 'no_available_action');
    }

    const mandatoryAction = availableActions.find((action) => action.isMandatory);
    if (mandatoryAction) {
      return { source: 'mandatory', action: this.buildActionFromAvailable(mandatoryAction) };
    }

    const huAction = availableActions.find((action) => action.type === 'hu');
    if (huAction) {
      return { source: 'explicit_hu', action: this.buildActionFromAvailable(huAction) };
    }

    if (state.phase === 'discarding') {
      const fastDiscard = this.pickFastDiscardAction(state, playerIndex, availableActions);
      if (fastDiscard) {
        return { source: 'best_legal_discard', action: fastDiscard };
      }
    }

    const fallbackAction = this.pickFallbackAction(availableActions);
    if (!fallbackAction) {
      return this.buildFallbackOutcome([], 'no_available_action');
    }

    return {
      source: this.deriveOutcomeSourceFromAction(fallbackAction),
      action: this.buildActionFromAvailable(fallbackAction),
    };
  }

  private async mediumDecide(
    state: GameState,
    playerIndex: number,
    availableActions: AvailableAction[],
  ): Promise<DecisionOutcome> {
    if (availableActions.length === 0) {
      return this.buildFallbackOutcome([], 'no_available_action');
    }

    const mandatoryAction = availableActions.find((action) => action.isMandatory);
    if (mandatoryAction) {
      return { source: 'mandatory', action: this.buildActionFromAvailable(mandatoryAction) };
    }

    const huAction = availableActions.find((action) => action.type === 'hu');
    if (huAction) {
      return { source: 'explicit_hu', action: this.buildActionFromAvailable(huAction) };
    }

    try {
      const discardActionCount = availableActions.filter((action) => action.type === 'discard').length;
      // Keep live table decisions bounded; GameManager remains the authority for legality.
      const analysisDiscardTopK = Math.min(
        Math.max(this.analysisConfig.discardTopK ?? 5, 1),
        8,
      );
      const analysis = await this.aiAnalyzer.analyze(state, playerIndex, {
        discardTopK: Math.min(Math.max(analysisDiscardTopK, discardActionCount > 0 ? 1 : 0), discardActionCount || analysisDiscardTopK),
        chiOptionTopK: this.analysisConfig.chiOptionTopK ?? 3,
        policyMode: this.mode === 'learned' ? 'learned' : 'heuristic',
      });
      const candidates = this.buildAnalysisCandidates(analysis, availableActions);
      const passScore = analysis.rankedActions?.find((item) => item.availableAction.type === 'pass')?.score;
      let illegalCount = 0;
      let gatedCount = 0;

      for (const candidate of candidates) {
        const normalized = this.normalizeToAvailableAction(candidate.action, availableActions);
        if (!normalized) {
          illegalCount += 1;
          continue;
        }

        if (this.shouldSkipByResponseGate(state, normalized.type, candidate.score, passScore, candidate.dangerScore)) {
          gatedCount += 1;
          continue;
        }

        return {
          source: 'analysis_top',
          action: normalized,
          analysis,
          summary: candidate.summary,
          legalMeta: {
            normalized: this.buildActionSignature(candidate.action) !== this.buildActionSignature(normalized),
            fallbackApplied: false,
          },
        };
      }

      if (candidates.length > 0) {
        const fallbackReason = gatedCount === candidates.length
          ? 'response_gain_below_threshold'
          : illegalCount === candidates.length
            ? 'illegal_analysis_candidate'
            : 'analysis_candidate_exhausted';
        return this.buildFallbackOutcome(availableActions, fallbackReason, analysis);
      }

      return this.buildFallbackOutcome(availableActions, 'analysis_no_candidate', analysis);
    } catch {
      return this.buildFallbackOutcome(availableActions, 'analysis_error');
    }
  }

  private async decideInternal(
    state: GameState,
    playerIndex: number,
    availableActions: AvailableAction[],
  ): Promise<DecisionOutcome> {
    if (this.mode === 'fast') {
      return this.buildFastHeuristicOutcome(state, playerIndex, availableActions);
    }
    return this.mediumDecide(state, playerIndex, availableActions);
  }

  async decideWithTrace(state: GameState): Promise<{ action: PlayerAction; trace: AIDecisionTrace }> {
    const playerIndex = state.players.findIndex((player) => player.playerId === this.playerId);
    if (playerIndex === -1) {
      throw new Error(`Player ${this.playerId} not found in game state`);
    }

    const availableActions = state.availableActions || [];
    const outcome = await this.decideInternal(state, playerIndex, availableActions);
    const normalized = this.normalizeToAvailableAction(outcome.action, availableActions);
    const action = normalized || outcome.action;

    return {
      action,
      trace: this.buildDecisionTrace(state, availableActions, { ...outcome, action }),
    };
  }

  async decide(state: GameState): Promise<PlayerAction> {
    const playerIndex = state.players.findIndex((player) => player.playerId === this.playerId);
    if (playerIndex === -1) {
      throw new Error(`Player ${this.playerId} not found in game state`);
    }

    const availableActions = state.availableActions || [];
    const outcome = await this.decideInternal(state, playerIndex, availableActions);
    const normalized = this.normalizeToAvailableAction(outcome.action, availableActions);
    return normalized || outcome.action;
  }

  decideDiscard(state: GameState, playerIndex: number): Card {
    const player = state.players[playerIndex];
    const bestDiscard = this.handAnalyzer.findBestDiscard(player.cards, player.melds);
    return bestDiscard ? bestDiscard.card : player.cards[0];
  }

  decideMeld(_state: GameState, _action: AvailableAction): boolean {
    return true;
  }

  getPlayerId(): string {
    return this.playerId;
  }
}
