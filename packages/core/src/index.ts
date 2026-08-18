/**
 * @daer/core - 泸州大贰核心引擎
 *
 * 包含游戏规则引擎、AI 分析和共享类型定义
 * 纯 TypeScript 实现，无平台依赖
 */

// === 共享类型 ===
export type {
  Card,
  CardSize,
  CardColor,
  CardValue,
  CardRank,
  CardPosition,
} from './shared/types/card';

export { CardFactory, CardComparator } from './shared/types/card';

export type {
  GameState,
  GamePhase,
  PlayerHand,
  Meld,
  MingTang,
  EnabledMingTangMap,
  AvailableAction,
  ChiOption,
  CompareCardResult,
  GameConfig,
  RuleProfile,
  OpeningFacts,
  OpeningPhase,
  DiscardEvent,
  DiscardPile,
  PlayRecommendation,
  PassedPlay,
} from './shared/types/game';

export { DEFAULT_GAME_CONFIG, DEFAULT_RULE_PROFILE, DEFAULT_ENABLED_MINGTANG_TYPES } from './shared/types/game';
export { MeldType, MingTangType } from './shared/types/game';

export type {
  AIAnalysis,
  AIPlayRecommendation,
  AIRankedAction,
  AIDecisionEvidence,
  AITeachingTag,
  AITutorTrace,
  AITutorDimensionTrace,
  ActionScoreBreakdown,
  AIDecisionTrace,
  AIDecisionOptionTrace,
  AIConfig,
  WinRateCalculation,
  StrategyEvaluation,
  StrategyFactor,
  HandStrengthEvaluation,
  OpponentHandProbability,
  MonteCarloConfig,
  HeuristicConfig,
  OpponentInference as OpponentInferenceType,
  AIPolicySource,
  PolicyFeatureContribution,
  PolicyArtifact,
  RolloutEvaluationCandidate,
  RolloutEvaluationResult,
  SelfPlayDatasetSample,
  PolicyEvaluationSample,
  PolicyEvaluationReport,
  ReplayFeedbackRewardMetrics,
  ReplayFeedbackRewardDelta,
  ReplayFeedbackRewardReport,
  PolicyEvaluationGate,
  PolicyEvaluationGateThreshold,
} from './shared/types/ai';

export { HandStrength, DEFAULT_AI_CONFIG } from './shared/types/ai';

export type {
  PlayerAction,
  PlayerActionType,
  DealResult,
  SimulationResult,
  SimulationConfig,
  GameLog,
  GameStats,
} from './shared/types/simulation';

export type {
  ScreenRegion,
  RecognizedCard,
  OCRResult,
  OCRConfig,
  ScreenCaptureConfig,
  GameLayout,
  RegionType,
  RegionConfig,
  CardTemplate,
} from './shared/types/ocr';


// === 共享常量 ===
export {
  DEAL_CONFIG,
  isRedCard,
} from './shared/constants/cards';

export {
  isMandatoryMeld,
  isHeavenlyWin,
  isSequential,
  isSpecial2710,
  hasEightBlocks,
} from './shared/constants/melds';

export {
  getHuPoints,
  getSpecialSequenceHu,
  checkWinCondition,
  MING_TANG_FAN_TABLE,
  BASE_FAN,
  BASE_SCORE_TABLE,
  getBaseScoreByHu,
} from './shared/constants/scoring';

// === 游戏引擎 ===
export {
  DeckManager,
  deckManager,
  MeldDetector,
  RulesValidator,
  ScoreCalculator,
  HandAnalyzer,
  TurnManager,
  ActionHandlers,
  GameManager,
  gameManager,
  GameSimulator,
  gameSimulator,
} from './game-engine';

export type {
  MeldDetectionResult,
  ScoreResult,
  HandAnalysis,
  HandStats,
} from './game-engine/types';

// === AI 服务 ===
export {
  OpponentInference,
  WinRateCalculator,
  StrategyEvaluator,
  AIAnalyzer,
  AIPlayerAgent,
  AIExplanationEngine,
  ActionPriorityScorer,
  DEFAULT_POLICY_ARTIFACT,
  computePolicyObjective,
  computePolicyPriority,
  getActivePolicyArtifact,
  loadPolicyArtifact,
  resetPolicyArtifact,
  scorePolicyFeatures,
  compareLearnedPolicyCandidates,
  computeLearnedPolicyObjective,
  computeRecommendationPriorityByMode,
  buildReplayFeedbackPreferenceSamples,
  evaluatePolicyFeedbackReward,
} from './ai';


// === Worker Runtime ===
export * from './worker';
