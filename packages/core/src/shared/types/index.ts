/**
 * 共享类型统一导出
 */

export * from './card';
export * from './game';
export * from './ocr';
export {
  type AIAnalysis,
  type AIPlayRecommendation,
  type AIRankedAction,
  type AIDecisionTrace,
  type AIDecisionOptionTrace,
  type AITutorTrace,
  type AITutorDimensionTrace,
  type AIDecisionEvidence,
  type AITeachingTag,
  type ActionScoreBreakdown,
  type AIConfig,
  type WinRateCalculation,
  type StrategyEvaluation,
  type StrategyFactor,
  type HandStrengthEvaluation,
  type OpponentHandProbability,
  type MonteCarloConfig,
  type HeuristicConfig,
  type OpponentInference,
  type AIPolicySource,
  type PolicyFeatureContribution,
  type PolicyArtifact,
  type RolloutEvaluationCandidate,
  type RolloutEvaluationResult,
  type SelfPlayDatasetSample,
  type PolicyEvaluationSample,
  type PolicyEvaluationReport,
  type ReplayFeedbackRewardMetrics,
  type ReplayFeedbackRewardDelta,
  type ReplayFeedbackRewardReport,
  type PolicyEvaluationGateThreshold,
  type PolicyEvaluationGate,
  HandStrength,
  DEFAULT_AI_CONFIG,
} from './ai';
export * from './simulation';
