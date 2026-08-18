/**
 * AI 服务导出
 */

export { OpponentInference } from './opponent-inference';
export { WinRateCalculator } from './win-rate-calculator';
export { StrategyEvaluator } from './strategy-evaluator';
export { AIAnalyzer } from './ai-analyzer';
export { AIPlayerAgent } from './ai-player-agent';
export { AIExplanationEngine } from './explanation-engine';
export { ActionPriorityScorer } from './action-priority-scorer';
export {
  DEFAULT_POLICY_ARTIFACT,
  computePolicyObjective,
  computePolicyPriority,
  getActivePolicyArtifact,
  loadPolicyArtifact,
  resetPolicyArtifact,
  scorePolicyFeatures,
} from './policy-artifact';
export {
  compareLearnedPolicyCandidates,
  computeLearnedPolicyObjective,
  computeRecommendationPriorityByMode,
} from './policy-ranking';
export {
  buildReplayFeedbackPreferenceSamples,
  evaluatePolicyFeedbackReward,
} from './replay-feedback';
export type { AIPlayRecommendation, AIRankedAction, AIDecisionEvidence, AITeachingTag, ActionScoreBreakdown, AITutorTrace, AITutorDimensionTrace } from './types';
export type { SimulationResult, CardProbability, SimulationState } from './types';
export type {
  AIDecisionTrace,
  AIDecisionOptionTrace,
  PolicyArtifact,
  PolicyFeatureContribution,
  PolicyEvaluationGate,
  PolicyEvaluationGateThreshold,
  PolicyEvaluationSample,
  AIPolicySource,
} from '../shared/types/ai';
