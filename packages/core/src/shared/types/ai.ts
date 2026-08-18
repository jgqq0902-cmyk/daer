/**
 * AI 分析相关类型定义
 * 对手推断、胜率计算、策略评估
 */

import { Card, Meld, PlayRecommendation as GamePlayRecommendation, AvailableAction } from './game';
import { PlayerActionType } from './simulation';

export type AIPolicySource = 'heuristic' | 'learned' | 'fallback';

export interface PolicyFeatureContribution {
  key: string;
  label: string;
  value: number;
  weight: number;
  contribution: number;
}

export type PolicyActionFamily = 'discard' | 'response';
export type PolicyStage = 'opening' | 'midgame' | 'endgame';

export interface PolicyHeadStageAdjustment {
  sampleCount?: number;
  scoreWeightDelta?: Record<string, number>;
  objectiveBiasDelta?: number;
  predictionWeightDelta?: {
    winRate?: Record<string, number>;
    expectedScore?: Record<string, number>;
  };
  predictionBiasDelta?: {
    winRate?: number;
    expectedScore?: number;
  };
}

export interface PolicyHeadModel {
  sampleCount?: number;
  activationMinSampleCount?: number;
  stageActivationMinSampleCount?: number;
  scoreWeights?: Record<string, number>;
  objectiveBias?: number;
  predictionWeights?: {
    winRate: Record<string, number>;
    expectedScore: Record<string, number>;
  };
  predictionBias?: {
    winRate: number;
    expectedScore: number;
  };
  predictionTargetStats?: {
    winRate: { mean: number; std: number };
    expectedScore: { mean: number; std: number };
  };
  stageAdjustments?: Partial<Record<PolicyStage, PolicyHeadStageAdjustment>>;
}

export interface PolicyArtifact {
  policyVersion: string;
  featureSchemaVersion: string;
  generatedAt: string;
  policyName?: string;
  objective: 'dual_balanced';
  scoreWeights: Record<string, number>;
  normalizationStats?: Record<string, { mean: number; std: number }>;
  objectiveBias?: number;
  predictionWeights?: {
    winRate: Record<string, number>;
    expectedScore: Record<string, number>;
  };
  predictionBias?: {
    winRate: number;
    expectedScore: number;
  };
  predictionTargetStats?: {
    winRate: { mean: number; std: number };
    expectedScore: { mean: number; std: number };
  };
  familyHeads?: Partial<Record<PolicyActionFamily, PolicyHeadModel>>;
  trainingMeta?: {
    selfPlayGames?: number;
    sampledDecisionCount?: number;
    rolloutCountPerAction?: number;
    seed?: number;
    iteration?: number;
    feedbackSampleCount?: number;
    feedbackEvaluationSampleCount?: number;
    feedbackRewardScore?: number;
    feedbackRewardDelta?: number;
    learningRate?: number;
    l2?: number;
    epochs?: number;
    validationSampleCount?: number;
    retainedSampleCount?: number;
    filteredSampleCount?: number;
    lowSignalSampleCount?: number;
    lowSignalRatio?: number;
    pairwiseRowCount?: number;
    skippedFeatureCoverageSampleCount?: number;
    hardExampleSampleCount?: number;
    maxSampleResponseToDiscardRatio?: number;
    maxResponseToDiscardRatio?: number;
    discardSampleWeight?: number;
    discardStageMinShare?: number;
    discardOpeningWeight?: number;
    discardMidgameWeight?: number;
    openingHeuristicDisagreementWeight?: number;
    midgameHeuristicDisagreementWeight?: number;
    hardExampleWeight?: number;
    monotonicConstraintVersion?: string;
  };
  baselineComparison?: {
    baselinePolicyVersion?: string;
    winRateDelta?: number;
    expectedScoreDelta?: number;
  };
}

export interface RolloutEvaluationCandidate {
  action: PlayerActionType;
  cards?: string[];
  predictedWinRate: number;
  predictedExpectedScore: number;
  predictedScoreVariance: number;
  futureMingTangPotential: number;
  rolloutCount: number;
}

export interface RolloutEvaluationResult {
  sampleId: string;
  policyVersion: string;
  objectiveScore: number;
  candidates: RolloutEvaluationCandidate[];
}

export interface SelfPlayDatasetSample {
  sampleId: string;
  stateSignature: string;
  playerId: string;
  turnCount: number;
  phase: string;
  legalDiscards: string[];
  remainingDeck?: Card[];
  heuristicTopOption?: string;
  policyFeaturesByAction?: Record<string, Record<string, number>>;
  oracle?: RolloutEvaluationResult;
}

export interface PolicyEvaluationSample extends SelfPlayDatasetSample {
  playerIndex: number;
  remainingDeckCards: number;
}

export interface PolicyEvaluationReport {
  policyVersion: string;
  baselinePolicyVersion?: string;
  benchmarkVersion?: string;
  totalSamples: number;
  winRateDelta: number;
  expectedScoreDelta: number;
  learnedOracleMatchRate?: number;
  heuristicOracleMatchRate?: number;
  benchmarkSummary: Array<{
    name: string;
    sampleCount: number;
    learnedTop: string;
    heuristicTop?: string;
    oracleTop?: string;
    winRateDelta: number;
    expectedScoreDelta: number;
    learnedOracleMatchRate: number;
    heuristicOracleMatchRate: number;
  }>;
  actionFamilySummary?: Array<{
    name: 'discard' | 'response';
    sampleCount: number;
    winRateDelta: number;
    expectedScoreDelta: number;
    learnedOracleMatchRate: number;
    heuristicOracleMatchRate: number;
  }>;
  feedbackReward?: ReplayFeedbackRewardReport;
  gate?: {
    passed: boolean;
    minSamples: number;
    minWinRateDelta: number;
    minExpectedScoreDelta: number;
    minLearnedOracleMatchRate?: number;
    minOracleMatchRateDelta?: number;
    minCategoryWinRateDelta?: Record<string, number>;
    requiredBenchmarkVersion?: string;
    reasons: string[];
  };
}

export interface ReplayFeedbackRewardMetrics {
  policyVersion: string;
  sampleCount: number;
  topK: number;
  top1MatchRate: number;
  topKMatchRate: number;
  meanPreferredRank: number;
  meanReciprocalRank: number;
  meanPreferredObjectiveGap: number;
  meanOptionCount: number;
  preferredFeatureCoverage: number;
  rewardScore: number;
}

export interface ReplayFeedbackRewardDelta {
  rewardScoreDelta: number;
  top1MatchRateDelta: number;
  topKMatchRateDelta: number;
  meanReciprocalRankDelta: number;
  meanPreferredRankImprovement: number;
  meanPreferredObjectiveGapImprovement: number;
}

export interface ReplayFeedbackRewardReport {
  sampleCount: number;
  skippedByReason: Record<string, number>;
  baseline: ReplayFeedbackRewardMetrics;
  learned: ReplayFeedbackRewardMetrics;
  delta: ReplayFeedbackRewardDelta;
}

export interface PolicyEvaluationGateThreshold {
  minSamples?: number;
  minWinRateDelta?: number;
  minExpectedScoreDelta?: number;
  minLearnedOracleMatchRate?: number;
  minOracleMatchRateDelta?: number;
  minCategoryWinRateDelta?: Record<string, number>;
  minCategoryOracleMatchRateDelta?: Record<string, number>;
  minActionFamilyWinRateDelta?: Record<string, number>;
  minActionFamilyOracleMatchRateDelta?: Record<string, number>;
  requiredBenchmarkVersion?: string;
}

export interface PolicyEvaluationGate {
  passed: boolean;
  minSamples: number;
  minWinRateDelta: number;
  minExpectedScoreDelta: number;
  minLearnedOracleMatchRate?: number;
  minOracleMatchRateDelta?: number;
  minCategoryWinRateDelta?: Record<string, number>;
  minCategoryOracleMatchRateDelta?: Record<string, number>;
  minActionFamilyWinRateDelta?: Record<string, number>;
  minActionFamilyOracleMatchRateDelta?: Record<string, number>;
  requiredBenchmarkVersion?: string;
  reasons: string[];
}

/**
 * 对手推断结果
 */
export interface OpponentInference {
  /** 玩家ID */
  playerId: string;
  /** 可能持有的牌 */
  possibleCards: Card[];
  /** 可能组成的牌型 */
  possibleMelds: Meld[];
  /** 推断置信度 (0-1) */
  confidence: number;
  /** 推理依据 */
  reasoning: string;
  /** 关键发现的牌 */
  keyCards: Card[];
}

/**
 * 胜率计算结果
 */
export interface WinRateCalculation {
  /** 当前胜率 */
  currentWinRate: number;
  /** 每种可能摸牌的胜率 */
  potentialWinRates: Map<string, number>;
  /** 平均胜率 */
  averageWinRate: number;
  /** 计算方法 */
  calculationMethod: 'monte_carlo' | 'heuristic' | 'exact';
  /** 模拟次数 */
  simulationCount?: number;
}

/**
 * 策略评估因子
 */
export interface StrategyFactor {
  /** 因子名称 */
  name: string;
  /** 影响程度 (0-100) */
  impact?: number;
  /** 因子数值 (0-1) */
  value?: number;
  /** 描述 */
  description: string;
  /** 权重 */
  weight: number;
}

/**
 * 策略评估结果
 */
export interface StrategyEvaluation {
  /** 手牌强度 (HandStrength 枚举值或0-100数字) */
  handStrength: number | HandStrength;
  /** 位置优势 (0-100) */
  positionalAdvantage?: number;
  /** 位置得分 (0-100) */
  position?: number;
  /** 改善潜力 (0-100) */
  improvementPotential?: number;
  /** 综合得分 (0-100) */
  overallScore: number;
  /** 关键因子 */
  keyFactors: StrategyFactor[];
  /** 风险评估 */
  riskAssessment?: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
  };
  /** 风险等级 (0-100) */
  riskLevel?: number;
  /** 策略建议 */
  suggestions?: string[];
}

/**
 * AI 分析完整结果
 */
export interface AIAnalysis {
  /** 当前游戏状态快照 */
  gameStateSnapshot?: string;
  /** 对手推断结果 */
  opponentInferences: OpponentInference[];
  /** 胜率计算 */
  winRateCalculation?: WinRateCalculation;
  /** 胜率 (简化版) */
  winRate?: WinRateCalculation;
  /** 策略评估 */
  strategyEvaluation?: StrategyEvaluation;
  /** 策略评估 (简化版) */
  strategy?: StrategyEvaluation;
  /** 出牌建议 */
  recommendations: AIPlayRecommendation[];
  /** 按统一评分排序后的合法动作 */
  rankedActions?: AIRankedAction[];
  /** 手牌强度 */
  handStrength?: number | HandStrength;
  /** 推理说明 */
  reasoning?: string;
  /** 分析耗时 (ms) */
  analysisTime?: number;
  /** 时间戳 */
  timestamp?: number;
}

/**
 * 出牌建议 (扩展)
 */
export interface AIPlayRecommendation {
  /** 操作类型 */
  action: PlayerActionType;
  /** 涉及的牌 */
  card?: Card;
  /** 组合类型 */
  meldType?: string;
  /** 组合涉及的牌 */
  meldCards?: Card[];
  /** 理由 */
  reasoning: string;
  /** 胜率 */
  winRate: number;
  /** 预期得分 */
  expectedScore: number;
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | number;
  /** 当前策略姿态 */
  posture?: 'attack' | 'balance' | 'defense';
  /** 教学摘要 */
  summary?: string;
  /** 关键学习点 */
  keyPoints?: string[];
  /** 当前建议置信度 */
  confidence?: number;
  /** 结构化决策证据 */
  evidence?: AIDecisionEvidence;
  /** 当前使用的策略版本 */
  policyVersion?: string;
  /** 当前排序来源 */
  policySource?: AIPolicySource;
  /** 策略预测胜率 */
  predictedWinRate?: number;
  /** 策略预测期望得分 */
  predictedExpectedScore?: number;
  /** 策略预测分数波动 */
  predictedScoreVariance?: number;
  /** 相对最优解的损失 */
  deltaFromBest?: {
    winRate: number;
    expectedScore: number;
  };
  /** 最大特征贡献项 */
  featureContributions?: PolicyFeatureContribution[];
  /** 供离线训练/评估使用的特征快照 */
  policyFeatures?: Record<string, number>;
  /** 学习策略评分（用于 learned 排序同分判定） */
  policyScore?: number;
  /** 旧 heuristic 评分，用于基线对照 */
  baselinePriority?: number;
  /** 优先级 (越高越推荐) */
  priority: number;
  /** 替代方案 */
  alternatives?: AIPlayRecommendation[];
}

export type AITeachingTag =
  | 'speed'
  | 'ukeire'
  | 'score'
  | 'risk'
  | 'shape'
  | 'timing'
  | 'flexibility';

export interface AIDecisionEvidence {
  /** 提速强度 (0-1) */
  speedScore?: number;
  /** 进张总量 */
  ukeireCount?: number;
  /** 胡息/单局分潜力 */
  scorePotential?: number;
  /** 风险分值 (0-100) */
  dangerScore?: number;
  /** 听口数量 */
  waitCount?: number;
  /** 最高胡息 */
  maxHuPoints?: number;
  /** 最高单局分 */
  maxRoundScore?: number;
  /** 速度改善量 */
  tempoGain?: number;
  /** 路线弹性 */
  flexibility?: number;
  /** 教学标签 */
  tags?: AITeachingTag[];
  /** 证据短句 */
  signals?: string[];
  /** EV 四轴分解 */
  breakdown?: ActionScoreBreakdown;
}

export interface ActionScoreBreakdown {
  /** 向听改善奖励 */
  shantenReward: number;
  /** 进张面奖励 */
  ukeireReward: number;
  /** 胡息/分档奖励 */
  scoreBonus: number;
  /** 危险惩罚 */
  dangerPenalty: number;
  /** 最终 EV 分 */
  total: number;
  /** 是否触发紧急防守阀门 */
  emergencyDefense?: boolean;
}

export interface AIRankedAction {
  /** 对应的合法动作 */
  availableAction: AvailableAction;
  /** 统一评分 */
  score: number;
  /** 命中的推荐结果 */
  recommendation?: AIPlayRecommendation;
  /** 人类可读摘要 */
  summary: string;
  /** 结构化决策证据 */
  evidence?: AIDecisionEvidence;
}

export interface AIDecisionOptionTrace {
  action: PlayerActionType;
  cards?: string[];
  reasoning?: string;
  winRate?: number;
  expectedScore?: number;
  priority?: number;
  policyVersion?: string;
  policySource?: AIPolicySource;
  predictedWinRate?: number;
  predictedExpectedScore?: number;
  predictedScoreVariance?: number;
  deltaFromBest?: {
    winRate: number;
    expectedScore: number;
  };
  featureContributions?: PolicyFeatureContribution[];
  baselinePriority?: number;
  isMandatory?: boolean;
  isAvailable?: boolean;
  isChosen?: boolean;
}

export interface AITutorDimensionTrace {
  key: 'efficiency' | 'scoring' | 'defense';
  title: string;
  diagnosis: string;
  bullets: string[];
}

export interface AITutorTrace {
  headline: string;
  posture?: 'attack' | 'balance' | 'defense';
  dimensions: AITutorDimensionTrace[];
}

export interface AIDecisionTrace {
  playerId: string;
  phase: string;
  policyVersion?: string;
  policySource?: AIPolicySource;
  source:
    | 'explicit_hu'
    | 'mandatory'
    | 'analysis_top'
    | 'best_legal_discard'
    | 'meld_priority'
    | 'default_available'
    | 'priority_fallback'
    | 'no_action_pass';
  chosenAction: PlayerActionType;
  chosenCards?: string[];
  availableActions: AIDecisionOptionTrace[];
  topOptions: AIDecisionOptionTrace[];
  legal: {
    withinAvailableActions: boolean;
    explicitHuAvailable: boolean;
    explicitHuTaken: boolean;
    mandatoryAction?: PlayerActionType;
    mandatoryRespected: boolean;
    normalized?: boolean;
    fallbackApplied?: boolean;
    fallbackReason?: string;
  };
  reasoning?: string;
  summary: string;
  tutor?: AITutorTrace;
}

// 导出游戏中的 PlayRecommendation 作为别名
export type PlayRecommendation = GamePlayRecommendation;

/**
 * Monte Carlo 模拟配置
 */
export interface MonteCarloConfig {
  /** 模拟次数 */
  simulationCount: number;
  /** 是否使用早期停止 */
  useEarlyStopping: boolean;
  /** 早期停止的标准差阈值 */
  earlyStoppingThreshold: number;
  /** 随机种子 */
  seed?: number;
}

/**
 * 启发式评估配置
 */
export interface HeuristicConfig {
  /** 手牌强度权重 */
  handStrengthWeight: number;
  /** 位置优势权重 */
  positionalWeight: number;
  /** 风险权重 */
  riskWeight: number;
  /** 潜力权重 */
  potentialWeight: number;
}

/**
 * AI 配置
 */
export interface AIConfig {
  /** Monte Carlo 配置 */
  monteCarlo: MonteCarloConfig;
  /** 启发式配置 */
  heuristic: HeuristicConfig;
  /** 对手建模深度 */
  opponentModelingDepth: number;
  /** 是否启用并行处理 */
  enableParallelProcessing: boolean;
  /** 最大分析时间 (ms) */
  maxAnalysisTime: number;
}

/**
 * 默认 AI 配置
 */
export const DEFAULT_AI_CONFIG: AIConfig = {
  monteCarlo: {
    simulationCount: 1000,
    useEarlyStopping: true,
    earlyStoppingThreshold: 0.01
  },
  heuristic: {
    handStrengthWeight: 0.4,
    positionalWeight: 0.2,
    riskWeight: 0.2,
    potentialWeight: 0.2
  },
  opponentModelingDepth: 2,
  enableParallelProcessing: true,
  maxAnalysisTime: 1000
};

/**
 * 牌力评估等级
 */
export enum HandStrength {
  /** 极弱 */
  VERY_WEAK = 'very_weak',
  /** 弱 */
  WEAK = 'weak',
  /** 中等偏弱 */
  BELOW_AVERAGE = 'below_average',
  /** 中等 */
  AVERAGE = 'average',
  /** 中等 (别名) */
  MEDIUM = 'average',
  /** 中等偏强 */
  ABOVE_AVERAGE = 'above_average',
  /** 强 */
  STRONG = 'strong',
  /** 极强 */
  VERY_STRONG = 'very_strong'
}

/**
 * 牌力评估结果
 */
export interface HandStrengthEvaluation {
  /** 等级 */
  level: HandStrength;
  /** 分数 (0-100) */
  score: number;
  /** 主要牌型 */
  mainMelds: Meld[];
  /** 潜在牌型 */
  potentialMelds: Meld[];
  /** 缺失的关键牌 */
  missingCards: Card[];
  /** 评估说明 */
  description: string;
}

/**
 * 对手手牌概率
 */
export interface OpponentHandProbability {
  /** 玩家ID */
  playerId: string;
  /** 每张牌存在的概率 */
  cardProbabilities: Map<string, number>;
  /** 最可能的牌型组合 */
  likelyMelds: { meld: Meld; probability: number }[];
  /** 听牌概率 */
  tingProbability: number;
}
