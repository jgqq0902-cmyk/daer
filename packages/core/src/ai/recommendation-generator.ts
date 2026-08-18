import { Card, Meld, GameState } from '../shared/types';
import type { AIPlayRecommendation, AIDecisionEvidence, ActionScoreBreakdown } from './types';
import { HandAnalyzer } from '../game-engine/hand-analyzer';
import { RulesValidator } from '../game-engine/rules-validator';
import { ActionPriorityScorer } from './action-priority-scorer';
import { type PolicyMode, scorePolicyFeatures, getActivePolicyArtifact } from './policy-artifact';
import { computeRecommendationPriorityByMode } from './policy-ranking';
import { buildPolicyFeatures } from './policy-feature-builder';

export interface ListeningInfo {
  waitCards: string[];
  remainingWaitCount: number;
  maxHuPoints: number;
  avgHuPoints: number;
  maxRoundScore: number;
  avgRoundScore: number;
  bestMingTangNames: string[];
}

export interface CardProfile {
  isLocked: boolean;
  sameCards: number;
  mixedSizeCards: number;
  sequenceLinks: number;
  specialLinks: number;
  liveResponseSequenceCount: number;
  liveResponse2710Count: number;
  deadResponseSequenceCount: number;
  deadResponse2710Count: number;
  stableResponseBlockCount: number;
  guiResponseCount: number;
  viablePairTemplates: number;
  viableMixedTemplates: number;
  viableSequenceTemplates: number;
  viable2710Templates: number;
  blockedPairTemplates: number;
  blockedMixedTemplates: number;
  blockedSequenceTemplates: number;
  blocked2710Templates: number;
  freeSupportCount: number;
  lockedSupportCount: number;
  totalTemplateCount: number;
  blockedTemplateCount: number;
  liveSameCardCount: number;
  liveMixedCardCount: number;
  liveSequenceCount: number;
  liveSpecialCount: number;
  totalLiveSupport: number;
  isIsolated: boolean;
  isNearlyDead: boolean;
}

export interface DangerInfo {
  score: number;
  label: 'low' | 'medium' | 'high';
  summary: string;
}

export interface ProjectedStateInfo {
  winRate: number;
  expectedScore: number;
  compositeScore: number;
  posture: 'attack' | 'balance' | 'defense';
  speedScore: number;
  scorePotential: number;
  defensePressure: number;
  confidence: number;
  summary: string;
}

interface ResolvedResponseState {
  evaluation: ProjectedStateInfo;
  listening: ListeningInfo;
  analysis: ReturnType<HandAnalyzer['analyze']>;
  bestDiscard?: Card;
}

interface PostResponseDiscardEvaluation {
  bestScore: number;
  bestDiscard?: Card;
  bestListening?: ListeningInfo;
  bestEvaluation?: ProjectedStateInfo;
  bestAnalysis?: ReturnType<HandAnalyzer['analyze']>;
  bestDanger?: DangerInfo;
}

interface RecommendationGeneratorDeps {
  handAnalyzer: HandAnalyzer;
  rulesValidator: RulesValidator;
  evaluateProjectedState: (handCards: Card[], melds: Meld[], discardedCards: Card[], gameState?: GameState) => ProjectedStateInfo;
  evaluateDiscardListening: (gameState: GameState, handCards: Card[], melds: Meld[]) => ListeningInfo;
  buildDecisionEvidence: (params: {
    evaluation?: ProjectedStateInfo;
    listening?: ListeningInfo;
    danger?: DangerInfo;
    tempoGain?: number;
    flexibility?: number;
    breakdown?: ActionScoreBreakdown;
    extraSignals?: string[];
  }) => AIDecisionEvidence;
  buildEvBreakdown: (params: {
    gameState: GameState;
    playerIndex: number;
    beforeSteps?: number;
    afterSteps?: number;
    beforeUkeire?: number;
    afterUkeire?: number;
    beforeScorePotential?: number;
    afterScorePotential?: number;
    dangerScore?: number;
  }) => ActionScoreBreakdown;
  buildTeachingPayload: (
    action: AIPlayRecommendation['action'],
    posture: AIPlayRecommendation['posture'],
    evidence: AIDecisionEvidence,
    fallbackSummary: string,
    fallbackPoints: string[],
  ) => Pick<AIPlayRecommendation, 'summary' | 'keyPoints' | 'evidence'>;
  buildRecommendationSummary: (
    action: AIPlayRecommendation['action'],
    posture: 'attack' | 'balance' | 'defense',
    reasoning: string,
  ) => string;
  buildDiscardKeyPoints: (
    listening: ListeningInfo,
    profile: CardProfile,
    danger: DangerInfo,
    evaluation: ProjectedStateInfo,
  ) => string[];
  getCardConnectionProfile: (card: Card, handCards: Card[], melds: Meld[], gameState: GameState) => CardProfile;
  calculateKeepValue: (card: Card, handCards: Card[], melds: Meld[], gameState: GameState) => number;
  generateDiscardReasoning: (
    card: Card,
    evaluation: ProjectedStateInfo,
    keepValue: number,
    listening: ListeningInfo,
    profile: CardProfile,
    danger: DangerInfo,
  ) => string;
  formatCardCode: (card: Card) => string;
  assessDiscardDanger: (card: Card, gameState: GameState, playerIndex: number) => DangerInfo;
}

export interface RecommendationConfig {
  discardTopK?: number;
  chiOptionTopK?: number;
  policyMode?: PolicyMode;
}

export class AIRecommendationGenerator {
  private readonly priorityScorer: ActionPriorityScorer;

  constructor(private readonly deps: RecommendationGeneratorDeps) {
    this.priorityScorer = new ActionPriorityScorer();
  }

  generateRecommendations(
    gameState: GameState,
    playerIndex: number,
    handCards: Card[],
    melds: Meld[],
    config?: RecommendationConfig,
  ): AIPlayRecommendation[] {
    const recommendations: AIPlayRecommendation[] = [];
    const availableActions = gameState.availableActions || [];
    const player = gameState.players[playerIndex];
    const discardedCards = gameState.discardPile?.cards || [];
    if (!player) return recommendations;

    const huAction = availableActions.find((action) => action.type === 'hu');
    if (huAction) {
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 1, expectedScore: Math.max(10, gameState.winningRoundScore || 0), compositeScore: 100, posture: 'attack', speedScore: 1, scorePotential: Math.max(10, gameState.winningRoundScore || 0), defensePressure: 0, confidence: 0.98, summary: '已经形成直接得分机会' },
        listening: { waitCards: [], remainingWaitCount: 0, maxHuPoints: gameState.winningHuPoints || 0, avgHuPoints: 0, maxRoundScore: Math.max(10, gameState.winningRoundScore || 0), avgRoundScore: 0, bestMingTangNames: [] },
        extraSignals: ['当前已经满足胡牌条件', '继续贪大反而会增加走形和放炮风险'],
      });
      const teaching = this.deps.buildTeachingPayload('hu', 'attack', evidence, '已经形成直接得分机会，优先稳稳收分。', ['当前已经满足胡牌条件', '继续贪大反而会增加走形和放炮风险']);
      recommendations.push({
        action: 'hu',
        reasoning: '现在已经能胡，而且分数已经落袋，先收分最稳，不必再冒放炮和走形的风险',
        winRate: 1,
        expectedScore: Math.max(10, gameState.winningRoundScore || 0),
        riskLevel: 'low',
        posture: 'attack',
        ...teaching,
        confidence: 0.98,
        priority: 100,
      });
    }

    const analysis = this.deps.handAnalyzer.analyze(handCards, melds);
    const baseProjection = this.deps.evaluateProjectedState(handCards, melds, discardedCards, gameState);
    const baseListening = this.deps.evaluateDiscardListening(gameState, handCards, melds);
    if (!huAction && analysis.canWin) {
      const breakdown = this.deps.buildEvBreakdown({
        gameState,
        playerIndex,
        beforeSteps: 1,
        afterSteps: 0,
        beforeUkeire: baseListening.remainingWaitCount,
        afterUkeire: 0,
        beforeScorePotential: baseProjection.scorePotential,
        afterScorePotential: analysis.totalHuPoints || 0,
        dangerScore: 0,
      });
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 1, expectedScore: analysis.totalHuPoints || 0, compositeScore: 100, posture: 'attack', speedScore: 1, scorePotential: analysis.totalHuPoints || 0, defensePressure: 0, confidence: 0.96, summary: '牌已经成熟' },
        listening: { waitCards: [], remainingWaitCount: 0, maxHuPoints: analysis.totalHuPoints || 0, avgHuPoints: 0, maxRoundScore: analysis.totalHuPoints || 0, avgRoundScore: 0, bestMingTangNames: [] },
        breakdown,
        extraSignals: ['当前已成胡', '这时继续拖一手通常不如直接兑现收益'],
      });
      const teaching = this.deps.buildTeachingPayload('hu', 'attack', evidence, '牌已经成熟，先把确定收益拿下。', ['当前已成胡', '这时继续拖一手通常不如直接兑现收益']);
      recommendations.push({
        action: 'hu',
        reasoning: '手牌已经成胡，继续贪更大的收益并不划算，立即胡牌更像稳健高手的处理',
        winRate: 1,
        expectedScore: analysis.totalHuPoints || 0,
        riskLevel: 'low',
        posture: 'attack',
        ...teaching,
        confidence: 0.96,
        priority: 100,
      });
    }

    if (gameState.phase === 'response_collecting') {
      recommendations.push(...this.buildResponseRecommendations(gameState, playerIndex, baseProjection, baseListening, analysis));
    }

    const zhaoAction = availableActions.find((action) => action.type === 'zhao');
    if (zhaoAction && !recommendations.some((item) => item.action === 'zhao')) {
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 0.66, expectedScore: 8, compositeScore: 78, posture: 'attack', speedScore: 0.58, scorePotential: 8, defensePressure: 0.18, confidence: 0.82, summary: '招牌偏立分' },
        extraSignals: ['直接增加胡息', '多数情况下还能保留后续主干'],
        flexibility: 0.52,
      });
      const teaching = this.deps.buildTeachingPayload('zhao', 'attack', evidence, '招牌能直接做高分数，而且通常不伤结构。', ['直接增加胡息', '多数情况下还能保留后续主干']);
      recommendations.push({
        action: 'zhao',
        meldCards: zhaoAction.cards,
        reasoning: '这步招牌会直接加胡息，而且通常不会破坏主干，属于收益明确的进攻动作',
        winRate: 0.66,
        expectedScore: 8,
        riskLevel: 'low',
        posture: 'attack',
        ...teaching,
        confidence: 0.82,
        priority: 88,
      });
    }

    const pengAction = availableActions.find((action) => action.type === 'peng');
    if (pengAction && !recommendations.some((item) => item.action === 'peng')) {
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 0.54, expectedScore: 4, compositeScore: 62, posture: 'balance', speedScore: 0.42, scorePotential: 4, defensePressure: 0.32, confidence: 0.68, summary: '碰后结构更固定' },
        extraSignals: ['当前收益明确', '碰后牌型会更固定，要留意下一张怎么打'],
        flexibility: 0.28,
      });
      const teaching = this.deps.buildTeachingPayload('peng', 'balance', evidence, '碰牌能立刻做实一组，但会减少后续转身空间。', ['当前收益明确', '碰后牌型会更固定，要留意下一张怎么打']);
      recommendations.push({
        action: 'peng',
        meldCards: pengAction.cards,
        reasoning: pengAction.cards.some((card) => card.isRed)
          ? '碰这张能把红牌收益立住，但也会让手牌更固定，要看后续弃牌是否安全'
          : '碰后结构更整齐，适合当前偏进攻的节奏',
        winRate: 0.54,
        expectedScore: 4,
        riskLevel: 'medium',
        posture: 'balance',
        ...teaching,
        confidence: 0.68,
        priority: 62,
      });
    }

    if (gameState.phase === 'discarding') {
      const legalDiscardIds = new Set(
        availableActions
          .filter((action) => action.type === 'discard' && action.cards?.[0]?.id)
          .map((action) => action.cards[0].id),
      );

      const beforeAnalysis = this.deps.handAnalyzer.analyze(handCards, melds);
      const sortedCards = handCards
        .filter((card) => legalDiscardIds.has(card.id))
        .map((card) => {
          const remainingCards = handCards.filter((candidate) => candidate.id !== card.id);
          const afterAnalysis = this.deps.handAnalyzer.analyze(remainingCards, melds);
          const listening = this.deps.evaluateDiscardListening(gameState, remainingCards, melds);
          const evaluation = this.deps.evaluateProjectedState(remainingCards, melds, [...discardedCards, card], gameState);
          const profile = this.deps.getCardConnectionProfile(card, handCards, melds, gameState);
          const keepValue = this.deps.calculateKeepValue(card, handCards, melds, gameState);
          const resolvedDanger = this.deps.assessDiscardDanger(card, gameState, playerIndex);
          const stableStructureLoss = Math.max(0, this.countStableStructures(beforeAnalysis) - this.countStableStructures(afterAnalysis));
          const preservesTempo = (afterAnalysis.stepsToWin || 3) <= (beforeAnalysis.stepsToWin || 3);
          const exactMeldAnchorStrength = this.countExactMeldAnchors(card, handCards);
          const shapeAnchorStrength = Math.max(0, profile.sequenceLinks - 2) * 18
            + (profile.mixedSizeCards > 0 ? 18 : 0)
            + (profile.sameCards === 0 && profile.sequenceLinks >= 3 ? 16 : 0)
            + exactMeldAnchorStrength * 12;
          const pseudoLooseRank = this.getPseudoLooseRank(card, handCards, profile, preservesTempo);
          const trashQueueRank = profile.isIsolated
            ? 2
            : profile.isNearlyDead && preservesTempo
              ? 1
              : 0;
          const breakdown = this.deps.buildEvBreakdown({
            gameState,
            playerIndex,
            beforeSteps: beforeAnalysis.stepsToWin,
            afterSteps: afterAnalysis.stepsToWin,
            beforeUkeire: baseListening.remainingWaitCount,
            afterUkeire: listening.remainingWaitCount,
            beforeScorePotential: baseProjection.scorePotential,
            afterScorePotential: Math.max(evaluation.scorePotential, listening.maxRoundScore),
            dangerScore: resolvedDanger.score,
          });
          return {
            card,
            listening,
            profile,
            danger: resolvedDanger,
            keepValue,
            evaluation,
            breakdown,
            tempoGain: (beforeAnalysis.stepsToWin || 3) - (afterAnalysis.stepsToWin || 3),
            trashQueueRank,
            pseudoLooseRank,
            score: this.priorityScorer.scoreDiscardCandidate({
              beforeWaitCount: baseListening.waitCards.length,
              breakdownTotal: breakdown.total,
              compositeScore: evaluation.compositeScore,
              keepValue,
              waitCount: listening.waitCards.length,
              remainingWaitCount: listening.remainingWaitCount,
              maxRoundScore: listening.maxRoundScore,
              isRed: card.isRed,
              isIsolated: profile.isIsolated,
              isNearlyDead: profile.isNearlyDead,
              preservesTempo,
              shapeAnchorStrength,
              exactMeldAnchorStrength,
              stableStructureLoss,
            }),
          };
        });

      sortedCards.sort((left, right) => right.trashQueueRank - left.trashQueueRank || right.pseudoLooseRank - left.pseudoLooseRank || right.score - left.score || right.evaluation.winRate - left.evaluation.winRate);

      for (let index = 0; index < Math.min(3, sortedCards.length); index++) {
        const item = sortedCards[index];
        const evidence = this.deps.buildDecisionEvidence({
          evaluation: item.evaluation,
          listening: item.listening,
          danger: item.danger,
          breakdown: item.breakdown,
          tempoGain: item.tempoGain,
          flexibility: Math.max(0, Math.min(1, item.keepValue / 24)),
        });
        const teaching = this.deps.buildTeachingPayload(
          'discard',
          item.evaluation.posture,
          evidence,
          this.deps.buildRecommendationSummary('discard', item.evaluation.posture, ''),
          this.deps.buildDiscardKeyPoints(item.listening, item.profile, item.danger, item.evaluation),
        );
        recommendations.push({
          action: 'discard',
          card: item.card,
          reasoning: this.deps.generateDiscardReasoning(item.card, item.evaluation, item.keepValue, item.listening, item.profile, item.danger),
          winRate: item.evaluation.winRate,
          expectedScore: Math.max(item.evaluation.expectedScore, item.listening.maxRoundScore),
          riskLevel: item.danger.label,
          posture: item.evaluation.posture,
          ...teaching,
          confidence: Math.max(0.45, Math.min(0.95, item.evaluation.confidence - index * 0.08)),
          priority: this.priorityScorer.scoreDiscardPriority({
            rankIndex: index,
            breakdownTotal: item.breakdown.total,
            speedScore: item.evaluation.speedScore,
            candidateScore: item.evaluation.compositeScore,
            winRate: item.evaluation.winRate,
            expectedScore: Math.max(item.evaluation.expectedScore, item.listening.maxRoundScore),
            trashQueueRank: item.trashQueueRank,
            pseudoLooseRank: item.pseudoLooseRank,
          }),
        });
      }
    }

    const chiAction = availableActions.find((action) => action.type === 'chi');
    if (chiAction && gameState.phase !== 'response_collecting' && !recommendations.some((item) => item.action === 'chi')) {
      const evidence = this.deps.buildDecisionEvidence({
        evaluation: { winRate: 0.45, expectedScore: 2, compositeScore: 48, posture: 'balance', speedScore: 0.38, scorePotential: 2, defensePressure: 0.28, confidence: 0.56, summary: '收益一般' },
        extraSignals: ['要结合吃后弃牌是否安全', '不能只看眼前能不能成一组'],
        flexibility: 0.34,
      });
      const teaching = this.deps.buildTeachingPayload('chi', 'balance', evidence, '这步能吃，但收益还没大到可以无脑执行。', ['要结合吃后弃牌是否安全', '不能只看眼前能不能成一组']);
      recommendations.push({
        action: 'chi',
        meldCards: chiAction.cards,
        reasoning: '这步吃牌有基础收益，但还要看吃完之后丢哪张更安全，不能只看眼前能不能吃',
        winRate: 0.45,
        expectedScore: 2,
        riskLevel: 'medium',
        posture: 'balance',
        ...teaching,
        confidence: 0.56,
        priority: 40,
      });
    }

    this.enrichRecommendationsWithPolicy(recommendations, gameState, config?.policyMode);
    recommendations.sort((left, right) => right.priority - left.priority);
    return recommendations;
  }

  private buildResponseRecommendations(
    gameState: GameState,
    playerIndex: number,
    passEvaluation: ProjectedStateInfo,
    passListening: ListeningInfo,
    passAnalysis: ReturnType<HandAnalyzer['analyze']>,
  ): AIPlayRecommendation[] {
    const player = gameState.players[playerIndex];
    const targetCard = gameState.discardPile?.lastDiscard;
    if (!player) return [];

    const resolvedPass = this.resolvePassState(
      gameState,
      playerIndex,
      player.cards,
      player.melds,
      targetCard,
      passEvaluation,
      passListening,
      passAnalysis,
    );

    const recommendations: AIPlayRecommendation[] = [];

    if (gameState.availableActions.find((action) => action.type === 'pass')) {
      const passBreakdown = this.deps.buildEvBreakdown({
        gameState,
        playerIndex,
        beforeSteps: passAnalysis.stepsToWin,
        afterSteps: resolvedPass.analysis.stepsToWin,
        beforeUkeire: passListening.remainingWaitCount,
        afterUkeire: resolvedPass.listening.remainingWaitCount,
        beforeScorePotential: passEvaluation.scorePotential,
        afterScorePotential: Math.max(resolvedPass.evaluation.scorePotential, resolvedPass.listening.maxRoundScore),
        dangerScore: Math.round(resolvedPass.evaluation.defensePressure * 100),
      });
        const evidence = this.deps.buildDecisionEvidence({
          evaluation: resolvedPass.evaluation,
          listening: resolvedPass.listening,
          breakdown: passBreakdown,
          tempoGain: (passAnalysis.stepsToWin || 3) - (resolvedPass.analysis.stepsToWin || 3),
          extraSignals: [resolvedPass.evaluation.summary, '当前这张牌带来的即时收益还不够大'],
          flexibility: 0.62,
        });
      const teaching = this.deps.buildTeachingPayload('pass', resolvedPass.evaluation.posture, evidence, '先过是为了保住路线弹性，不是简单放弃。', [resolvedPass.evaluation.summary, '当前这张牌带来的即时收益还不够大']);
      recommendations.push({
        action: 'pass',
        reasoning: resolvedPass.bestDiscard
          ? `先过后再顺手调整 ${this.deps.formatCardCode(resolvedPass.bestDiscard)}，整体路线并不比响应差`
          : '先过的意思不是放弃，而是这一步带来的胡息、番数和后续价值都不够明显，先把手牌弹性留住',
        winRate: resolvedPass.evaluation.winRate,
        expectedScore: Math.max(resolvedPass.evaluation.expectedScore, resolvedPass.listening.maxRoundScore),
        riskLevel: 'low',
        posture: resolvedPass.evaluation.posture,
        ...teaching,
        confidence: resolvedPass.evaluation.confidence,
        priority: this.priorityScorer.scorePassPriority(passBreakdown.total),
      });
    }

    const pengAction = gameState.availableActions.find((action) => action.type === 'peng');
    if (pengAction && targetCard) {
      const sameCards = player.cards.filter((card) => card.value === targetCard.value && card.size === targetCard.size).slice(0, 2);
      if (sameCards.length === 2) {
        const meld: Meld = { type: 'peng' as any, cards: [...sameCards, targetCard], isConcealed: false, position: 'table', huPoints: 0 };
        const remainingCards = player.cards.filter((card) => !sameCards.some((same) => same.id === card.id));
        const evaluation = this.deps.evaluateProjectedState(remainingCards, [...player.melds, meld], gameState.discardPile?.cards || [], gameState);
        const afterAnalysis = this.deps.handAnalyzer.analyze(remainingCards, [...player.melds, meld]);
        const afterListening = this.deps.evaluateDiscardListening(gameState, remainingCards, [...player.melds, meld]);
        const breakdown = this.deps.buildEvBreakdown({
          gameState,
          playerIndex,
          beforeSteps: passAnalysis.stepsToWin,
          afterSteps: afterAnalysis.stepsToWin,
          beforeUkeire: passListening.remainingWaitCount,
          afterUkeire: afterListening.remainingWaitCount,
          beforeScorePotential: passEvaluation.scorePotential,
          afterScorePotential: Math.max(evaluation.scorePotential, afterListening.maxRoundScore),
          dangerScore: Math.round(evaluation.defensePressure * 100),
        });
        const delta = this.priorityScorer.scoreResponseDelta({
          breakdownTotal: breakdown.total,
          evaluationCompositeScore: evaluation.compositeScore,
          passCompositeScore: passEvaluation.compositeScore,
        });
        const evidence = this.deps.buildDecisionEvidence({
          evaluation,
          listening: afterListening,
          breakdown,
          danger: { score: delta >= 0 ? 48 : 72, label: delta >= 0 ? 'medium' : 'high', summary: delta >= 0 ? '收益能覆盖一部分后手压力' : '这步会让后续处理空间变窄' },
          tempoGain: delta / 20,
          flexibility: delta >= 0 ? 0.34 : 0.18,
          extraSignals: [evaluation.summary, delta >= 0 ? '这手更像主动立分' : '这一碰会压缩后续安全弃牌空间'],
        });
        const teaching = this.deps.buildTeachingPayload('peng', evaluation.posture, evidence, delta >= 0 ? '碰后收益能盖过路线损失。' : '碰虽然成立，但后手会变僵。', [evaluation.summary, delta >= 0 ? '这手更像主动立分' : '这一碰会压缩后续安全弃牌空间']);
        recommendations.push({
          action: 'peng',
          meldCards: pengAction.cards,
          reasoning: delta >= 0
            ? '碰这张能把眼前收益先立住，既补胡息，也让牌型更集中'
            : '碰是能碰，但碰完手牌太僵，后面反而更容易被迫打危险张，不如先过',
          winRate: evaluation.winRate,
          expectedScore: evaluation.expectedScore,
          riskLevel: delta >= 0 ? 'medium' : 'high',
          posture: evaluation.posture,
          ...teaching,
          confidence: evaluation.confidence,
          priority: this.priorityScorer.scoreResponsePriority(delta >= 0 ? 56 : 24, breakdown.total),
        });
      }
    }

    const zhaoAction = gameState.availableActions.find((action) => action.type === 'zhao');
    if (zhaoAction && targetCard) {
      const sameCards = player.cards.filter((card) => card.value === targetCard.value && card.size === targetCard.size).slice(0, 3);
      if (sameCards.length === 3) {
        const meld: Meld = { type: 'draw_quadruple' as any, cards: [...sameCards, targetCard], isConcealed: false, position: 'table', huPoints: 0 };
        const remainingCards = player.cards.filter((card) => !sameCards.some((same) => same.id === card.id));
        const evaluation = this.deps.evaluateProjectedState(remainingCards, [...player.melds, meld], gameState.discardPile?.cards || [], gameState);
        const afterAnalysis = this.deps.handAnalyzer.analyze(remainingCards, [...player.melds, meld]);
        const afterListening = this.deps.evaluateDiscardListening(gameState, remainingCards, [...player.melds, meld]);
        const breakdown = this.deps.buildEvBreakdown({
          gameState,
          playerIndex,
          beforeSteps: passAnalysis.stepsToWin,
          afterSteps: afterAnalysis.stepsToWin,
          beforeUkeire: passListening.remainingWaitCount,
          afterUkeire: afterListening.remainingWaitCount,
          beforeScorePotential: passEvaluation.scorePotential,
          afterScorePotential: Math.max(evaluation.scorePotential, afterListening.maxRoundScore),
          dangerScore: Math.round(evaluation.defensePressure * 100),
        });
        const delta = this.priorityScorer.scoreResponseDelta({
          breakdownTotal: breakdown.total,
          evaluationCompositeScore: evaluation.compositeScore,
          passCompositeScore: passEvaluation.compositeScore,
        });
        const evidence = this.deps.buildDecisionEvidence({
          evaluation,
          listening: afterListening,
          breakdown,
          tempoGain: delta / 18,
          flexibility: 0.48,
          extraSignals: [evaluation.summary, '招牌通常不会像碰牌那样明显破坏主干'],
        });
        const teaching = this.deps.buildTeachingPayload('zhao', 'attack', evidence, delta >= 0 ? '招牌的直接得分价值很高。' : '这步偏立分，提速收益反而一般。', [evaluation.summary, '招牌通常不会像碰牌那样明显破坏主干']);
        recommendations.push({
          action: 'zhao',
          meldCards: zhaoAction.cards,
          reasoning: delta >= 0
            ? '招这张能直接把分数做高，而且招后结构通常还稳，属于收益很直白的选择'
            : '虽然能招，但招完后续衔接一般，这一步更多是立分而不是提速',
          winRate: evaluation.winRate,
          expectedScore: evaluation.expectedScore,
          riskLevel: 'low',
          posture: 'attack',
          ...teaching,
          confidence: Math.max(0.72, evaluation.confidence),
          priority: this.priorityScorer.scoreResponsePriority(60, breakdown.total),
        });
      }
    }

    const chiAction = gameState.availableActions.find((action) => action.type === 'chi');
    if (chiAction && targetCard) {
      const bestChi = (chiAction.chiOptions || [])
        .map((option) => {
          const meldType = this.deps.rulesValidator.detectChiMeldType(option.mainMeldCards);
          if (!meldType) return null;
          const mainMeld: Meld = { type: meldType, cards: option.mainMeldCards, isConcealed: false, position: 'table', huPoints: 0 };
          const afterMelds = [...player.melds, mainMeld, ...option.additionalMelds];
          const rawEvaluation = this.deps.evaluateProjectedState(option.remainingCards, afterMelds, gameState.discardPile?.cards || [], gameState);
          const afterAnalysis = this.deps.handAnalyzer.analyze(option.remainingCards, afterMelds);
          const followUp = this.evaluateBestPostResponseDiscard(option.remainingCards, afterMelds, gameState, playerIndex);
          const finalEvaluation = followUp.bestEvaluation || rawEvaluation;
          const finalAnalysis = followUp.bestAnalysis || afterAnalysis;
          const finalListening = followUp.bestListening || this.deps.evaluateDiscardListening(gameState, option.remainingCards, afterMelds);
          const formedUnitDelta = (afterAnalysis.melds.length + afterAnalysis.potentialMelds.length) - (resolvedPass.analysis.melds.length + resolvedPass.analysis.potentialMelds.length);
          const tingDelta = afterAnalysis.tingCards.length - resolvedPass.analysis.tingCards.length;
          const stepDelta = (resolvedPass.analysis.stepsToWin || 3) - (finalAnalysis.stepsToWin || afterAnalysis.stepsToWin || 3);
          const huDelta = (afterAnalysis.totalHuPoints || 0) - (resolvedPass.analysis.totalHuPoints || 0);
          const breakdown = this.deps.buildEvBreakdown({
            gameState,
            playerIndex,
            beforeSteps: resolvedPass.analysis.stepsToWin,
            afterSteps: afterAnalysis.stepsToWin,
            beforeUkeire: resolvedPass.listening.remainingWaitCount,
            afterUkeire: finalListening.remainingWaitCount,
            beforeScorePotential: Math.max(resolvedPass.evaluation.scorePotential, resolvedPass.listening.maxRoundScore),
            afterScorePotential: Math.max(rawEvaluation.scorePotential, finalListening.maxRoundScore),
            dangerScore: followUp.bestDanger?.score ?? Math.round(finalEvaluation.defensePressure * 100),
          });
          const followUpWaitDelta = finalListening.remainingWaitCount - resolvedPass.listening.remainingWaitCount;
          const followUpScoreDelta = finalListening.maxRoundScore - resolvedPass.listening.maxRoundScore;
          const meaningfulGain = stepDelta > 0
            || tingDelta > 0
            || followUpWaitDelta > 0
            || followUpScoreDelta > 0
            || huDelta > 0
            || option.additionalMelds.length > 0;
          const structureBonus = meldType === 'mixed_size' || meldType === 'special_2710'
            ? 8
            : 0;
          const realizedMeldBonus = meaningfulGain
            ? (1 + option.additionalMelds.length) * 6 + option.additionalMelds.length * 6 + structureBonus
            : 0;
          const weakSequencePenalty = meldType === 'sequence'
            && option.additionalMelds.length === 0
            && stepDelta <= 0
            && tingDelta <= 0
            && followUpWaitDelta <= 0
            && followUpScoreDelta <= 0
            ? 30
            : 0;
          const rawDelta = this.priorityScorer.scoreChiRawDelta({
            evaluationCompositeScore: rawEvaluation.compositeScore,
            passCompositeScore: resolvedPass.evaluation.compositeScore,
            formedUnitDelta,
            tingDelta,
            stepDelta,
            huDelta,
            followUpWaitDelta: finalListening.waitCards.length,
            followUpScoreDelta: finalListening.maxRoundScore,
            selfDraw: gameState.pendingCardSource === 'draw',
            routeImproved: afterAnalysis.potentialMelds.filter((meld) => meld.type !== 'pair').length
              > resolvedPass.analysis.potentialMelds.filter((meld) => meld.type !== 'pair').length
              || (afterAnalysis.stepsToWin ?? 99) < (resolvedPass.analysis.stepsToWin ?? 99),
          }) + realizedMeldBonus - weakSequencePenalty;
          const delta = this.priorityScorer.scoreChiDelta({ rawDelta, breakdownTotal: breakdown.total });
          return { option, meldType, meaningfulGain, weakSequence: weakSequencePenalty > 0, evaluation: finalEvaluation, listening: finalListening, followUp, rawDelta, delta, stepDelta, huDelta, breakdown };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .sort((left, right) => right.delta - left.delta)[0];

      const shouldRecommendChi = !!bestChi && (
        bestChi.rawDelta > 0
        || (
          !bestChi.weakSequence
          && bestChi.rawDelta > (bestChi.meldType === 'sequence' ? -2 : -8)
          && (
            bestChi.meldType !== 'sequence'
            || bestChi.stepDelta > 0
            || (bestChi.listening.remainingWaitCount || 0) > (resolvedPass.listening.remainingWaitCount || 0)
            || bestChi.option.additionalMelds.length > 0
          )
        )
      );

      if (bestChi && shouldRecommendChi) {
        const evidence = this.deps.buildDecisionEvidence({
          evaluation: bestChi.evaluation,
          listening: bestChi.listening,
          breakdown: bestChi.breakdown,
          tempoGain: bestChi.stepDelta,
          danger: bestChi.followUp.bestDanger,
          flexibility: bestChi.followUp.bestListening ? 0.58 : 0.42,
          extraSignals: [bestChi.evaluation.summary, bestChi.followUp.bestListening ? '吃后还有明确的继续整理方案' : '重点在于把手牌理顺，而不只是多一组'],
        });
        const teaching = this.deps.buildTeachingPayload('chi', bestChi.evaluation.posture, evidence, bestChi.delta >= 10 ? '这步吃牌会明显改善后续节奏。' : '这步吃牌能改善结构，但不是绝对强制。', [bestChi.evaluation.summary, bestChi.followUp.bestListening ? '吃后还有明确的继续整理方案' : '重点在于把手牌理顺，而不只是多一组']);
        recommendations.push({
          action: 'chi',
          meldCards: bestChi.option.selectedCards,
          reasoning: bestChi.followUp.bestListening
            ? `吃这张后，若顺手再调整 ${bestChi.followUp.bestDiscard ? this.deps.formatCardCode(bestChi.followUp.bestDiscard) : '一张'}，能更快做成听牌，而且后续单局分更高`
            : bestChi.stepDelta > 0
              ? '吃这张后会明显提速，离听牌更近，不只是账面上多一组牌'
              : bestChi.huDelta > 0
                ? '吃完后胡息更厚，属于又提速又增分的进攻动作'
                : '吃这张后整体衔接更顺，属于人手常说的顺牌做活',
          winRate: bestChi.evaluation.winRate,
          expectedScore: Math.max(bestChi.evaluation.expectedScore, bestChi.followUp.bestListening?.maxRoundScore || 0),
          riskLevel: bestChi.delta >= 10 ? 'medium' : 'low',
          posture: bestChi.evaluation.posture,
          ...teaching,
          confidence: bestChi.evaluation.confidence,
          priority: this.priorityScorer.scoreChiPriority({
            breakdownTotal: bestChi.breakdown.total,
            delta: bestChi.delta,
          }),
        });
      }
    }

    return recommendations.sort((left, right) => right.priority - left.priority);
  }

  private enrichRecommendationsWithPolicy(
    recommendations: AIPlayRecommendation[],
    gameState: GameState,
    policyMode?: PolicyMode,
  ): AIPlayRecommendation[] {
    if (policyMode !== 'learned') return recommendations;
    const artifact = getActivePolicyArtifact();
    if (!artifact) return recommendations;

    for (const rec of recommendations) {
      rec.baselinePriority = rec.priority;
      const { features, stage, actionFamily } = buildPolicyFeatures(rec, undefined, gameState);
      const scored = scorePolicyFeatures(features, artifact, { actionFamily, stage });
      rec.policyScore = scored.policyScore;
      rec.predictedWinRate = scored.predictedWinRate;
      rec.predictedExpectedScore = scored.predictedExpectedScore;
      rec.predictedScoreVariance = scored.predictedScoreVariance;
      rec.featureContributions = scored.featureContributions;
      rec.policyFeatures = features;
      rec.policyVersion = artifact.policyVersion;
      rec.policySource = 'learned';
      rec.priority = computeRecommendationPriorityByMode('learned', {
        predictedWinRate: scored.predictedWinRate,
        predictedExpectedScore: scored.predictedExpectedScore,
        policyScore: scored.policyScore,
        baselinePriority: rec.baselinePriority,
      });
    }

    const sorted = [...recommendations].sort((a, b) => b.priority - a.priority);
    const best = sorted[0];
    if (best) {
      for (const rec of recommendations) {
        rec.deltaFromBest = {
          winRate: (rec.predictedWinRate ?? 0) - (best.predictedWinRate ?? 0),
          expectedScore: (rec.predictedExpectedScore ?? 0) - (best.predictedExpectedScore ?? 0),
        };
      }
    }
    return recommendations;
  }

  private countStableStructures(analysis: ReturnType<HandAnalyzer['analyze']>): number {
    const weightByType: Record<string, number> = {
      quadruple: 4.8,
      triple: 4.2,
      special_2710: 4,
      mixed_size: 3.6,
      sequence: 3,
      pair: 1,
    };

    return (analysis.potentialMelds || []).reduce((sum, meld) => {
      return sum + (weightByType[meld.type] || 0);
    }, 0);
  }

  private countExactMeldAnchors(card: Card, handCards: Card[]): number {
    const otherCards = handCards.filter((candidate) => candidate.id !== card.id);
    const sameSizeCards = otherCards.filter((candidate) => candidate.size === card.size);
    const countValue = (value: number) => sameSizeCards.filter((candidate) => candidate.value === value).length;

    let anchorCount = 0;

    if (otherCards.filter((candidate) => candidate.value === card.value && candidate.size === card.size).length >= 2) {
      anchorCount += 2;
    }

    if (otherCards.filter((candidate) => candidate.value === card.value && candidate.size !== card.size).length >= 2) {
      anchorCount += 1.5;
    }

    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }

      const otherValues = [start, start + 1, start + 2].filter((value) => value !== card.value);
      if (otherValues.every((value) => countValue(value) > 0)) {
        anchorCount += 1;
      }
    }

    if ([2, 7, 10].includes(card.value)) {
      const required = [2, 7, 10].filter((value) => value !== card.value);
      if (required.every((value) => countValue(value) > 0)) {
        anchorCount += 2.6;
      }
    }

    return anchorCount;
  }

  private getPseudoLooseRank(card: Card, handCards: Card[], profile: CardProfile, preservesTempo: boolean): number {
    if (profile.sameCards === 0 && profile.sequenceLinks === 0 && profile.specialLinks === 0 && profile.mixedSizeCards === 1) {
      return 2;
    }

    if (profile.sameCards > 0 || profile.mixedSizeCards > 1) {
      return 0;
    }

    const otherCards = handCards.filter((candidate) => candidate.id !== card.id && candidate.size === card.size);
    const sameSizeCounts = new Map<number, number>();
    for (const candidate of otherCards) {
      sameSizeCounts.set(candidate.value, (sameSizeCounts.get(candidate.value) || 0) + 1);
    }

    const exactSequenceRoutes: number[][] = [];
    for (let start = card.value - 2; start <= card.value; start++) {
      if (start < 1 || start + 2 > 10) {
        continue;
      }

      const otherValues = [start, start + 1, start + 2].filter((value) => value !== card.value);
      if (otherValues.every((value) => (sameSizeCounts.get(value) || 0) > 0)) {
        exactSequenceRoutes.push(otherValues);
      }
    }

    if (exactSequenceRoutes.length !== 1) {
      return 0;
    }

    const neighborLoad = exactSequenceRoutes[0].reduce((sum, value) => sum + (sameSizeCounts.get(value) || 0), 0);
    const overloadedNeighbor = exactSequenceRoutes[0].some((value) => (sameSizeCounts.get(value) || 0) >= 3);
    const edgeRoute = exactSequenceRoutes[0].includes(card.value - 1) === false || exactSequenceRoutes[0].includes(card.value + 1) === false;
      if ((overloadedNeighbor || neighborLoad >= 5) && (preservesTempo || edgeRoute)) {
      return edgeRoute ? 2 : 1;
    }

    return 0;
  }

  private resolvePassState(
    gameState: GameState,
    playerIndex: number,
    handCards: Card[],
    melds: Meld[],
    targetCard: Card | undefined,
    baseEvaluation: ProjectedStateInfo,
    baseListening: ListeningInfo,
    baseAnalysis: ReturnType<HandAnalyzer['analyze']>,
  ): ResolvedResponseState {
    return {
      evaluation: baseEvaluation,
      listening: baseListening,
      analysis: baseAnalysis,
    };
  }

  private evaluateBestPostResponseDiscard(handCards: Card[], melds: Meld[], gameState: GameState, playerIndex: number): PostResponseDiscardEvaluation {
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestDiscard: Card | undefined;
    let bestListening: ListeningInfo | undefined;
    let bestEvaluation: ProjectedStateInfo | undefined;
    let bestAnalysis: ReturnType<HandAnalyzer['analyze']> | undefined;
    let bestDanger: DangerInfo | undefined;

    for (const candidate of handCards) {
      const remainingCards = handCards.filter((card) => card.id !== candidate.id);
      const listening = this.deps.evaluateDiscardListening(gameState, remainingCards, melds);
      const projection = this.deps.evaluateProjectedState(remainingCards, melds, gameState.discardPile?.cards || [], gameState);
      const analysis = this.deps.handAnalyzer.analyze(remainingCards, melds);
      const keepValue = this.deps.calculateKeepValue(candidate, handCards, melds, gameState);
      const danger = this.deps.assessDiscardDanger(candidate, gameState, playerIndex);
      const score = this.priorityScorer.scorePostResponseDiscard({
        compositeScore: projection.compositeScore,
        keepValue,
        waitCount: listening.waitCards.length,
        remainingWaitCount: listening.remainingWaitCount,
        maxRoundScore: listening.maxRoundScore,
        avgHuPoints: listening.avgHuPoints,
        dangerScore: danger.score,
      });
      if (score > bestScore) {
        bestScore = score;
        bestDiscard = candidate;
        bestListening = listening.waitCards.length > 0 ? listening : undefined;
        bestEvaluation = projection;
        bestAnalysis = analysis;
        bestDanger = danger;
      }
    }

    return {
      bestScore: Number.isFinite(bestScore) ? bestScore : 0,
      bestDiscard,
      bestListening,
      bestEvaluation,
      bestAnalysis,
      bestDanger,
    };
  }
}
