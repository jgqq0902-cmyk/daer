import type { AIPlayRecommendation, AvailableAction, GameState } from '../shared/types';
import type { PolicyActionFamily, PolicyStage } from '../shared/types/ai';

const STRUCTURAL_FEATURE_KEYS = [
  'stable_structure_loss',
  'flexibility_score',
  'viable_pair_templates',
  'viable_mixed_templates',
  'viable_sequence_templates',
  'viable_2710_templates',
  'blocked_template_count',
  'free_support_count',
  'total_live_support',
  'exact_meld_anchor_strength',
  'shape_anchor_strength',
  'tempo_gain',
  'score_cross_10_flag',
  'score_cross_20_flag',
  'response_action_chi',
  'response_action_peng',
  'response_action_zhao',
  'response_action_pass',
  'post_response_discard_risk',
  'bipai_extra_meld_count',
] as const;

export interface PolicyFeatureBuildResult {
  features: Record<string, number>;
  stage: PolicyStage;
  actionFamily: PolicyActionFamily;
  hasStructuralCoverage: boolean;
}

function clampNonNegative(value: number | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function extractActionType(
  recommendation?: AIPlayRecommendation,
  fallbackAction?: AvailableAction,
): string {
  if (typeof recommendation?.action === 'string' && recommendation.action.length > 0) {
    return recommendation.action;
  }
  if (typeof fallbackAction?.type === 'string' && fallbackAction.type.length > 0) {
    return fallbackAction.type;
  }
  return 'discard';
}

export function inferPolicyStage(
  turnCount: number,
  remainingDeckCards: number,
): PolicyStage {
  if (turnCount <= 3 && remainingDeckCards > 14) {
    return 'opening';
  }
  if (remainingDeckCards <= 7 || turnCount >= 16) {
    return 'endgame';
  }
  return 'midgame';
}

export function inferPolicyActionFamily(
  actionType: string,
  phase?: string,
): PolicyActionFamily {
  if (phase === 'response_collecting') {
    return 'response';
  }
  if (
    actionType === 'chi'
    || actionType === 'peng'
    || actionType === 'zhao'
    || actionType === 'pass'
    || actionType === 'hu'
  ) {
    return 'response';
  }
  return 'discard';
}

export function hasCriticalPolicyFeatureCoverage(
  features: Record<string, number>,
  family: PolicyActionFamily,
): boolean {
  if (!features || Object.keys(features).length === 0) {
    return false;
  }

  if (family === 'response') {
    const responseSignal = clampNonNegative(features.response_value)
      + clampNonNegative(features.live_response_sequence_count)
      + clampNonNegative(features.live_response_2710_count)
      + clampNonNegative(features.total_live_support)
      + clampNonNegative(features.flexibility_score);
    return responseSignal > 0;
  }

  const structuralCount = STRUCTURAL_FEATURE_KEYS
    .filter((key) => clampNonNegative(features[key]) > 0)
    .length;
  const baselineSignal = clampNonNegative(features.wait_count)
    + clampNonNegative(features.remaining_wait_count)
    + clampNonNegative(features.speed_score);
  return structuralCount >= 2 || (structuralCount >= 1 && baselineSignal > 0);
}

function deriveResponseValue(actionType: string, tempoGain: number): number {
  if (actionType === 'chi') {
    return 1.6 + Math.max(0, tempoGain);
  }
  if (actionType === 'peng') {
    return 1.2 + Math.max(0, tempoGain * 0.5);
  }
  if (actionType === 'zhao') {
    return 1.8 + Math.max(0, tempoGain * 0.5);
  }
  if (actionType === 'pass') {
    return Math.max(0, tempoGain * 0.8);
  }
  if (actionType === 'hu') {
    return 2.5;
  }
  return 0;
}

function hasSignal(
  recommendation: AIPlayRecommendation | undefined,
  pattern: RegExp,
): boolean {
  const texts = [
    recommendation?.reasoning,
    recommendation?.summary,
    ...(recommendation?.keyPoints || []),
    ...(recommendation?.evidence?.signals || []),
  ];
  return texts.some((text) => !!text && pattern.test(text));
}

export function buildPolicyFeatures(
  recommendation?: AIPlayRecommendation,
  fallbackAction?: AvailableAction,
  state?: Pick<GameState, 'turnCount' | 'remainingDeckCards' | 'phase'>,
): PolicyFeatureBuildResult {
  const actionType = extractActionType(recommendation, fallbackAction);
  const turnCount = clampNonNegative(state?.turnCount, 0);
  const remainingDeckCards = clampNonNegative(state?.remainingDeckCards, 0);
  const stage = inferPolicyStage(turnCount, remainingDeckCards);
  const actionFamily = inferPolicyActionFamily(actionType, state?.phase);

  if (recommendation?.policyFeatures) {
    return {
      features: recommendation.policyFeatures,
      stage,
      actionFamily,
      hasStructuralCoverage: hasCriticalPolicyFeatureCoverage(
        recommendation.policyFeatures,
        actionFamily,
      ),
    };
  }

  const evidence = recommendation?.evidence;
  const breakdown = evidence?.breakdown;
  const tempoGain = clampNonNegative(evidence?.tempoGain, 0);
  const rawTempoGain = typeof evidence?.tempoGain === 'number' && Number.isFinite(evidence.tempoGain)
    ? evidence.tempoGain
    : 0;
  const heuristicWinRate = clampNonNegative(recommendation?.winRate, 0);
  const waitCount = clampNonNegative(evidence?.waitCount, 0);
  const remainingWaitCount = clampNonNegative(evidence?.ukeireCount, 0);
  const flexibility = clampNonNegative(evidence?.flexibility, 0.35);
  const maxRoundScore = clampNonNegative(evidence?.maxRoundScore, recommendation?.expectedScore ?? 0);
  const deadTileFlag = recommendation?.keyPoints?.some((item) => /死张|孤张|伪活/.test(item)) ? 1 : 0;
  const isolatedFlag = recommendation?.keyPoints?.some((item) => /孤张/.test(item)) ? 1 : 0;
  const nearlyDeadFlag = recommendation?.keyPoints?.some((item) => /拖手|活张不多/.test(item)) ? 1 : 0;
  const deckPressure = Math.max(0, 1 - Math.min(remainingDeckCards, 20) / 20);
  const structuralSeed = waitCount + remainingWaitCount * 0.3 + flexibility * 0.4;
  const responseValue = deriveResponseValue(actionType, tempoGain);
  const sequenceSignal = hasSignal(recommendation, /顺子|联|连续|衔接|路线|结构/);
  const special2710Signal = hasSignal(recommendation, /二七十|2710|贰柒拾|红牌|红/);
  const mixedSignal = hasSignal(recommendation, /大小|叉|混搭|搭子/);
  const bipaiExtraMeldCount = Math.max(
    0,
    Math.round((recommendation?.meldCards?.length || 0) / 3) - 1,
  );
  const liveResponseSequenceCount = actionFamily === 'response' && actionType === 'chi' && sequenceSignal ? 1 : 0;
  const liveResponse2710Count = actionFamily === 'response' && special2710Signal ? 1 : 0;
  const deadResponseSequenceCount = deadTileFlag > 0 || (actionFamily === 'response' && actionType === 'pass' && sequenceSignal) ? 1 : 0;
  const deadResponse2710Count = nearlyDeadFlag > 0 || (actionFamily === 'response' && actionType === 'pass' && special2710Signal) ? 1 : 0;
  const stableResponseBlockCount = deadTileFlag > 0 && responseValue <= 0 ? 1 : 0;
  const viablePairTemplates = Math.max(0, Math.round(structuralSeed * 0.2 + (actionType === 'peng' ? 1 : 0)));
  const viableMixedTemplates = Math.max(0, Math.round(structuralSeed * 0.12 + (mixedSignal ? 1 : 0)));
  const viableSequenceTemplates = Math.max(0, Math.round(structuralSeed * 0.18 + (sequenceSignal ? 1 : 0)));
  const viable2710Templates = Math.max(0, Math.round(structuralSeed * 0.08 + (special2710Signal ? 1 : 0)));
  const blockedTemplateCount = Math.max(0, deadTileFlag + nearlyDeadFlag);
  const freeSupportCount = Math.max(0, flexibility * 0.2 + responseValue * 0.1);
  const totalLiveSupport = Math.max(
    0,
    freeSupportCount + liveResponseSequenceCount + liveResponse2710Count,
  );
  const exactMeldAnchorStrength = Math.max(0, maxRoundScore * 0.05 + remainingWaitCount * 0.2);
  const shapeAnchorStrength = Math.max(0, flexibility + waitCount * 0.5);

  const features: Record<string, number> = {
    heuristic_win_rate: heuristicWinRate,
    heuristic_expected_score: clampNonNegative(recommendation?.expectedScore, maxRoundScore),
    heuristic_priority: clampNonNegative(
      recommendation?.baselinePriority ?? recommendation?.priority,
      0,
    ),
    wait_count: waitCount,
    remaining_wait_count: remainingWaitCount,
    max_round_score: maxRoundScore,
    danger_score: clampNonNegative(evidence?.dangerScore, 0),
    speed_score: clampNonNegative(evidence?.speedScore, heuristicWinRate),
    ukeire_score: clampNonNegative(breakdown?.ukeireReward, 0),
    score_bonus: clampNonNegative(breakdown?.scoreBonus, 0),
    tempo_gain: rawTempoGain,
    tempo_loss: Math.max(0, -rawTempoGain),
    ukeire_delta_score: clampNonNegative(breakdown?.ukeireReward, 0),
    score_cross_10_flag: (breakdown?.scoreBonus || 0) >= 50 || maxRoundScore >= 10 ? 1 : 0,
    score_cross_20_flag: maxRoundScore >= 20 ? 1 : 0,
    dead_tile_flag: deadTileFlag,
    isolated_flag: isolatedFlag,
    nearly_dead_flag: nearlyDeadFlag,
    stable_structure_loss: breakdown?.shantenReward
      ? Math.max(0, -breakdown.shantenReward)
      : 0,
    flexibility_score: flexibility,
    response_value: responseValue,
    response_action_chi: actionType === 'chi' ? 1 : 0,
    response_action_peng: actionType === 'peng' ? 1 : 0,
    response_action_zhao: actionType === 'zhao' ? 1 : 0,
    response_action_pass: actionType === 'pass' ? 1 : 0,
    post_response_discard_risk: actionFamily === 'response'
      ? clampNonNegative(evidence?.dangerScore, 0)
      : 0,
    bipai_extra_meld_count: bipaiExtraMeldCount,
    gui_value: 0,
    live_response_sequence_count: liveResponseSequenceCount,
    live_response_2710_count: liveResponse2710Count,
    dead_response_sequence_count: deadResponseSequenceCount,
    dead_response_2710_count: deadResponse2710Count,
    stable_response_block_count: stableResponseBlockCount,
    viable_pair_templates: viablePairTemplates,
    viable_mixed_templates: viableMixedTemplates,
    viable_sequence_templates: viableSequenceTemplates,
    viable_2710_templates: viable2710Templates,
    blocked_template_count: blockedTemplateCount,
    free_support_count: freeSupportCount,
    total_live_support: totalLiveSupport,
    preserves_tempo_flag: tempoGain >= 0 ? 1 : 0,
    exact_meld_anchor_strength: exactMeldAnchorStrength,
    shape_anchor_strength: shapeAnchorStrength,
    turn_count: turnCount,
    deck_pressure: deckPressure,
    opening_flag: stage === 'opening' ? 1 : 0,
    midgame_flag: stage === 'midgame' ? 1 : 0,
    endgame_flag: stage === 'endgame' ? 1 : 0,
  };

  return {
    features,
    stage,
    actionFamily,
    hasStructuralCoverage: hasCriticalPolicyFeatureCoverage(features, actionFamily),
  };
}
