import { GameManager } from '../game-engine/game-manager';
import { GamePhase } from '../shared/types';
import { HandAnalyzer } from '../game-engine/hand-analyzer';
import { ScoreCalculator } from '../game-engine/score-calculator';
import { AIAnalyzer } from './ai-analyzer';
import { AIPlayerAgent } from './ai-player-agent';
import { WinRateCalculator } from './win-rate-calculator';
import {
  computePolicyObjective,
  computePolicyPriority,
  DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT,
  DEFAULT_POLICY_WIN_RATE_WEIGHT,
  getActivePolicyArtifact,
  scorePolicyFeatures,
  type PolicyMode,
} from './policy-artifact';
import {
  compareLearnedPolicyCandidates,
  computeLearnedPolicyObjective,
} from './policy-ranking';
import type {
  GameState,
  AvailableAction,
  Card,
  AIPlayRecommendation,
} from '../shared/types';
import type { PlayerAction } from '../shared/types/simulation';
import type {
  PolicyActionFamily,
  PolicyArtifact,
  PolicyEvaluationGate,
  PolicyEvaluationGateThreshold,
  PolicyEvaluationReport,
  PolicyEvaluationSample,
  PolicyHeadModel,
  PolicyHeadStageAdjustment,
  PolicyStage,
  RolloutEvaluationCandidate,
  RolloutEvaluationResult,
} from '../shared/types/ai';
import { buildBenchmarkSummary, categorizeBenchmarkSample, type BenchmarkEvaluationEntry } from './benchmark-categories';
import {
  buildPolicyFeatures,
  hasCriticalPolicyFeatureCoverage,
  inferPolicyActionFamily,
  inferPolicyStage,
} from './policy-feature-builder';

const DEFAULT_MAX_ROLLOUT_STEPS = 120;
const DEFAULT_MIN_OBJECTIVE_SPREAD = 0.35;
const DEFAULT_MIN_WINRATE_SPREAD = 0.015;
const DEFAULT_MIN_EXPECTED_SCORE_SPREAD = 0.35;
const DEFAULT_MIN_SIGNAL_RETAIN_RATIO = 0.6;
const DEFAULT_MIN_SIGNAL_RETAIN_SAMPLES = 96;
const DEFAULT_LOW_SIGNAL_ROW_WEIGHT = 0.35;
const DEFAULT_DISCARD_SAMPLE_WEIGHT = 1.2;
const DEFAULT_MAX_RESPONSE_TO_DISCARD_RATIO = 1;
const DEFAULT_MIN_RESPONSE_KEEP = 2;
const DEFAULT_PAIRWISE_MARGIN = 0.2;
const DEFAULT_PAIRWISE_WEIGHT = 0.7;
const DEFAULT_MAX_PAIRWISE_ROWS_PER_SAMPLE = 6;
const DEFAULT_DISCARD_STAGE_MIN_SHARE = 0.2;
const DEFAULT_DISCARD_OPENING_WEIGHT = 1.25;
const DEFAULT_DISCARD_MIDGAME_WEIGHT = 1.4;
const DEFAULT_OPENING_HEURISTIC_DISAGREEMENT_WEIGHT = 2.2;
const DEFAULT_MIDGAME_HEURISTIC_DISAGREEMENT_WEIGHT = 1.8;
const DEFAULT_HARD_EXAMPLE_WEIGHT = 1.8;
const MONOTONIC_CONSTRAINT_VERSION = 'harmful-features-nonpositive-v1';
const HARMFUL_NONPOSITIVE_FEATURES = new Set([
  'danger_score',
  'tempo_loss',
  'dead_tile_flag',
  'isolated_flag',
  'nearly_dead_flag',
  'stable_structure_loss',
  'blocked_template_count',
  'post_response_discard_risk',
  'dead_response_sequence_count',
  'dead_response_2710_count',
  'stable_response_block_count',
]);

export interface OfflineSample extends PolicyEvaluationSample {
  state: GameState;
  remainingDeck: Card[];
}

export interface OfflineTrainingOptions {
  selfPlayGames: number;
  maxTurnsPerGame?: number;
  maxSamples?: number;
  samplePhase?: 'discard' | 'response' | 'all';
  rolloutCountPerAction: number;
  rolloutSeed: number;
  winRateWeight?: number;
  expectedScoreWeight?: number;
  maxRolloutSteps?: number;
  /** Only rollout the top-K actions by heuristic priority; rest get lowest score. Default: all actions. */
  oracleTopK?: number;
  /** Early-stop rollout when best action leads by this win-rate margin. Default: disabled. */
  earlyStopDelta?: number;
  /** Write checkpoint every N samples during oracle evaluation. Default: 20. */
  oracleChunkSize?: number;
  /** Number of worker threads to use for oracle labeling. Default: 1 (serial). */
  oracleParallelism?: number;
  /** Maximum sampled response states per sampled discard state. Undefined keeps legacy sampling. */
  maxSampleResponseToDiscardRatio?: number;
  /** Maximum retained response samples per retained discard sample. Default: 1. */
  maxResponseToDiscardRatio?: number;
  /** Extra row weight for retained discard samples. Default: 1.2. */
  discardSampleWeight?: number;
  /** Minimum share per discard stage after signal filtering. Default: 0.2. */
  discardStageMinShare?: number;
  discardOpeningWeight?: number;
  discardMidgameWeight?: number;
  openingHeuristicDisagreementWeight?: number;
  midgameHeuristicDisagreementWeight?: number;
  hardExampleWeight?: number;
  /** Optional durable progress callback for self-play sampling. */
  onSamplingProgress?: (progress: { sampledDecisionCount: number; targetSamples?: number; gameIndex: number }) => void;
}

interface OracleWorkerTask {
  sampleIndex: number;
  sample: OfflineSample;
  options: OfflineTrainingOptions;
}

interface OracleWorkerResult {
  sampleIndex: number;
  sample: OfflineSample;
}

export interface OracleProgress {
  completedSamples: number;
  totalSamples: number;
  pendingSamples: number;
}

export interface OracleCheckpointOptions {
  completedSamples?: OfflineSample[];
  checkpointFile?: string;
  onProgress?: (progress: OracleProgress) => void;
}

interface ContinuationResult {
  winSignal: number;
  score: number;
}

interface CandidateStats {
  predictedWinRate: number;
  predictedExpectedScore: number;
  predictedScoreVariance: number;
  futureMingTangPotential: number;
}

interface LinearTrainingRow {
  features: Record<string, number>;
  objective: number;
  predictedWinRate: number;
  predictedExpectedScore: number;
  weight: number;
  sampleId?: string;
  stage?: PolicyStage;
  actionFamily?: PolicyActionFamily;
}

interface LinearFitConfig {
  learningRate: number;
  l2: number;
  epochs: number;
  featureLimit?: number;
}

export interface OracleSignalSummary {
  totalSamples: number;
  lowSignalSamples: number;
  lowSignalRatio: number;
}

interface OracleSignalStats {
  objectiveSpread: number;
  winRateSpread: number;
  expectedScoreSpread: number;
}

interface OracleSignalThresholds {
  minObjectiveSpread?: number;
  minWinRateSpread?: number;
  minExpectedScoreSpread?: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let temp = Math.imul(state ^ (state >>> 15), 1 | state);
    temp ^= temp + Math.imul(temp ^ (temp >>> 7), 61 | temp);
    return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
  };
}

function buildActionFromAvailable(action: AvailableAction, playerId: string): PlayerAction {
  return {
    type: action.type,
    playerId,
    cards: action.cards || [],
    chiOptionId: action.chiOptions?.[0]?.id,
    huOptionId: action.huOptions?.[0]?.id,
    timestamp: Date.now(),
  };
}

function cardCode(card: Card): string {
  return `${card.size === 'small' ? 'S' : 'B'}${card.value}`;
}

function cardCodes(cards?: Card[]): string[] {
  return (cards || []).map(cardCode);
}

function actionCardCode(action: AvailableAction): string | undefined {
  const card = action.cards?.[0];
  return card ? cardCode(card) : undefined;
}

function sortedCardCodes(cards?: Card[]): string[] {
  return cardCodes(cards).sort();
}

function buildActionKey(action: AvailableAction): string | undefined {
  if (action.type === 'discard') {
    return actionCardCode(action);
  }
  if (action.type === 'pass') {
    return 'pass';
  }
  if (action.type === 'hu') {
    const optionCodes = sortedCardCodes(action.huOptions?.[0]?.selectedCards);
    if (optionCodes.length > 0) {
      return `hu:${optionCodes.join(',')}`;
    }
    return 'hu';
  }
  if (action.type === 'chi') {
    const optionCodes = sortedCardCodes(action.chiOptions?.[0]?.selectedCards);
    if (optionCodes.length > 0) {
      return `chi:${optionCodes.join(',')}`;
    }
    const fallbackCodes = sortedCardCodes(action.cards);
    return fallbackCodes.length > 0 ? `chi:${fallbackCodes.join(',')}` : 'chi';
  }
  if (action.type === 'peng') {
    const codes = sortedCardCodes(action.cards);
    return codes.length > 0 ? `peng:${codes.join(',')}` : 'peng';
  }
  if (action.type === 'zhao') {
    const codes = sortedCardCodes(action.cards);
    return codes.length > 0 ? `zhao:${codes.join(',')}` : 'zhao';
  }
  return undefined;
}

function isSampleCandidateAction(state: GameState, action: AvailableAction): boolean {
  if (state.phase === GamePhase.DISCARDING) {
    return action.type === 'discard';
  }
  if (state.phase === GamePhase.RESPONSE_COLLECTING) {
    return action.type === 'pass'
      || action.type === 'chi'
      || action.type === 'peng'
      || action.type === 'zhao'
      || action.type === 'hu';
  }
  return false;
}

function collectSampleCandidateActions(state: GameState): AvailableAction[] {
  const actions = state.availableActions || [];
  const deduped = new Map<string, AvailableAction>();
  for (const action of actions) {
    if (!isSampleCandidateAction(state, action)) {
      continue;
    }
    const key = buildActionKey(action);
    if (!key || deduped.has(key)) {
      continue;
    }
    deduped.set(key, action);
  }
  return [...deduped.values()];
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function cloneDeck(deck: Card[]): Card[] {
  return JSON.parse(JSON.stringify(deck)) as Card[];
}

function buildStateProgressSignature(state: GameState): string {
  return [
    state.phase,
    state.currentPlayerIndex,
    state.turnCount,
    state.pendingCardSource ?? 'none',
    state.discardPile?.lastDiscard?.id ?? 'none',
    state.discardPile?.cards?.length ?? 0,
    state.availableActions?.length ?? 0,
  ].join('|');
}

function estimateProjectedContinuation(
  state: GameState,
  targetPlayerIndex: number,
  handAnalyzer: HandAnalyzer,
  scoreCalculator: ScoreCalculator,
  winRateCalculator: WinRateCalculator,
): ContinuationResult {
  const target = state.players[targetPlayerIndex];
  if (!target) {
    return {
      winSignal: 0,
      score: 0,
    };
  }

  const handAnalysis = handAnalyzer.analyze(target.cards, target.melds);
  const scoreSnapshot = scoreCalculator.calculateTotalScore([
    ...target.melds,
    ...handAnalysis.potentialMelds,
  ]);
  const heuristicWinRate = winRateCalculator.calculateHeuristicWinRate(
    target.cards,
    target.melds,
  ).currentWinRate;
  const projectedScore = Math.max(
    0,
    scoreSnapshot.roundScore,
    handAnalysis.totalHuPoints || 0,
    handAnalysis.tingCards.length * 2,
  );

  return {
    winSignal: heuristicWinRate,
    score: projectedScore,
  };
}

function resolveContinuationResult(
  state: GameState,
  targetPlayerIndex: number,
  handAnalyzer: HandAnalyzer,
  scoreCalculator: ScoreCalculator,
  winRateCalculator: WinRateCalculator,
): ContinuationResult {
  const winnerIndex = typeof state.winnerIndex === 'number'
    ? state.winnerIndex
    : undefined;
  if (!state.isGameOver || winnerIndex === undefined) {
    return estimateProjectedContinuation(
      state,
      targetPlayerIndex,
      handAnalyzer,
      scoreCalculator,
      winRateCalculator,
    );
  }

  return {
    winSignal: winnerIndex === targetPlayerIndex ? 1 : 0,
    score: state.players[targetPlayerIndex]?.totalScore ?? 0,
  };
}

function rebindActionToState(state: GameState, action: AvailableAction, playerId: string): PlayerAction {
  const player = state.players.find((item) => item.playerId === playerId);
  if (!player) {
    return buildActionFromAvailable(action, playerId);
  }
  const actionCards = (action.cards || [])
    .map((actionCard) => {
      const fromHand = player.cards.find((card) => card.id === actionCard.id);
      if (fromHand) return fromHand;
      const fromDiscard = state.discardPile.lastDiscard?.id === actionCard.id ? state.discardPile.lastDiscard : undefined;
      return fromDiscard || actionCard;
    });

  return {
    type: action.type,
    playerId,
    cards: actionCards,
    chiOptionId: action.chiOptions?.[0]?.id,
    huOptionId: action.huOptions?.[0]?.id,
    timestamp: Date.now(),
  };
}

async function selectActionWithPolicy(
  availableActions: AvailableAction[],
  state: GameState,
  playerIndex: number,
  analyzer: AIAnalyzer,
  mode: PolicyMode,
): Promise<PlayerAction> {
  if (availableActions.length === 0) {
    return {
      type: 'pass',
      playerId: state.players[playerIndex]?.playerId || `player_${playerIndex}`,
      cards: [],
      timestamp: Date.now(),
    };
  }
  if (mode === 'heuristic') {
    const first = availableActions[0];
    return buildActionFromAvailable(first, state.players[playerIndex].playerId);
  }

  const discardActions = availableActions.filter((action) => action.type === 'discard');
  const analysis = await analyzer.analyze(state, playerIndex, {
    discardTopK: Math.max(1, discardActions.length),
    policyMode: mode,
  });

  const ranked = analysis.rankedActions || [];
  for (const item of ranked) {
    if (!availableActions.includes(item.availableAction)) {
      continue;
    }
    return buildActionFromAvailable(item.availableAction, state.players[playerIndex].playerId);
  }

  return buildActionFromAvailable(availableActions[0], state.players[playerIndex].playerId);
}

async function runContinuationRollout(
  state: GameState,
  remainingDeck: Card[],
  forcedAction: AvailableAction,
  targetPlayerIndex: number,
  seed: number,
  maxSteps: number,
): Promise<ContinuationResult> {
  const gm = new GameManager();
  const rng = mulberry32(seed);
  const handAnalyzer = new HandAnalyzer();
  const scoreCalculator = new ScoreCalculator();
  const winRateCalculator = new WinRateCalculator();
  let currentState = cloneState(state);
  gm.setRemainingDeckSnapshot(cloneDeck(remainingDeck));
  const forcedPlayerId = currentState.players[targetPlayerIndex].playerId;
  currentState = gm.processAction(currentState, rebindActionToState(currentState, forcedAction, forcedPlayerId));

  const learnedAgents = new Map<string, AIPlayerAgent>();
  const fastAgents = new Map<string, AIPlayerAgent>();
  const analyzer = new AIAnalyzer();
  for (const player of currentState.players) {
    learnedAgents.set(player.playerId, new AIPlayerAgent(player.playerId, { mode: 'learned' }));
    fastAgents.set(player.playerId, new AIPlayerAgent(player.playerId, { mode: 'fast' }));
  }

  const chooseActionForPlayer = async (
    stateForPlayer: GameState,
    playerIndex: number,
  ): Promise<PlayerAction> => {
    const player = stateForPlayer.players[playerIndex];
    const mode: PolicyMode = playerIndex === targetPlayerIndex
      ? 'learned'
      : (rng() < 0.35 ? 'heuristic' : 'learned');

    if (mode === 'learned') {
      return selectActionWithPolicy(
        stateForPlayer.availableActions,
        stateForPlayer,
        playerIndex,
        analyzer,
        mode,
      );
    }

    const agent = rng() < 0.5
      ? learnedAgents.get(player.playerId)
      : fastAgents.get(player.playerId);
    return agent
      ? agent.decide(stateForPlayer)
      : buildActionFromAvailable(stateForPlayer.availableActions[0], player.playerId);
  };

  let steps = 0;
  while (!currentState.isGameOver && currentState.phase !== GamePhase.ENDED && steps < maxSteps) {
    steps += 1;
    if (currentState.phase === 'waiting' || currentState.phase === undefined) {
      currentState = gm.nextTurn(currentState);
    }

    const currentPlayer = currentState.players[currentState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.cards.length === 0) {
      currentState = gm.nextTurn(currentState);
      continue;
    }

    currentState = gm.updateAvailableActions(currentState);
    if ((currentState.availableActions || []).length === 0) {
      currentState = gm.nextTurn(currentState);
      continue;
    }

    const currentPlayerIndex = currentState.currentPlayerIndex;
    const beforeSignature = buildStateProgressSignature(currentState);
    const action = await chooseActionForPlayer(currentState, currentPlayerIndex);
    currentState = gm.processAction(currentState, action);

    if (
      !currentState.isGameOver
      && currentState.phase !== GamePhase.ENDED
      && beforeSignature === buildStateProgressSignature(currentState)
    ) {
      currentState = gm.nextTurn(currentState);
    }

    if (action.type === 'hu' || currentState.isGameOver || currentState.phase === GamePhase.ENDED) {
      break;
    }

    if (currentState.phase === GamePhase.RESPONSE_COLLECTING) {
      let resolved = false;
      const sourcePlayerIndex = currentState.discardPile.lastDiscardPlayerIndex ?? currentPlayerIndex;

      for (let offset = 0; offset < currentState.players.length && steps < maxSteps; offset += 1) {
        const checkIndex = (sourcePlayerIndex + offset) % currentState.players.length;
        const checkingPlayer = currentState.players[checkIndex];
        if (!checkingPlayer || checkingPlayer.cards.length === 0) {
          continue;
        }

        const responseState = gm.updateAvailableActions({
          ...currentState,
          currentPlayerIndex: checkIndex,
        });
        if ((responseState.availableActions || []).length === 0) {
          continue;
        }

        steps += 1;
        const beforeResponseSignature = buildStateProgressSignature(responseState);
        const decision = await chooseActionForPlayer(responseState, checkIndex);
        currentState = gm.processAction(
          {
            ...currentState,
            currentPlayerIndex: checkIndex,
          },
          decision,
        );

        if (
          !currentState.isGameOver
          && currentState.phase !== GamePhase.ENDED
          && beforeResponseSignature === buildStateProgressSignature(currentState)
        ) {
          currentState = gm.nextTurn(currentState);
        }

        if (decision.type !== 'pass' || currentState.phase !== GamePhase.RESPONSE_COLLECTING) {
          resolved = true;
          break;
        }
      }

      if (!resolved && !currentState.isGameOver && currentState.phase === GamePhase.RESPONSE_COLLECTING) {
        currentState = gm.nextTurn(currentState);
      }
    }
  }

  return resolveContinuationResult(
    currentState,
    targetPlayerIndex,
    handAnalyzer,
    scoreCalculator,
    winRateCalculator,
  );
}

function rolloutStats(results: ContinuationResult[]): CandidateStats {
  if (results.length === 0) {
    return {
      predictedWinRate: 0,
      predictedExpectedScore: 0,
      predictedScoreVariance: 0,
      futureMingTangPotential: 0,
    };
  }
  const winRate = results.reduce((sum, item) => sum + item.winSignal, 0) / results.length;
  const avgScore = results.reduce((sum, item) => sum + item.score, 0) / results.length;
  const variance = results.reduce((sum, item) => sum + ((item.score - avgScore) ** 2), 0) / results.length;
  return {
    predictedWinRate: winRate,
    predictedExpectedScore: avgScore,
    predictedScoreVariance: variance,
    futureMingTangPotential: Math.max(0, avgScore * 0.1 + winRate * 4),
  };
}

function objectiveScore(candidate: RolloutEvaluationCandidate, winRateWeight: number, expectedScoreWeight: number): number {
  return computePolicyObjective(candidate, { winRateWeight, expectedScoreWeight });
}

function extractPolicyFeatures(
  recommendation: AIPlayRecommendation | undefined,
  fallbackAction?: AvailableAction,
  state?: GameState,
): Record<string, number> {
  return buildPolicyFeatures(recommendation, fallbackAction, state).features;
}

function matchesSamplePhase(
  phase: GameState['phase'],
  samplePhase: OfflineTrainingOptions['samplePhase'],
): boolean {
  if (samplePhase === 'all' || !samplePhase) {
    return true;
  }
  if (samplePhase === 'response') {
    return phase === GamePhase.RESPONSE_COLLECTING;
  }
  return phase === GamePhase.DISCARDING;
}

function canKeepSampleForFamily(
  phase: GameState['phase'],
  counts: { discard: number; response: number },
  maxSampleResponseToDiscardRatio: number | undefined,
): boolean {
  if (maxSampleResponseToDiscardRatio === undefined || phase !== GamePhase.RESPONSE_COLLECTING) {
    return true;
  }
  const maxResponse = Math.max(
    DEFAULT_MIN_RESPONSE_KEEP,
    Math.floor(counts.discard * Math.max(0, maxSampleResponseToDiscardRatio)),
  );
  return counts.response < maxResponse;
}

export async function sampleSelfPlayDiscardStates(options: OfflineTrainingOptions): Promise<OfflineSample[]> {
  const gm = new GameManager();
  const analyzer = new AIAnalyzer();
  const samples: OfflineSample[] = [];
  const maxTurns = options.maxTurnsPerGame ?? 28;
  const maxSteps = maxTurns * 24;
  const sampledFamilyCounts = { discard: 0, response: 0 };
  let lastSamplingProgressAt = 0;
  const emitSamplingProgress = (gameIndex: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastSamplingProgressAt < 2_000) {
      return;
    }
    lastSamplingProgressAt = now;
    options.onSamplingProgress?.({
      sampledDecisionCount: samples.length,
      targetSamples: options.maxSamples,
      gameIndex,
    });
  };

  const samplingStartTime = Date.now();
  for (let gameIndex = 0; gameIndex < options.selfPlayGames; gameIndex += 1) {
    if ((gameIndex + 1) % 10 === 0 || gameIndex === 0) {
      const elapsed = ((Date.now() - samplingStartTime) / 1000).toFixed(0);
      console.log(`[sampling] game ${gameIndex + 1}/${options.selfPlayGames} (${samples.length} samples so far, ${elapsed}s elapsed)`);
      emitSamplingProgress(gameIndex + 1, true);
    }
    let state = gm.createGame({
      playerCount: 3,
      seed: options.rolloutSeed + gameIndex,
    });
    const agents = state.players.map((player) => new AIPlayerAgent(player.playerId, { mode: 'learned' }));
    let steps = 0;
    while (!state.isGameOver && steps < maxSteps) {
      steps += 1;
      if (state.phase === 'waiting' || state.phase === undefined) {
        state = gm.nextTurn(state);
      }

      state = gm.updateAvailableActions(state);
      const candidateActions = collectSampleCandidateActions(state);
      if (
        candidateActions.length > 0
        && matchesSamplePhase(state.phase, options.samplePhase)
        && canKeepSampleForFamily(
          state.phase,
          sampledFamilyCounts,
          options.maxSampleResponseToDiscardRatio,
        )
      ) {
        const playerIndex = state.currentPlayerIndex;
        const discardTopK = Math.max(1, candidateActions.filter((action) => action.type === 'discard').length);
        const heuristicAnalysis = await analyzer.analyze(state, playerIndex, {
          discardTopK,
          policyMode: 'heuristic',
        });
        const candidateByKey = new Map<string, AvailableAction>();
        for (const action of candidateActions) {
          const key = buildActionKey(action);
          if (!key || candidateByKey.has(key)) continue;
          candidateByKey.set(key, action);
        }

        const featureMap = new Map<string, Record<string, number>>();
        for (const rankedAction of heuristicAnalysis.rankedActions || []) {
          const key = buildActionKey(rankedAction.availableAction);
          if (!key || !candidateByKey.has(key)) continue;
          featureMap.set(
            key,
            rankedAction.recommendation
              ? extractPolicyFeatures(rankedAction.recommendation, rankedAction.availableAction, state)
              : extractPolicyFeatures(undefined, rankedAction.availableAction, state),
          );
        }

        const legalDiscards = [...candidateByKey.keys()];
        const policyFeaturesByAction: Record<string, Record<string, number>> = {};
        for (const actionKey of legalDiscards) {
          const action = candidateByKey.get(actionKey);
          policyFeaturesByAction[actionKey] = featureMap.get(actionKey)
            || extractPolicyFeatures(undefined, action, state);
        }

        let heuristicTopOption = legalDiscards[0] || '';
        for (const rankedAction of heuristicAnalysis.rankedActions || []) {
          const key = buildActionKey(rankedAction.availableAction);
          if (!key || !candidateByKey.has(key)) continue;
          heuristicTopOption = key;
          break;
        }

        samples.push({
          sampleId: `sample_${gameIndex}_${samples.length}`,
          stateSignature: `${state.turnCount}_${state.currentPlayerIndex}_${state.remainingDeckCards}_${legalDiscards.join('|')}`,
          playerId: state.players[playerIndex].playerId,
          playerIndex,
          turnCount: state.turnCount,
          phase: state.phase,
          remainingDeckCards: state.remainingDeckCards,
          legalDiscards,
          heuristicTopOption,
          policyFeaturesByAction,
          state: cloneState(state),
          remainingDeck: gm.getRemainingDeckSnapshot(),
        });
        if (state.phase === GamePhase.RESPONSE_COLLECTING) {
          sampledFamilyCounts.response += 1;
        } else {
          sampledFamilyCounts.discard += 1;
        }
        emitSamplingProgress(gameIndex + 1);

        if (options.maxSamples && samples.length >= options.maxSamples) {
          emitSamplingProgress(gameIndex + 1, true);
          break;
        }
      }

      if ((state.availableActions || []).length === 0) {
        state = gm.nextTurn(state);
        continue;
      }

      const currentPlayer = state.currentPlayerIndex;
      const action = await agents[currentPlayer].decide(state);
      state = gm.processAction(state, action);
    }
    if (options.maxSamples && samples.length >= options.maxSamples) {
      break;
    }
  }

  emitSamplingProgress(options.selfPlayGames, true);
  return options.maxSamples ? samples.slice(0, options.maxSamples) : samples;
}

export async function evaluateDiscardCandidatesWithRollouts(
  sample: OfflineSample,
  options: OfflineTrainingOptions,
): Promise<RolloutEvaluationResult> {
  const state = cloneState(sample.state);
  const allCandidates = collectSampleCandidateActions(state)
    .map((action) => ({
      action,
      key: buildActionKey(action),
    }))
    .filter((item): item is { action: AvailableAction; key: string } => !!item.key);
  const candidates: RolloutEvaluationCandidate[] = [];
  const winRateWeight = options.winRateWeight ?? DEFAULT_POLICY_WIN_RATE_WEIGHT;
  const expectedScoreWeight = options.expectedScoreWeight ?? DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT;
  const oracleTopK = options.oracleTopK;
  const earlyStopDelta = options.earlyStopDelta;

  // --- Action pruning: only rollout top-K by heuristic priority ---
  let rolloutCandidates = allCandidates;
  let prunedCandidates: typeof allCandidates = [];
  if (oracleTopK && oracleTopK > 0 && allCandidates.length > oracleTopK) {
    // Use heuristic priority from policyFeaturesByAction if available
    const featuresByAction = sample.policyFeaturesByAction || {};
    const scored = allCandidates.map((c) => {
      const features = featuresByAction[c.key];
      const heuristicPriority = features?.heuristic_priority ?? features?.heuristicPriority ?? 0;
      return { ...c, heuristicPriority };
    }).sort((a, b) => b.heuristicPriority - a.heuristicPriority);
    rolloutCandidates = scored.slice(0, oracleTopK);
    prunedCandidates = scored.slice(oracleTopK);
  }

  // --- Rollout with optional early-stop ---
  const rolloutCount = options.rolloutCountPerAction;
  const earlyStopCheckInterval = earlyStopDelta ? Math.max(1, Math.ceil(rolloutCount / 3)) : rolloutCount;
  const actionRolloutResults: Map<number, ContinuationResult[]> = new Map();
  for (let actionIndex = 0; actionIndex < rolloutCandidates.length; actionIndex += 1) {
    actionRolloutResults.set(actionIndex, []);
  }

  for (let rolloutIndex = 0; rolloutIndex < rolloutCount; rolloutIndex += 1) {
    // Check early-stop at each checkpoint interval
    if (earlyStopDelta && rolloutIndex > 0 && rolloutIndex % earlyStopCheckInterval === 0 && rolloutCandidates.length > 1) {
      const winRates = [...actionRolloutResults.entries()].map(([idx, results]) => {
        const winSum = results.reduce((s, r) => s + r.winSignal, 0);
        return { idx, winRate: winSum / results.length };
      }).sort((a, b) => b.winRate - a.winRate);
      const gap = winRates[0].winRate - winRates[1].winRate;
      if (gap >= earlyStopDelta) {
        break;
      }
    }

    for (let actionIndex = 0; actionIndex < rolloutCandidates.length; actionIndex += 1) {
      const candidateAction = rolloutCandidates[actionIndex];
      const seed = options.rolloutSeed + actionIndex * 10007 + rolloutIndex * 97;
      const result = await runContinuationRollout(
        state,
        sample.remainingDeck,
        candidateAction.action,
        sample.playerIndex,
        seed,
        options.maxRolloutSteps ?? DEFAULT_MAX_ROLLOUT_STEPS,
      );
      actionRolloutResults.get(actionIndex)!.push(result);
    }
  }

  // Build candidates from rollout results
  for (let actionIndex = 0; actionIndex < rolloutCandidates.length; actionIndex += 1) {
    const candidateAction = rolloutCandidates[actionIndex];
    const results = actionRolloutResults.get(actionIndex) || [];
    const stats = rolloutStats(results);
    candidates.push({
      action: candidateAction.action.type,
      cards: [candidateAction.key],
      predictedWinRate: stats.predictedWinRate,
      predictedExpectedScore: stats.predictedExpectedScore,
      predictedScoreVariance: stats.predictedScoreVariance,
      futureMingTangPotential: stats.futureMingTangPotential,
      rolloutCount: results.length,
    });
  }

  // Pruned candidates get worst-case scores (no rollout)
  for (const pruned of prunedCandidates) {
    candidates.push({
      action: pruned.action.type,
      cards: [pruned.key],
      predictedWinRate: 0,
      predictedExpectedScore: 0,
      predictedScoreVariance: 0,
      futureMingTangPotential: 0,
      rolloutCount: 0,
    });
  }

  candidates.sort((left, right) => {
    return objectiveScore(right, winRateWeight, expectedScoreWeight)
      - objectiveScore(left, winRateWeight, expectedScoreWeight);
  });

  return {
    sampleId: sample.sampleId,
    policyVersion: 'oracle-rollout-v1',
    objectiveScore: candidates[0]
      ? objectiveScore(candidates[0], winRateWeight, expectedScoreWeight)
      : 0,
    candidates,
  };
}

export interface OracleCheckpoint {
  completedSamples: OfflineSample[];
  pendingSamples: OfflineSample[];
  config: Pick<OfflineTrainingOptions, 'rolloutCountPerAction' | 'maxRolloutSteps' | 'rolloutSeed' | 'oracleTopK' | 'earlyStopDelta' | 'oracleParallelism'>;
}

async function writeOracleCheckpoint(
  checkpointFile: string,
  completedSamples: OfflineSample[],
  pendingSamples: OfflineSample[],
  options: OfflineTrainingOptions,
): Promise<void> {
  const ckpt: OracleCheckpoint = {
    completedSamples,
    pendingSamples,
    config: {
      rolloutCountPerAction: options.rolloutCountPerAction,
      maxRolloutSteps: options.maxRolloutSteps,
      rolloutSeed: options.rolloutSeed,
      oracleTopK: options.oracleTopK,
      earlyStopDelta: options.earlyStopDelta,
      oracleParallelism: options.oracleParallelism,
    },
  };
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(checkpointFile), { recursive: true });
  writeFileSync(checkpointFile, JSON.stringify(ckpt), 'utf8');
}

export async function attachOracleToSamplesParallel(
  samples: OfflineSample[],
  options: OfflineTrainingOptions,
  checkpoint?: OracleCheckpointOptions,
): Promise<OfflineSample[]> {
  const requestedParallelism = Math.max(1, Math.floor(options.oracleParallelism ?? 1));
  if (requestedParallelism <= 1 || samples.length <= 1) {
    return attachOracleToSamples(samples, {
      ...options,
      oracleParallelism: 1,
    }, checkpoint);
  }

  const { Worker } = await import('node:worker_threads');
  const chunkSize = options.oracleChunkSize ?? 20;
  const completedByIndex = new Map<number, OfflineSample>();
  const precompleted = checkpoint?.completedSamples || [];
  for (let index = 0; index < precompleted.length; index += 1) {
    completedByIndex.set(index, precompleted[index]);
  }

  const startIndex = precompleted.length;
  const total = samples.length;
  const startTime = Date.now();
  let completedCount = precompleted.length;
  let nextSampleIndex = startIndex;
  const parallelism = Math.min(requestedParallelism, total - startIndex);

  if (parallelism <= 0) {
    return samples.map((_, index) => completedByIndex.get(index) || samples[index]);
  }

  const workerUrl = new URL('./rollout-offline-worker-bootstrap.cjs', import.meta.url);

  try {
    await new Promise<void>((resolve, reject) => {
      const workers: Array<any> = [];
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)))
          .then(() => resolve())
          .catch(reject);
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)))
          .finally(() => reject(error));
      };

      const maybeCheckpoint = async () => {
        if (!checkpoint?.checkpointFile) {
          return;
        }
        if (completedCount % chunkSize !== 0 && completedCount !== total) {
          return;
        }
        const completedSamples = samples
          .map((_, index) => completedByIndex.get(index))
          .filter((sample): sample is OfflineSample => !!sample);
        const pendingSamples = samples.filter((_, index) => !completedByIndex.has(index));
        await writeOracleCheckpoint(checkpoint.checkpointFile, completedSamples, pendingSamples, options);
        checkpoint.onProgress?.({
          completedSamples: completedCount,
          totalSamples: total,
          pendingSamples: Math.max(0, total - completedCount),
        });
        console.log(`[oracle-parallel] checkpoint saved: ${completedCount}/${total} samples`);
      };

      const dispatch = (worker: any) => {
        if (settled) {
          return;
        }
        if (nextSampleIndex >= total) {
          if (completedCount >= total) {
            finish();
          }
          return;
        }

        const sampleIndex = nextSampleIndex;
        nextSampleIndex += 1;
        const task: OracleWorkerTask = {
          sampleIndex,
          sample: samples[sampleIndex],
          options: {
            ...options,
            oracleParallelism: 1,
          },
        };
        worker.postMessage(task);
      };

      for (let workerIndex = 0; workerIndex < parallelism; workerIndex += 1) {
        const worker = new Worker(workerUrl);
        workers.push(worker);

        worker.on('message', async (message: OracleWorkerResult) => {
          if (settled) {
            return;
          }
          completedByIndex.set(message.sampleIndex, message.sample);
          completedCount += 1;
          if (completedCount % 10 === 0 || completedCount === total) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const processed = completedCount - startIndex;
            const perSample = processed > 0 ? ((Date.now() - startTime) / processed / 1000).toFixed(1) : '?';
            const remaining = total - completedCount;
            const eta = processed > 0 && remaining > 0 ? ((Date.now() - startTime) / processed * remaining / 1000 / 60).toFixed(1) : '0';
            console.log(`[oracle-parallel] ${completedCount}/${total} (${elapsed}s elapsed, ${perSample}s/sample, ETA ${eta}min)`);
          }
          try {
            await maybeCheckpoint();
            dispatch(worker);
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });

        worker.on('error', (error: Error) => {
          fail(error);
        });

        worker.on('exit', (code: number) => {
          if (!settled && code !== 0) {
            fail(new Error(`oracle worker exited with code ${code}`));
          }
        });

        dispatch(worker);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes('ERR_REQUIRE_CYCLE_MODULE')
      && !message.includes('Cannot require() ES Module')
      && !message.includes('Cannot find module')
    ) {
      throw error;
    }
    console.warn(`[oracle-parallel] worker startup failed (${message}); falling back to serial oracle labeling`);
    return attachOracleToSamples(samples, {
      ...options,
      oracleParallelism: 1,
    }, checkpoint);
  }

  return samples.map((sample, index) => completedByIndex.get(index) || sample);
}

export async function attachOracleToSamples(
  samples: OfflineSample[],
  options: OfflineTrainingOptions,
  checkpoint?: OracleCheckpointOptions,
): Promise<OfflineSample[]> {
  if ((options.oracleParallelism ?? 1) > 1 && samples.length > 1) {
    return attachOracleToSamplesParallel(samples, options, checkpoint);
  }

  const chunkSize = options.oracleChunkSize ?? 20;
  const result: OfflineSample[] = [...(checkpoint?.completedSamples || [])];
  const startIndex = result.length;
  const total = samples.length;
  const startTime = Date.now();

  if (startIndex > 0) {
    console.log(`[oracle] resuming from sample ${startIndex}/${total}`);
  }

  for (let i = startIndex; i < samples.length; i += 1) {
    const sample = samples[i];
    const oracle = await evaluateDiscardCandidatesWithRollouts(sample, options);
    result.push({
      ...sample,
      oracle,
    });
    const done = i + 1;
    if (done % 10 === 0 || done === total) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const processed = done - startIndex;
      const perSample = processed > 0 ? ((Date.now() - startTime) / processed / 1000).toFixed(1) : '?';
      const remaining = total - done;
      const eta = processed > 0 && remaining > 0 ? ((Date.now() - startTime) / processed * remaining / 1000 / 60).toFixed(1) : '0';
      console.log(`[oracle] ${done}/${total} (${elapsed}s elapsed, ${perSample}s/sample, ETA ${eta}min)`);
    }

    // Chunk-level checkpoint
    if (checkpoint?.checkpointFile && (done % chunkSize === 0 || done === total)) {
      await writeOracleCheckpoint(
        checkpoint.checkpointFile,
        result,
        samples.slice(done),
        options,
      );
      checkpoint.onProgress?.({
        completedSamples: done,
        totalSamples: total,
        pendingSamples: Math.max(0, total - done),
      });
      console.log(`[oracle] checkpoint saved: ${done}/${total} samples`);
    }
  }
  return result;
}

export function toPolicyEvaluationSample(sample: OfflineSample): PolicyEvaluationSample {
  return {
    sampleId: sample.sampleId,
    stateSignature: sample.stateSignature,
    playerId: sample.playerId,
    playerIndex: sample.playerIndex,
    turnCount: sample.turnCount,
    phase: sample.phase,
    remainingDeckCards: sample.state.remainingDeckCards,
    remainingDeck: cloneDeck(sample.remainingDeck),
    legalDiscards: sample.legalDiscards,
    heuristicTopOption: sample.heuristicTopOption,
    policyFeaturesByAction: sample.policyFeaturesByAction,
    oracle: sample.oracle,
  };
}

export function toPolicyEvaluationSamples(samples: OfflineSample[]): PolicyEvaluationSample[] {
  return samples.map(toPolicyEvaluationSample);
}

function computeOracleSignalStats(
  sample: Pick<OfflineSample, 'oracle'>,
  winRateWeight: number,
  expectedScoreWeight: number,
): OracleSignalStats {
  const candidates = sample.oracle?.candidates || [];
  if (candidates.length <= 1) {
    return {
      objectiveSpread: 0,
      winRateSpread: 0,
      expectedScoreSpread: 0,
    };
  }

  let minObjective = Number.POSITIVE_INFINITY;
  let maxObjective = Number.NEGATIVE_INFINITY;
  let minWinRate = Number.POSITIVE_INFINITY;
  let maxWinRate = Number.NEGATIVE_INFINITY;
  let minExpectedScore = Number.POSITIVE_INFINITY;
  let maxExpectedScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const objective = objectiveScore(candidate, winRateWeight, expectedScoreWeight);
    minObjective = Math.min(minObjective, objective);
    maxObjective = Math.max(maxObjective, objective);
    minWinRate = Math.min(minWinRate, candidate.predictedWinRate);
    maxWinRate = Math.max(maxWinRate, candidate.predictedWinRate);
    minExpectedScore = Math.min(minExpectedScore, candidate.predictedExpectedScore);
    maxExpectedScore = Math.max(maxExpectedScore, candidate.predictedExpectedScore);
  }

  return {
    objectiveSpread: Math.max(0, maxObjective - minObjective),
    winRateSpread: Math.max(0, maxWinRate - minWinRate),
    expectedScoreSpread: Math.max(0, maxExpectedScore - minExpectedScore),
  };
}

function isLowSignalSample(
  signal: OracleSignalStats,
  thresholds: OracleSignalThresholds = {},
): boolean {
  const minObjectiveSpread = thresholds.minObjectiveSpread ?? DEFAULT_MIN_OBJECTIVE_SPREAD;
  const minWinRateSpread = thresholds.minWinRateSpread ?? DEFAULT_MIN_WINRATE_SPREAD;
  const minExpectedScoreSpread = thresholds.minExpectedScoreSpread ?? DEFAULT_MIN_EXPECTED_SCORE_SPREAD;
  return signal.objectiveSpread < minObjectiveSpread
    && signal.winRateSpread < minWinRateSpread
    && signal.expectedScoreSpread < minExpectedScoreSpread;
}

export function summarizeOracleSignal(
  samples: Array<Pick<OfflineSample, 'oracle'>>,
  options: Pick<OfflineTrainingOptions, 'winRateWeight' | 'expectedScoreWeight'> & OracleSignalThresholds = {},
): OracleSignalSummary {
  const winRateWeight = options.winRateWeight ?? DEFAULT_POLICY_WIN_RATE_WEIGHT;
  const expectedScoreWeight = options.expectedScoreWeight ?? DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT;
  let lowSignalSamples = 0;

  for (const sample of samples) {
    const signal = computeOracleSignalStats(sample, winRateWeight, expectedScoreWeight);
    if (isLowSignalSample(signal, options)) {
      lowSignalSamples += 1;
    }
  }

  const totalSamples = samples.length;
  return {
    totalSamples,
    lowSignalSamples,
    lowSignalRatio: totalSamples > 0 ? lowSignalSamples / totalSamples : 0,
  };
}

interface AnnotatedTrainingSample {
  sample: OfflineSample;
  signal: OracleSignalStats;
  lowSignal: boolean;
  selectionPriority: number;
  oracleTopCode?: string;
}

function compareAnnotatedTrainingSignal(
  left: AnnotatedTrainingSample,
  right: AnnotatedTrainingSample,
): number {
  return right.selectionPriority - left.selectionPriority
    || right.signal.objectiveSpread - left.signal.objectiveSpread
    || right.signal.winRateSpread - left.signal.winRateSpread
    || right.signal.expectedScoreSpread - left.signal.expectedScoreSpread
    || left.sample.sampleId.localeCompare(right.sample.sampleId);
}

function getSampleActionFamily(sample: Pick<OfflineSample, 'phase'>): PolicyActionFamily {
  return inferPolicyActionFamily('discard', sample.phase);
}

function getSampleStage(
  sample: Pick<OfflineSample, 'turnCount' | 'remainingDeckCards'>,
): PolicyStage {
  return inferPolicyStage(sample.turnCount || 0, sample.remainingDeckCards || 0);
}

function getOracleTopCode(
  sample: Pick<OfflineSample, 'oracle'>,
  winRateWeight: number,
  expectedScoreWeight: number,
): string | undefined {
  const candidates = sample.oracle?.candidates;
  if (!candidates || candidates.length === 0) {
    return undefined;
  }
  const top = [...candidates].sort((left, right) => (
    objectiveScore(right, winRateWeight, expectedScoreWeight)
    - objectiveScore(left, winRateWeight, expectedScoreWeight)
  ))[0];
  return top?.cards?.[0];
}

function getSelectionPriority(
  sample: OfflineSample,
  oracleTopCode: string | undefined,
): number {
  const family = getSampleActionFamily(sample);
  if (family !== 'discard' || !oracleTopCode) {
    return 0;
  }

  const stage = getSampleStage(sample);
  const heuristicTop = sample.heuristicTopOption;
  const heuristicDisagrees = !!heuristicTop && heuristicTop !== oracleTopCode;

  if (heuristicDisagrees && stage === 'opening') {
    return 3;
  }
  if (heuristicDisagrees && stage === 'midgame') {
    return 2;
  }
  if (stage === 'opening') {
    return 1;
  }
  if (stage === 'midgame') {
    return 0.5;
  }
  return 0;
}

function getPolicyTopCodeForSample(
  sample: OfflineSample,
  artifact: PolicyArtifact,
  winRateWeight: number,
  expectedScoreWeight: number,
): string | undefined {
  const actionFamily = getSampleActionFamily(sample);
  const stage = getSampleStage(sample);
  return Object.entries(sample.policyFeaturesByAction || {})
    .map(([code, features]) => {
      const score = scorePolicyFeatures(features, artifact, {
        actionFamily,
        stage,
      });
      return {
        code,
        predictedWinRate: score.predictedWinRate,
        predictedExpectedScore: score.predictedExpectedScore,
        policyScore: score.policyScore,
      };
    })
    .sort((left, right) => compareLearnedPolicyCandidates(
      {
        predictedWinRate: left.predictedWinRate,
        predictedExpectedScore: left.predictedExpectedScore,
        policyScore: left.policyScore,
        baselinePriority: 0,
      },
      {
        predictedWinRate: right.predictedWinRate,
        predictedExpectedScore: right.predictedExpectedScore,
        policyScore: right.policyScore,
        baselinePriority: 0,
      },
      {
        winRateWeight,
        expectedScoreWeight,
      },
    ))[0]?.code;
}

function applyFamilyStageAndHardExampleWeights(
  selectedSamples: OfflineSample[],
  sampleWeights: Map<string, number>,
  baseArtifact: PolicyArtifact,
  winRateWeight: number,
  expectedScoreWeight: number,
  options: Pick<
    OfflineTrainingOptions,
    | 'discardOpeningWeight'
    | 'discardMidgameWeight'
    | 'openingHeuristicDisagreementWeight'
    | 'midgameHeuristicDisagreementWeight'
    | 'hardExampleWeight'
  > = {},
): { hardExampleSampleCount: number } {
  const discardOpeningWeight = Math.max(0, options.discardOpeningWeight ?? DEFAULT_DISCARD_OPENING_WEIGHT);
  const discardMidgameWeight = Math.max(0, options.discardMidgameWeight ?? DEFAULT_DISCARD_MIDGAME_WEIGHT);
  const openingHeuristicDisagreementWeight = Math.max(
    0,
    options.openingHeuristicDisagreementWeight ?? DEFAULT_OPENING_HEURISTIC_DISAGREEMENT_WEIGHT,
  );
  const midgameHeuristicDisagreementWeight = Math.max(
    0,
    options.midgameHeuristicDisagreementWeight ?? DEFAULT_MIDGAME_HEURISTIC_DISAGREEMENT_WEIGHT,
  );
  const hardExampleWeight = Math.max(0, options.hardExampleWeight ?? DEFAULT_HARD_EXAMPLE_WEIGHT);
  let hardExampleSampleCount = 0;
  for (const sample of selectedSamples) {
    const family = getSampleActionFamily(sample);
    const stage = getSampleStage(sample);
    const currentWeight = sampleWeights.get(sample.sampleId) ?? 1;
    let nextWeight = currentWeight;

    if (family === 'discard') {
      if (stage === 'opening') {
        nextWeight *= discardOpeningWeight;
      } else if (stage === 'midgame') {
        nextWeight *= discardMidgameWeight;
      }
    }

    if (family === 'discard' && (stage === 'opening' || stage === 'midgame')) {
      const oracleTop = getOracleTopCode(sample, winRateWeight, expectedScoreWeight);
      const baseTop = getPolicyTopCodeForSample(sample, baseArtifact, winRateWeight, expectedScoreWeight);
      const heuristicTop = sample.heuristicTopOption;
      let markedHardExample = false;

      if (oracleTop && heuristicTop && oracleTop !== heuristicTop) {
        nextWeight *= stage === 'opening'
          ? openingHeuristicDisagreementWeight
          : midgameHeuristicDisagreementWeight;
        markedHardExample = true;
      }

      if (oracleTop && baseTop && oracleTop !== baseTop) {
        nextWeight *= hardExampleWeight;
        markedHardExample = true;
      }

      if (markedHardExample) {
        hardExampleSampleCount += 1;
      }
    }

    sampleWeights.set(sample.sampleId, nextWeight);
  }
  return {
    hardExampleSampleCount,
  };
}

function countLowCoverageSamples(samples: OfflineSample[]): number {
  let lowCoverage = 0;
  for (const sample of samples) {
    const family = getSampleActionFamily(sample);
    const featuresByAction = sample.policyFeaturesByAction || {};
    const coverageCount = Object.values(featuresByAction)
      .filter((features) => hasCriticalPolicyFeatureCoverage(features, family))
      .length;
    if (coverageCount < 2) {
      lowCoverage += 1;
    }
  }
  return lowCoverage;
}

function rebalanceDiscardStageCoverage(
  selected: AnnotatedTrainingSample[],
  annotated: AnnotatedTrainingSample[],
  discardStageMinShare = DEFAULT_DISCARD_STAGE_MIN_SHARE,
): AnnotatedTrainingSample[] {
  const discardSelected = selected.filter((item) => item.sample.phase !== 'response_collecting');
  if (discardSelected.length <= 0) {
    return selected;
  }

  const availableByStage = new Map<PolicyStage, AnnotatedTrainingSample[]>();
  const selectedByStage = new Map<PolicyStage, AnnotatedTrainingSample[]>();
  const selectedIds = new Set(selected.map((item) => item.sample.sampleId));

  for (const item of annotated) {
    if (item.sample.phase === 'response_collecting') {
      continue;
    }
    const stage = getSampleStage(item.sample);
    const stageItems = availableByStage.get(stage) || [];
    stageItems.push(item);
    stageItems.sort(compareAnnotatedTrainingSignal);
    availableByStage.set(stage, stageItems);
  }

  for (const item of discardSelected) {
    const stage = getSampleStage(item.sample);
    const stageItems = selectedByStage.get(stage) || [];
    stageItems.push(item);
    stageItems.sort(compareAnnotatedTrainingSignal);
    selectedByStage.set(stage, stageItems);
  }

  const desiredMinimumByStage = new Map<PolicyStage, number>();
  for (const stage of ['opening', 'midgame', 'endgame'] as const) {
    const availableCount = availableByStage.get(stage)?.length || 0;
    if (availableCount <= 0) {
      continue;
    }
    desiredMinimumByStage.set(
      stage,
      Math.min(
        availableCount,
        Math.max(1, Math.floor(discardSelected.length * discardStageMinShare)),
      ),
    );
  }

  const result = [...selected];
  const replaceSelected = (sampleId: string, replacement: AnnotatedTrainingSample): void => {
    const index = result.findIndex((item) => item.sample.sampleId === sampleId);
    if (index >= 0) {
      result[index] = replacement;
    }
  };

  for (const targetStage of ['opening', 'midgame', 'endgame'] as const) {
    const targetMinimum = desiredMinimumByStage.get(targetStage) || 0;
    while ((selectedByStage.get(targetStage)?.length || 0) < targetMinimum) {
      const incoming = (availableByStage.get(targetStage) || [])
        .find((item) => !selectedIds.has(item.sample.sampleId));
      if (!incoming) {
        break;
      }

      const donorStage = (['endgame', 'opening', 'midgame'] as const)
        .find((stage) => {
          if (stage === targetStage) {
            return false;
          }
          const currentCount = selectedByStage.get(stage)?.length || 0;
          const minimum = desiredMinimumByStage.get(stage) || 0;
          return currentCount > minimum;
        });
      if (!donorStage) {
        break;
      }

      const donor = [...(selectedByStage.get(donorStage) || [])]
        .sort((left, right) => compareAnnotatedTrainingSignal(right, left))[0];
      if (!donor) {
        break;
      }

      selectedIds.delete(donor.sample.sampleId);
      selectedIds.add(incoming.sample.sampleId);
      selectedByStage.set(
        donorStage,
        (selectedByStage.get(donorStage) || [])
          .filter((item) => item.sample.sampleId !== donor.sample.sampleId),
      );
      selectedByStage.set(
        targetStage,
        [...(selectedByStage.get(targetStage) || []), incoming].sort(compareAnnotatedTrainingSignal),
      );
      replaceSelected(donor.sample.sampleId, incoming);
    }
  }

  return result;
}

function selectTrainingSamplesBySignal(
  samples: OfflineSample[],
  options: Pick<
    OfflineTrainingOptions,
    | 'winRateWeight'
    | 'expectedScoreWeight'
    | 'maxResponseToDiscardRatio'
    | 'discardSampleWeight'
    | 'discardStageMinShare'
  > & OracleSignalThresholds = {},
): {
  selectedSamples: OfflineSample[];
  sampleWeights: Map<string, number>;
  signalSummary: OracleSignalSummary;
} {
  const winRateWeight = options.winRateWeight ?? DEFAULT_POLICY_WIN_RATE_WEIGHT;
  const expectedScoreWeight = options.expectedScoreWeight ?? DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT;
  const maxResponseToDiscardRatio = Math.max(
    0,
    options.maxResponseToDiscardRatio ?? DEFAULT_MAX_RESPONSE_TO_DISCARD_RATIO,
  );
  const discardSampleWeight = Math.max(
    0,
    options.discardSampleWeight ?? DEFAULT_DISCARD_SAMPLE_WEIGHT,
  );
  const discardStageMinShare = Math.max(
    0,
    options.discardStageMinShare ?? DEFAULT_DISCARD_STAGE_MIN_SHARE,
  );
  const minimumRetained = Math.min(
    samples.length,
    Math.max(
      DEFAULT_MIN_SIGNAL_RETAIN_SAMPLES,
      Math.ceil(samples.length * DEFAULT_MIN_SIGNAL_RETAIN_RATIO),
    ),
  );

  const annotated: AnnotatedTrainingSample[] = samples.map((sample) => {
    const signal = computeOracleSignalStats(sample, winRateWeight, expectedScoreWeight);
    const oracleTopCode = getOracleTopCode(sample, winRateWeight, expectedScoreWeight);
    return {
      sample,
      signal,
      lowSignal: isLowSignalSample(signal, options),
      selectionPriority: getSelectionPriority(sample, oracleTopCode),
      oracleTopCode,
    };
  });
  const highSignal = annotated.filter((item) => !item.lowSignal);
  const lowSignal = annotated
    .filter((item) => item.lowSignal)
    .sort(compareAnnotatedTrainingSignal);

  let selected = [...highSignal];
  if (selected.length < minimumRetained) {
    const needed = minimumRetained - selected.length;
    selected.push(...lowSignal.slice(0, needed));
  }

  const discardSelected = selected.filter((item) => item.sample.phase !== 'response_collecting');
  const responseSelected = selected.filter((item) => item.sample.phase === 'response_collecting');
  if (discardSelected.length > 0 && responseSelected.length > 0) {
    const maxResponseSamples = Math.max(
      DEFAULT_MIN_RESPONSE_KEEP,
      Math.floor(discardSelected.length * maxResponseToDiscardRatio),
    );
    if (responseSelected.length > maxResponseSamples) {
      const prioritizedResponse = [...responseSelected].sort((left, right) => {
        return compareAnnotatedTrainingSignal(left, right);
      });
      selected = [...discardSelected, ...prioritizedResponse.slice(0, maxResponseSamples)];
    }
  }

  selected = rebalanceDiscardStageCoverage(selected, annotated, discardStageMinShare);

  const selectedSamples = selected.map((item) => item.sample);
  const sampleWeights = new Map<string, number>();
  for (const item of selected) {
    const lowSignalWeight = item.lowSignal ? DEFAULT_LOW_SIGNAL_ROW_WEIGHT : 1;
    const familyWeight = item.sample.phase === 'response_collecting'
      ? 1
      : discardSampleWeight;
    sampleWeights.set(item.sample.sampleId, lowSignalWeight * familyWeight);
  }

  return {
    selectedSamples: selectedSamples.length > 0 ? selectedSamples : samples,
    sampleWeights,
    signalSummary: {
      totalSamples: samples.length,
      lowSignalSamples: lowSignal.length,
      lowSignalRatio: samples.length > 0 ? lowSignal.length / samples.length : 0,
    },
  };
}

function buildFeatureKeys(samples: OfflineSample[]): string[] {
  const featureKeys = new Set<string>();
  for (const sample of samples) {
    const featureMap = sample.policyFeaturesByAction || {};
    for (const key of Object.keys(featureMap)) {
      for (const featureKey of Object.keys(featureMap[key] || {})) {
        featureKeys.add(featureKey);
      }
    }
  }
  return [...featureKeys].sort();
}

function buildNormalizationStats(
  samples: OfflineSample[],
  featureKeys: string[],
): Record<string, { mean: number; std: number }> {
  const valuesByKey = new Map<string, number[]>();
  for (const key of featureKeys) {
    valuesByKey.set(key, []);
  }

  for (const sample of samples) {
    for (const features of Object.values(sample.policyFeaturesByAction || {})) {
      for (const key of featureKeys) {
        valuesByKey.get(key)?.push(features[key] ?? 0);
      }
    }
  }

  const stats: Record<string, { mean: number; std: number }> = {};
  for (const key of featureKeys) {
    const values = valuesByKey.get(key) || [0];
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const variance = values.reduce((sum, value) => {
      const delta = value - mean;
      return sum + delta * delta;
    }, 0) / Math.max(1, values.length);
    stats[key] = {
      mean: Math.round(mean * 1000) / 1000,
      std: Math.max(0.001, Math.sqrt(variance)),
    };
  }
  return stats;
}

function normalizeFeatureValue(value: number, stats: { mean: number; std: number } | undefined): number {
  if (!stats || !Number.isFinite(stats.std) || stats.std <= 0) {
    return value;
  }
  return (value - stats.mean) / stats.std;
}

function buildLinearTrainingRows(
  samples: OfflineSample[],
  featureKeys: string[],
  normalizationStats: Record<string, { mean: number; std: number }>,
  winRateWeight: number,
  expectedScoreWeight: number,
  sampleWeights: Map<string, number> = new Map<string, number>(),
  skipStats?: { skippedFeatureCoverageRows: number },
): LinearTrainingRow[] {
  const rows: LinearTrainingRow[] = [];

  for (const sample of samples) {
    const oracle = sample.oracle;
    if (!oracle) {
      continue;
    }

    const oracleByCode = new Map(
      oracle.candidates.map((candidate) => [candidate.cards?.[0] || '', candidate]),
    );
    const actionFamily = getSampleActionFamily(sample);
    const stage = getSampleStage(sample);

    for (const [code, rawFeatures] of Object.entries(sample.policyFeaturesByAction || {})) {
      const oracleCandidate = oracleByCode.get(code);
      if (!oracleCandidate) {
        continue;
      }
      if (!hasCriticalPolicyFeatureCoverage(rawFeatures, actionFamily)) {
        if (skipStats) {
          skipStats.skippedFeatureCoverageRows += 1;
        }
        continue;
      }

      const normalizedFeatures: Record<string, number> = {};
      for (const key of featureKeys) {
        normalizedFeatures[key] = normalizeFeatureValue(rawFeatures[key] ?? 0, normalizationStats[key]);
      }

      rows.push({
        features: normalizedFeatures,
        objective: objectiveScore(oracleCandidate, winRateWeight, expectedScoreWeight),
        predictedWinRate: oracleCandidate.predictedWinRate,
        predictedExpectedScore: oracleCandidate.predictedExpectedScore,
        weight: Math.max(0.05, sampleWeights.get(sample.sampleId) ?? 1),
        sampleId: sample.sampleId,
        stage,
        actionFamily,
      });
    }
  }

  return rows;
}

function buildPairwiseTrainingRows(
  samples: OfflineSample[],
  featureKeys: string[],
  normalizationStats: Record<string, { mean: number; std: number }>,
  winRateWeight: number,
  expectedScoreWeight: number,
  sampleWeights: Map<string, number> = new Map<string, number>(),
  skipStats?: { skippedFeatureCoverageRows: number },
): LinearTrainingRow[] {
  const rows: LinearTrainingRow[] = [];

  for (const sample of samples) {
    const oracle = sample.oracle;
    if (!oracle || !oracle.candidates || oracle.candidates.length < 2) {
      continue;
    }

    const sampleWeight = Math.max(0.05, sampleWeights.get(sample.sampleId) ?? 1);
    const actionFamily = getSampleActionFamily(sample);
    const stage = getSampleStage(sample);
    const featuresByCode = sample.policyFeaturesByAction || {};
    const ranked = [...oracle.candidates]
      .map((candidate) => {
        const code = candidate.cards?.[0] || '';
        const features = featuresByCode[code];
        return {
          candidate,
          code,
          objective: objectiveScore(candidate, winRateWeight, expectedScoreWeight),
          features,
          hasCoverage: !!features && hasCriticalPolicyFeatureCoverage(features, actionFamily),
        };
      })
      .filter((item) => !!item.code && !!item.features && item.hasCoverage)
      .sort((left, right) => right.objective - left.objective);

    if (ranked.length < 2 && skipStats) {
      skipStats.skippedFeatureCoverageRows += 1;
    }

    let pairCount = 0;
    for (let i = 0; i < ranked.length; i += 1) {
      for (let j = i + 1; j < ranked.length; j += 1) {
        if (pairCount >= DEFAULT_MAX_PAIRWISE_ROWS_PER_SAMPLE) {
          break;
        }
        const left = ranked[i];
        const right = ranked[j];
        const objectiveGap = left.objective - right.objective;
        if (objectiveGap <= DEFAULT_PAIRWISE_MARGIN) {
          continue;
        }

        const deltaFeatures: Record<string, number> = {};
        for (const key of featureKeys) {
          const leftValue = normalizeFeatureValue(left.features?.[key] ?? 0, normalizationStats[key]);
          const rightValue = normalizeFeatureValue(right.features?.[key] ?? 0, normalizationStats[key]);
          deltaFeatures[key] = leftValue - rightValue;
        }

        rows.push({
          features: deltaFeatures,
          objective: objectiveGap,
          predictedWinRate: left.candidate.predictedWinRate - right.candidate.predictedWinRate,
          predictedExpectedScore: left.candidate.predictedExpectedScore - right.candidate.predictedExpectedScore,
          weight: sampleWeight * DEFAULT_PAIRWISE_WEIGHT,
          sampleId: sample.sampleId,
          stage,
          actionFamily,
        });
        pairCount += 1;
      }
      if (pairCount >= DEFAULT_MAX_PAIRWISE_ROWS_PER_SAMPLE) {
        break;
      }
    }
  }

  return rows;
}

function buildTargetStats(
  rows: LinearTrainingRow[],
  targetSelector: (row: LinearTrainingRow) => number,
): { mean: number; std: number } {
  if (rows.length === 0) {
    return { mean: 0, std: 1 };
  }

  let totalWeight = 0;
  let weightedSum = 0;
  for (const row of rows) {
    const weight = Math.max(0.01, row.weight || 1);
    totalWeight += weight;
    weightedSum += targetSelector(row) * weight;
  }
  const mean = weightedSum / Math.max(0.01, totalWeight);

  let weightedVariance = 0;
  for (const row of rows) {
    const weight = Math.max(0.01, row.weight || 1);
    const delta = targetSelector(row) - mean;
    weightedVariance += weight * delta * delta;
  }
  const variance = weightedVariance / Math.max(0.01, totalWeight);
  return {
    mean,
    std: Math.max(0.001, Math.sqrt(variance)),
  };
}

function fitLinearModel(
  rows: LinearTrainingRow[],
  featureKeys: string[],
  targetSelector: (row: LinearTrainingRow) => number,
  config: LinearFitConfig,
): {
  bias: number;
  weights: Record<string, number>;
  targetStats: { mean: number; std: number };
} {
  const targetStats = buildTargetStats(rows, targetSelector);
  const weights = new Array(featureKeys.length).fill(0);
  let bias = 0;
  if (rows.length === 0 || featureKeys.length === 0) {
    return {
      bias,
      weights: Object.fromEntries(featureKeys.map((key) => [key, 0])),
      targetStats,
    };
  }

  const { learningRate, l2, epochs } = config;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradients = new Array(featureKeys.length).fill(0);
    let biasGradient = 0;
    let totalRowWeight = 0;

    for (const row of rows) {
      const rowWeight = Math.max(0.01, row.weight || 1);
      const normalizedTarget = (targetSelector(row) - targetStats.mean) / targetStats.std;
      let prediction = bias;
      for (let index = 0; index < featureKeys.length; index += 1) {
        prediction += (row.features[featureKeys[index]] ?? 0) * weights[index];
      }

      const error = prediction - normalizedTarget;
      biasGradient += error * rowWeight;
      totalRowWeight += rowWeight;
      for (let index = 0; index < featureKeys.length; index += 1) {
        weightGradients[index] += error * (row.features[featureKeys[index]] ?? 0) * rowWeight;
      }
    }

    const rowCount = Math.max(0.01, totalRowWeight);
    bias -= (learningRate * biasGradient) / rowCount;
    for (let index = 0; index < featureKeys.length; index += 1) {
      const regularizedGradient = (weightGradients[index] / rowCount) + weights[index] * l2;
      weights[index] -= learningRate * regularizedGradient;
    }
  }

  return {
    bias: Math.round(bias * 1000) / 1000,
    weights: Object.fromEntries(
      featureKeys.map((key, index) => [key, Math.round(weights[index] * 1000) / 1000]),
    ),
    targetStats: {
      mean: Math.round(targetStats.mean * 1000) / 1000,
      std: Math.round(targetStats.std * 1000) / 1000,
    },
  };
}

function applyMonotonicWeightConstraints(weights: Record<string, number>): Record<string, number> {
  const constrained = { ...weights };
  for (const key of HARMFUL_NONPOSITIVE_FEATURES) {
    if ((constrained[key] ?? 0) > 0) {
      constrained[key] = 0;
    }
  }
  return constrained;
}

function buildArtifactFromRows(
  objectiveRows: LinearTrainingRow[],
  regressionRows: LinearTrainingRow[],
  featureKeys: string[],
  normalizationStats: Record<string, { mean: number; std: number }>,
  baseArtifact: PolicyArtifact,
  config: LinearFitConfig,
  policyVersion: string,
  trainingMeta: PolicyArtifact['trainingMeta'] = {},
): PolicyArtifact {
  const objectiveModel = fitLinearModel(objectiveRows, featureKeys, (row) => row.objective, config);
  const winRateModel = fitLinearModel(regressionRows, featureKeys, (row) => row.predictedWinRate, config);
  const expectedScoreModel = fitLinearModel(regressionRows, featureKeys, (row) => row.predictedExpectedScore, config);
  objectiveModel.weights = applyMonotonicWeightConstraints(objectiveModel.weights);
  winRateModel.weights = applyMonotonicWeightConstraints(winRateModel.weights);
  expectedScoreModel.weights = applyMonotonicWeightConstraints(expectedScoreModel.weights);

  return {
    ...baseArtifact,
    policyVersion,
    featureSchemaVersion: baseArtifact.featureSchemaVersion || 'discard-response-v2',
    generatedAt: new Date().toISOString(),
    scoreWeights: objectiveModel.weights,
    normalizationStats,
    objectiveBias: objectiveModel.bias,
    predictionWeights: {
      winRate: winRateModel.weights,
      expectedScore: expectedScoreModel.weights,
    },
    predictionBias: {
      winRate: winRateModel.bias,
      expectedScore: expectedScoreModel.bias,
    },
    predictionTargetStats: {
      winRate: winRateModel.targetStats,
      expectedScore: expectedScoreModel.targetStats,
    },
    trainingMeta: {
      ...baseArtifact.trainingMeta,
      ...trainingMeta,
      sampledDecisionCount: regressionRows.length,
      iteration: (baseArtifact.trainingMeta?.iteration || 0) + 1,
      learningRate: config.learningRate,
      l2: config.l2,
      epochs: config.epochs,
      monotonicConstraintVersion: MONOTONIC_CONSTRAINT_VERSION,
    },
  };
}

function predictNormalizedValue(
  features: Record<string, number>,
  weights: Record<string, number>,
  bias: number,
): number {
  let value = bias;
  for (const [key, weight] of Object.entries(weights)) {
    value += (features[key] ?? 0) * weight;
  }
  return value;
}

function buildStageAdjustmentsForHead(
  rows: LinearTrainingRow[],
  objectiveModel: { bias: number; weights: Record<string, number>; targetStats: { mean: number; std: number } },
  winRateModel: { bias: number; weights: Record<string, number>; targetStats: { mean: number; std: number } },
  expectedScoreModel: { bias: number; weights: Record<string, number>; targetStats: { mean: number; std: number } },
): Partial<Record<PolicyStage, PolicyHeadStageAdjustment>> {
  const aggregate = new Map<PolicyStage, { count: number; objectiveResidual: number; winRateResidual: number; expectedScoreResidual: number }>();
  for (const row of rows) {
    if (!row.stage) {
      continue;
    }
    const current = aggregate.get(row.stage) || {
      count: 0,
      objectiveResidual: 0,
      winRateResidual: 0,
      expectedScoreResidual: 0,
    };
    const objectiveTargetNorm = (row.objective - objectiveModel.targetStats.mean) / objectiveModel.targetStats.std;
    const objectivePredNorm = predictNormalizedValue(row.features, objectiveModel.weights, objectiveModel.bias);
    const winRateTargetNorm = (row.predictedWinRate - winRateModel.targetStats.mean) / winRateModel.targetStats.std;
    const winRatePredNorm = predictNormalizedValue(row.features, winRateModel.weights, winRateModel.bias);
    const expectedScoreTargetNorm =
      (row.predictedExpectedScore - expectedScoreModel.targetStats.mean) / expectedScoreModel.targetStats.std;
    const expectedScorePredNorm = predictNormalizedValue(
      row.features,
      expectedScoreModel.weights,
      expectedScoreModel.bias,
    );
    current.count += 1;
    current.objectiveResidual += objectiveTargetNorm - objectivePredNorm;
    current.winRateResidual += winRateTargetNorm - winRatePredNorm;
    current.expectedScoreResidual += expectedScoreTargetNorm - expectedScorePredNorm;
    aggregate.set(row.stage, current);
  }

  const adjustments: Partial<Record<PolicyStage, PolicyHeadStageAdjustment>> = {};
  for (const [stage, stats] of aggregate.entries()) {
    if (stats.count <= 0) {
      continue;
    }
    adjustments[stage] = {
      sampleCount: stats.count,
      objectiveBiasDelta: Math.round((stats.objectiveResidual / stats.count) * 1000) / 1000,
      predictionBiasDelta: {
        winRate: Math.round((stats.winRateResidual / stats.count) * 1000) / 1000,
        expectedScore: Math.round((stats.expectedScoreResidual / stats.count) * 1000) / 1000,
      },
    };
  }
  return adjustments;
}

function buildFamilyHeadModel(
  family: PolicyActionFamily,
  rows: LinearTrainingRow[],
  featureKeys: string[],
  config: LinearFitConfig,
): PolicyHeadModel {
  const objectiveModel = fitLinearModel(rows, featureKeys, (row) => row.objective, config);
  const winRateModel = fitLinearModel(rows, featureKeys, (row) => row.predictedWinRate, config);
  const expectedScoreModel = fitLinearModel(rows, featureKeys, (row) => row.predictedExpectedScore, config);
  objectiveModel.weights = applyMonotonicWeightConstraints(objectiveModel.weights);
  winRateModel.weights = applyMonotonicWeightConstraints(winRateModel.weights);
  expectedScoreModel.weights = applyMonotonicWeightConstraints(expectedScoreModel.weights);
  const stageAdjustments = buildStageAdjustmentsForHead(
    rows,
    objectiveModel,
    winRateModel,
    expectedScoreModel,
  );
  return {
    sampleCount: rows.length,
    activationMinSampleCount: 24,
    stageActivationMinSampleCount: 12,
    scoreWeights: objectiveModel.weights,
    objectiveBias: objectiveModel.bias,
    predictionWeights: {
      winRate: winRateModel.weights,
      expectedScore: expectedScoreModel.weights,
    },
    predictionBias: {
      winRate: winRateModel.bias,
      expectedScore: expectedScoreModel.bias,
    },
    predictionTargetStats: {
      winRate: winRateModel.targetStats,
      expectedScore: expectedScoreModel.targetStats,
    },
    stageAdjustments: family === 'discard' ? stageAdjustments : undefined,
  };
}

function scoreFeatureImportance(
  rows: LinearTrainingRow[],
  featureKey: string,
): number {
  if (rows.length === 0) {
    return 0;
  }

  let objectiveSignal = 0;
  let winRateSignal = 0;
  let expectedScoreSignal = 0;
  for (const row of rows) {
    const value = row.features[featureKey] ?? 0;
    objectiveSignal += Math.abs(value * row.objective);
    winRateSignal += Math.abs(value * row.predictedWinRate);
    expectedScoreSignal += Math.abs(value * row.predictedExpectedScore);
  }

  const denominator = Math.max(1, rows.length);
  return (objectiveSignal / denominator)
    + (winRateSignal / denominator) * 50
    + (expectedScoreSignal / denominator) * 0.5;
}

function selectFeatureKeys(
  rows: LinearTrainingRow[],
  featureKeys: string[],
  featureLimit?: number,
): string[] {
  if (!featureLimit || featureLimit <= 0 || featureLimit >= featureKeys.length) {
    return featureKeys;
  }

  return [...featureKeys]
    .map((key) => ({
      key,
      score: scoreFeatureImportance(rows, key),
    }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    .slice(0, featureLimit)
    .map((item) => item.key)
    .sort();
}

function splitTrainingSamples(samples: OfflineSample[]): {
  trainSamples: OfflineSample[];
  validationSamples: OfflineSample[];
} {
  if (samples.length < 8) {
    return {
      trainSamples: samples,
      validationSamples: samples,
    };
  }

  const validationSamples = samples.filter((_, index) => index % 5 === 0);
  const trainSamples = samples.filter((_, index) => index % 5 !== 0);
  return {
    trainSamples: trainSamples.length > 0 ? trainSamples : samples,
    validationSamples: validationSamples.length > 0 ? validationSamples : samples,
  };
}

function buildSampleFolds(samples: OfflineSample[], foldCount: number): OfflineSample[][] {
  const normalizedFoldCount = Math.max(1, Math.min(foldCount, samples.length));
  const folds = Array.from({ length: normalizedFoldCount }, () => [] as OfflineSample[]);
  samples.forEach((sample, index) => {
    folds[index % normalizedFoldCount].push(sample);
  });
  return folds.filter((fold) => fold.length > 0);
}

function compareReports(
  left: PolicyEvaluationReport,
  right: PolicyEvaluationReport,
): number {
  return left.winRateDelta - right.winRateDelta
    || left.expectedScoreDelta - right.expectedScoreDelta
    || (left.learnedOracleMatchRate ?? 0) - (right.learnedOracleMatchRate ?? 0)
    || left.totalSamples - right.totalSamples;
}

function averageReports(reports: PolicyEvaluationReport[]): PolicyEvaluationReport {
  const totalSamples = reports.reduce((sum, report) => sum + report.totalSamples, 0);
  const denominator = Math.max(1, reports.length);
  const actionFamilyAggregate = new Map<
    'discard' | 'response',
    {
      sampleCount: number;
      weightedWinRateDelta: number;
      weightedExpectedScoreDelta: number;
      weightedLearnedOracleMatchRate: number;
      weightedHeuristicOracleMatchRate: number;
    }
  >();

  for (const report of reports) {
    for (const summary of report.actionFamilySummary || []) {
      const current = actionFamilyAggregate.get(summary.name) || {
        sampleCount: 0,
        weightedWinRateDelta: 0,
        weightedExpectedScoreDelta: 0,
        weightedLearnedOracleMatchRate: 0,
        weightedHeuristicOracleMatchRate: 0,
      };
      current.sampleCount += summary.sampleCount;
      current.weightedWinRateDelta += summary.winRateDelta * summary.sampleCount;
      current.weightedExpectedScoreDelta += summary.expectedScoreDelta * summary.sampleCount;
      current.weightedLearnedOracleMatchRate += summary.learnedOracleMatchRate * summary.sampleCount;
      current.weightedHeuristicOracleMatchRate += summary.heuristicOracleMatchRate * summary.sampleCount;
      actionFamilyAggregate.set(summary.name, current);
    }
  }

  const actionFamilySummary = [...actionFamilyAggregate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, stats]) => {
      const familyDenominator = Math.max(1, stats.sampleCount);
      return {
        name,
        sampleCount: stats.sampleCount,
        winRateDelta: stats.weightedWinRateDelta / familyDenominator,
        expectedScoreDelta: stats.weightedExpectedScoreDelta / familyDenominator,
        learnedOracleMatchRate: stats.weightedLearnedOracleMatchRate / familyDenominator,
        heuristicOracleMatchRate: stats.weightedHeuristicOracleMatchRate / familyDenominator,
      };
    });

  return {
    policyVersion: reports[0]?.policyVersion || 'validation-aggregate',
    baselinePolicyVersion: reports[0]?.baselinePolicyVersion,
    benchmarkVersion: reports[0]?.benchmarkVersion,
    totalSamples,
    winRateDelta: reports.reduce((sum, report) => sum + report.winRateDelta, 0) / denominator,
    expectedScoreDelta: reports.reduce((sum, report) => sum + report.expectedScoreDelta, 0) / denominator,
    learnedOracleMatchRate: reports.reduce((sum, report) => sum + (report.learnedOracleMatchRate ?? 0), 0) / denominator,
    heuristicOracleMatchRate: reports.reduce((sum, report) => sum + (report.heuristicOracleMatchRate ?? 0), 0) / denominator,
    benchmarkSummary: [],
    actionFamilySummary: actionFamilySummary.length > 0 ? actionFamilySummary : undefined,
  };
}

export function trainPolicyArtifactFromSamples(
  samples: OfflineSample[],
  baseArtifact: PolicyArtifact = getActivePolicyArtifact(),
  options: Pick<
    OfflineTrainingOptions,
    | 'winRateWeight'
    | 'expectedScoreWeight'
    | 'maxResponseToDiscardRatio'
    | 'discardSampleWeight'
    | 'discardStageMinShare'
    | 'discardOpeningWeight'
    | 'discardMidgameWeight'
    | 'openingHeuristicDisagreementWeight'
    | 'midgameHeuristicDisagreementWeight'
    | 'hardExampleWeight'
  > = {},
): PolicyArtifact {
  if (samples.length === 0) {
    return {
      ...baseArtifact,
      policyVersion: `learned-v2-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      trainingMeta: {
        ...baseArtifact.trainingMeta,
        sampledDecisionCount: 0,
        retainedSampleCount: 0,
        filteredSampleCount: 0,
        lowSignalSampleCount: 0,
        lowSignalRatio: 0,
        pairwiseRowCount: 0,
        skippedFeatureCoverageSampleCount: 0,
        hardExampleSampleCount: 0,
        monotonicConstraintVersion: MONOTONIC_CONSTRAINT_VERSION,
        maxResponseToDiscardRatio: options.maxResponseToDiscardRatio,
        discardSampleWeight: options.discardSampleWeight,
        discardStageMinShare: options.discardStageMinShare,
        discardOpeningWeight: options.discardOpeningWeight,
        discardMidgameWeight: options.discardMidgameWeight,
        openingHeuristicDisagreementWeight: options.openingHeuristicDisagreementWeight,
        midgameHeuristicDisagreementWeight: options.midgameHeuristicDisagreementWeight,
        hardExampleWeight: options.hardExampleWeight,
      },
    };
  }

  const winRateWeight = options.winRateWeight ?? DEFAULT_POLICY_WIN_RATE_WEIGHT;
  const expectedScoreWeight = options.expectedScoreWeight ?? DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT;
  const sampledForTraining = selectTrainingSamplesBySignal(samples, {
    winRateWeight,
    expectedScoreWeight,
    maxResponseToDiscardRatio: options.maxResponseToDiscardRatio,
    discardSampleWeight: options.discardSampleWeight,
    discardStageMinShare: options.discardStageMinShare,
  });
  const trainingSamples = sampledForTraining.selectedSamples;
  const adjustedSampleWeights = new Map(sampledForTraining.sampleWeights);
  const hardExampleSummary = applyFamilyStageAndHardExampleWeights(
    trainingSamples,
    adjustedSampleWeights,
    baseArtifact,
    winRateWeight,
    expectedScoreWeight,
    options,
  );
  const skippedFeatureCoverageSampleCount = countLowCoverageSamples(trainingSamples);
  const featureKeys = buildFeatureKeys(trainingSamples);
  const normalizationStats = buildNormalizationStats(trainingSamples, featureKeys);
  const fullSkipStats = {
    skippedFeatureCoverageRows: 0,
  };
  const fullPointRows = buildLinearTrainingRows(
    trainingSamples,
    featureKeys,
    normalizationStats,
    winRateWeight,
    expectedScoreWeight,
    adjustedSampleWeights,
    fullSkipStats,
  );
  const fullPairwiseRows = buildPairwiseTrainingRows(
    trainingSamples,
    featureKeys,
    normalizationStats,
    winRateWeight,
    expectedScoreWeight,
    adjustedSampleWeights,
    fullSkipStats,
  );
  const fullObjectiveRows = [...fullPointRows, ...fullPairwiseRows];
  const foldCount = trainingSamples.length >= 18 ? 3 : trainingSamples.length >= 10 ? 2 : 1;
  const folds = buildSampleFolds(trainingSamples, foldCount);
  const featureLimitCandidates = (() => {
    const limits = new Set<number | undefined>([
      undefined,
      Math.min(featureKeys.length, 12),
      Math.min(featureKeys.length, 18),
    ]);
    return [...limits].filter((value, index, array) => array.indexOf(value) === index);
  })();
  const candidateConfigs: LinearFitConfig[] = [
    { learningRate: 0.03, l2: 0.0005, epochs: 240, featureLimit: undefined },
    { learningRate: 0.02, l2: 0.002, epochs: 260, featureLimit: undefined },
    { learningRate: 0.015, l2: 0.01, epochs: 320, featureLimit: undefined },
    { learningRate: 0.01, l2: 0.03, epochs: 360, featureLimit: undefined },
  ].flatMap((config) => featureLimitCandidates.map((featureLimit) => ({
    ...config,
    featureLimit,
  })));

  const baselineFoldReports = folds.map((fold) => evaluateLearnedVsHeuristic(
    fold.map(toPolicyEvaluationSample),
    baseArtifact,
    {
      winRateWeight,
      expectedScoreWeight,
    },
  ));
  const baselineValidationReport = averageReports(baselineFoldReports);
  let selectedConfig = candidateConfigs[0];
  let selectedReport: PolicyEvaluationReport | undefined;

  for (const [index, candidateConfig] of candidateConfigs.entries()) {
    const foldReports: PolicyEvaluationReport[] = [];

    for (let foldIndex = 0; foldIndex < folds.length; foldIndex += 1) {
      const validationSamples = folds[foldIndex];
      const trainSamples = folds
        .filter((_, currentFoldIndex) => currentFoldIndex !== foldIndex)
        .flat();
      const actualTrainSamples = trainSamples.length > 0 ? trainSamples : trainingSamples;
      const selectedTrainSamples = selectTrainingSamplesBySignal(actualTrainSamples, {
        winRateWeight,
        expectedScoreWeight,
        maxResponseToDiscardRatio: options.maxResponseToDiscardRatio,
        discardSampleWeight: options.discardSampleWeight,
        discardStageMinShare: options.discardStageMinShare,
      });
      const foldSampleWeights = new Map(selectedTrainSamples.sampleWeights);
      const foldHardExampleSummary = applyFamilyStageAndHardExampleWeights(
        selectedTrainSamples.selectedSamples,
        foldSampleWeights,
        baseArtifact,
        winRateWeight,
        expectedScoreWeight,
        options,
      );
      const foldSkipStats = {
        skippedFeatureCoverageRows: 0,
      };
      const trainPointRows = buildLinearTrainingRows(
        selectedTrainSamples.selectedSamples,
        featureKeys,
        normalizationStats,
        winRateWeight,
        expectedScoreWeight,
        foldSampleWeights,
        foldSkipStats,
      );
      const trainPairwiseRows = buildPairwiseTrainingRows(
        selectedTrainSamples.selectedSamples,
        featureKeys,
        normalizationStats,
        winRateWeight,
        expectedScoreWeight,
        foldSampleWeights,
        foldSkipStats,
      );
      const trainObjectiveRows = [...trainPointRows, ...trainPairwiseRows];
      const selectedFeatureKeys = selectFeatureKeys(
        trainObjectiveRows.length > 0 ? trainObjectiveRows : trainPointRows,
        featureKeys,
        candidateConfig.featureLimit,
      );
      const candidateArtifact = buildArtifactFromRows(
        trainObjectiveRows.length > 0 ? trainObjectiveRows : trainPointRows,
        trainPointRows,
        selectedFeatureKeys,
        normalizationStats,
        baseArtifact,
        candidateConfig,
        `learned-v2-validation-${index}-${foldIndex}`,
        {
          validationSampleCount: validationSamples.length,
          retainedSampleCount: selectedTrainSamples.selectedSamples.length,
          filteredSampleCount: Math.max(0, actualTrainSamples.length - selectedTrainSamples.selectedSamples.length),
          lowSignalSampleCount: selectedTrainSamples.signalSummary.lowSignalSamples,
          lowSignalRatio: selectedTrainSamples.signalSummary.lowSignalRatio,
          pairwiseRowCount: trainPairwiseRows.length,
          skippedFeatureCoverageSampleCount: countLowCoverageSamples(selectedTrainSamples.selectedSamples),
          hardExampleSampleCount: foldHardExampleSummary.hardExampleSampleCount,
        },
      );
      foldReports.push(evaluateLearnedVsHeuristic(
        validationSamples.map(toPolicyEvaluationSample),
        candidateArtifact,
        {
          winRateWeight,
          expectedScoreWeight,
        },
      ));
    }

    const candidateReport = averageReports(foldReports);
    if (!selectedReport || compareReports(candidateReport, selectedReport) > 0) {
      selectedConfig = candidateConfig;
      selectedReport = candidateReport;
    }
  }

  if (selectedReport && compareReports(selectedReport, baselineValidationReport) <= 0) {
    return {
      ...baseArtifact,
      trainingMeta: {
        ...baseArtifact.trainingMeta,
        sampledDecisionCount: samples.length,
        validationSampleCount: folds.length > 1
          ? folds.reduce((sum, fold) => sum + fold.length, 0) / folds.length
          : trainingSamples.length,
        retainedSampleCount: trainingSamples.length,
        filteredSampleCount: Math.max(0, samples.length - trainingSamples.length),
        lowSignalSampleCount: sampledForTraining.signalSummary.lowSignalSamples,
        lowSignalRatio: sampledForTraining.signalSummary.lowSignalRatio,
        pairwiseRowCount: fullPairwiseRows.length,
        skippedFeatureCoverageSampleCount,
        hardExampleSampleCount: hardExampleSummary.hardExampleSampleCount,
        monotonicConstraintVersion: MONOTONIC_CONSTRAINT_VERSION,
        maxResponseToDiscardRatio: options.maxResponseToDiscardRatio,
        discardSampleWeight: options.discardSampleWeight,
        discardStageMinShare: options.discardStageMinShare,
        discardOpeningWeight: options.discardOpeningWeight,
        discardMidgameWeight: options.discardMidgameWeight,
        openingHeuristicDisagreementWeight: options.openingHeuristicDisagreementWeight,
        midgameHeuristicDisagreementWeight: options.midgameHeuristicDisagreementWeight,
        hardExampleWeight: options.hardExampleWeight,
      },
    };
  }

  const selectedFeatureKeys = selectFeatureKeys(
    fullObjectiveRows.length > 0 ? fullObjectiveRows : fullPointRows,
    featureKeys,
    selectedConfig.featureLimit,
  );

  const finalArtifact = buildArtifactFromRows(
    fullObjectiveRows.length > 0 ? fullObjectiveRows : fullPointRows,
    fullPointRows,
    selectedFeatureKeys,
    normalizationStats,
    baseArtifact,
    selectedConfig,
    `learned-v2-${Date.now()}`,
    {
      validationSampleCount: folds.length > 1
        ? folds.reduce((sum, fold) => sum + fold.length, 0) / folds.length
        : trainingSamples.length,
      retainedSampleCount: trainingSamples.length,
      filteredSampleCount: Math.max(0, samples.length - trainingSamples.length),
      lowSignalSampleCount: sampledForTraining.signalSummary.lowSignalSamples,
      lowSignalRatio: sampledForTraining.signalSummary.lowSignalRatio,
      pairwiseRowCount: fullPairwiseRows.length,
      skippedFeatureCoverageSampleCount,
      hardExampleSampleCount: hardExampleSummary.hardExampleSampleCount,
    },
  );

  const familyHeads: PolicyArtifact['familyHeads'] = {};
  const discardObjectiveRows = fullObjectiveRows.filter((row) => row.actionFamily === 'discard');
  const discardRegressionRows = fullPointRows.filter((row) => row.actionFamily === 'discard');
  if (discardObjectiveRows.length >= 2 && discardRegressionRows.length >= 2) {
    familyHeads.discard = buildFamilyHeadModel(
      'discard',
      discardObjectiveRows.length > 0 ? discardObjectiveRows : discardRegressionRows,
      selectedFeatureKeys,
      selectedConfig,
    );
  }
  const responseObjectiveRows = fullObjectiveRows.filter((row) => row.actionFamily === 'response');
  const responseRegressionRows = fullPointRows.filter((row) => row.actionFamily === 'response');
  if (responseObjectiveRows.length >= 2 && responseRegressionRows.length >= 2) {
    familyHeads.response = buildFamilyHeadModel(
      'response',
      responseObjectiveRows.length > 0 ? responseObjectiveRows : responseRegressionRows,
      selectedFeatureKeys,
      selectedConfig,
    );
  }

  return {
    ...finalArtifact,
    featureSchemaVersion: Object.keys(familyHeads).length > 0
      ? 'discard-response-v2'
      : finalArtifact.featureSchemaVersion,
    familyHeads: Object.keys(familyHeads).length > 0 ? familyHeads : undefined,
    trainingMeta: {
      ...finalArtifact.trainingMeta,
      sampledDecisionCount: samples.length,
      retainedSampleCount: trainingSamples.length,
      filteredSampleCount: Math.max(0, samples.length - trainingSamples.length),
      lowSignalSampleCount: sampledForTraining.signalSummary.lowSignalSamples,
      lowSignalRatio: sampledForTraining.signalSummary.lowSignalRatio,
      pairwiseRowCount: fullPairwiseRows.length,
      skippedFeatureCoverageSampleCount,
      hardExampleSampleCount: hardExampleSummary.hardExampleSampleCount,
      monotonicConstraintVersion: MONOTONIC_CONSTRAINT_VERSION,
      maxResponseToDiscardRatio: options.maxResponseToDiscardRatio,
      discardSampleWeight: options.discardSampleWeight,
      discardStageMinShare: options.discardStageMinShare,
      discardOpeningWeight: options.discardOpeningWeight,
      discardMidgameWeight: options.discardMidgameWeight,
      openingHeuristicDisagreementWeight: options.openingHeuristicDisagreementWeight,
      midgameHeuristicDisagreementWeight: options.midgameHeuristicDisagreementWeight,
      hardExampleWeight: options.hardExampleWeight,
    },
  };
}

export function evaluateLearnedVsHeuristic(
  samples: PolicyEvaluationSample[],
  artifact: PolicyArtifact,
  options: Pick<OfflineTrainingOptions, 'winRateWeight' | 'expectedScoreWeight'> = {},
): PolicyEvaluationReport {
  const winRateWeight = options.winRateWeight ?? DEFAULT_POLICY_WIN_RATE_WEIGHT;
  const expectedScoreWeight = options.expectedScoreWeight ?? DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT;
  let learnedWin = 0;
  let heuristicWin = 0;
  let learnedScore = 0;
  let heuristicScore = 0;
  let learnedMatchCount = 0;
  let heuristicMatchCount = 0;
  let counted = 0;
  const familyStats = new Map<
    'discard' | 'response',
    {
      sampleCount: number;
      learnedWin: number;
      heuristicWin: number;
      learnedScore: number;
      heuristicScore: number;
      learnedMatchCount: number;
      heuristicMatchCount: number;
    }
  >();
  const benchmarkEntries: BenchmarkEvaluationEntry[] = [];

  for (const sample of samples) {
    const oracle = sample.oracle;
    if (!oracle) continue;
    counted += 1;
    const actionFamily = getSampleActionFamily(sample);
    const stage = inferPolicyStage(sample.turnCount || 0, sample.remainingDeckCards || 0);
    const oracleByCode = new Map(
      oracle.candidates.map((candidate) => [candidate.cards?.[0] || '', candidate]),
    );

    const learned = Object.entries(sample.policyFeaturesByAction || {})
      .map(([code, features]) => {
        const score = scorePolicyFeatures(features, artifact, {
          actionFamily,
          stage,
        });
        return {
          code,
          objective: computeLearnedPolicyObjective(score, { winRateWeight, expectedScoreWeight }),
          predictedWinRate: score.predictedWinRate,
          predictedExpectedScore: score.predictedExpectedScore,
          policyScore: score.policyScore,
        };
      })
      .sort((left, right) => compareLearnedPolicyCandidates(
        {
          predictedWinRate: left.predictedWinRate,
          predictedExpectedScore: left.predictedExpectedScore,
          policyScore: left.policyScore,
          baselinePriority: 0,
        },
        {
          predictedWinRate: right.predictedWinRate,
          predictedExpectedScore: right.predictedExpectedScore,
          policyScore: right.policyScore,
          baselinePriority: 0,
        },
        {
          winRateWeight,
          expectedScoreWeight,
        },
      ))[0];

    const heuristicCode = sample.heuristicTopOption || '';
    const learnedCode = learned?.code || '';
    const heuristicCandidate = oracleByCode.get(heuristicCode);
    const learnedCandidate = oracleByCode.get(learnedCode);
    if (heuristicCandidate) {
      heuristicWin += heuristicCandidate.predictedWinRate;
      heuristicScore += heuristicCandidate.predictedExpectedScore;
    }
    if (learnedCandidate) {
      learnedWin += learnedCandidate.predictedWinRate;
      learnedScore += learnedCandidate.predictedExpectedScore;
    }

    const rankedOracleCandidates = [...oracle.candidates].sort((left, right) => {
      return objectiveScore(right, winRateWeight, expectedScoreWeight)
        - objectiveScore(left, winRateWeight, expectedScoreWeight);
    });
    const oracleTop = rankedOracleCandidates[0];
    const familyName: 'discard' | 'response' = actionFamily;
    const family = familyStats.get(familyName) || {
      sampleCount: 0,
      learnedWin: 0,
      heuristicWin: 0,
      learnedScore: 0,
      heuristicScore: 0,
      learnedMatchCount: 0,
      heuristicMatchCount: 0,
    };
    family.sampleCount += 1;
    if (heuristicCandidate) {
      family.heuristicWin += heuristicCandidate.predictedWinRate;
      family.heuristicScore += heuristicCandidate.predictedExpectedScore;
    }
    if (learnedCandidate) {
      family.learnedWin += learnedCandidate.predictedWinRate;
      family.learnedScore += learnedCandidate.predictedExpectedScore;
    }
    benchmarkEntries.push({
      sampleId: sample.sampleId,
      category: categorizeBenchmarkSample({
        turnCount: sample.turnCount,
        remainingDeckCards: sample.remainingDeckCards,
      }),
      learnedTop: learnedCode,
      heuristicTop: heuristicCode,
      oracleTop: oracleTop?.cards?.[0],
      learnedWinRate: learnedCandidate?.predictedWinRate ?? 0,
      heuristicWinRate: heuristicCandidate?.predictedWinRate ?? 0,
      learnedExpectedScore: learnedCandidate?.predictedExpectedScore ?? 0,
      heuristicExpectedScore: heuristicCandidate?.predictedExpectedScore ?? 0,
      learnedMatchesOracle: !!oracleTop?.cards?.[0] && learnedCode === oracleTop.cards[0],
      heuristicMatchesOracle: !!oracleTop?.cards?.[0] && heuristicCode === oracleTop.cards[0],
    });
    if (!!oracleTop?.cards?.[0] && learnedCode === oracleTop.cards[0]) {
      learnedMatchCount += 1;
      family.learnedMatchCount += 1;
    }
    if (!!oracleTop?.cards?.[0] && heuristicCode === oracleTop.cards[0]) {
      heuristicMatchCount += 1;
      family.heuristicMatchCount += 1;
    }
    familyStats.set(familyName, family);
  }

  const denominator = Math.max(1, counted);
  const actionFamilySummary = [...familyStats.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, stats]) => {
      const familyDenominator = Math.max(1, stats.sampleCount);
      return {
        name,
        sampleCount: stats.sampleCount,
        winRateDelta: stats.learnedWin / familyDenominator - stats.heuristicWin / familyDenominator,
        expectedScoreDelta: stats.learnedScore / familyDenominator - stats.heuristicScore / familyDenominator,
        learnedOracleMatchRate: stats.learnedMatchCount / familyDenominator,
        heuristicOracleMatchRate: stats.heuristicMatchCount / familyDenominator,
      };
    });

  return {
    policyVersion: artifact.policyVersion,
    baselinePolicyVersion: 'heuristic-medium',
    totalSamples: counted,
    winRateDelta: learnedWin / denominator - heuristicWin / denominator,
    expectedScoreDelta: learnedScore / denominator - heuristicScore / denominator,
    learnedOracleMatchRate: learnedMatchCount / denominator,
    heuristicOracleMatchRate: heuristicMatchCount / denominator,
    benchmarkSummary: buildBenchmarkSummary(benchmarkEntries),
    actionFamilySummary: actionFamilySummary.length > 0 ? actionFamilySummary : undefined,
  };
}

export function evaluatePolicyGate(
  report: PolicyEvaluationReport,
  thresholds: PolicyEvaluationGateThreshold = {},
): PolicyEvaluationGate {
  const minSamples = thresholds.minSamples ?? 1;
  const minWinRateDelta = thresholds.minWinRateDelta ?? 0;
  const minExpectedScoreDelta = thresholds.minExpectedScoreDelta ?? 0;
  const minLearnedOracleMatchRate = thresholds.minLearnedOracleMatchRate;
  const minOracleMatchRateDelta = thresholds.minOracleMatchRateDelta;
  const minCategoryWinRateDelta = thresholds.minCategoryWinRateDelta;
  const minCategoryOracleMatchRateDelta = thresholds.minCategoryOracleMatchRateDelta;
  const minActionFamilyWinRateDelta = thresholds.minActionFamilyWinRateDelta;
  const minActionFamilyOracleMatchRateDelta = thresholds.minActionFamilyOracleMatchRateDelta;
  const requiredBenchmarkVersion = thresholds.requiredBenchmarkVersion;
  const reasons: string[] = [];

  if (report.totalSamples < minSamples) {
    reasons.push(`totalSamples ${report.totalSamples} < minSamples ${minSamples}`);
  }
  if (report.winRateDelta < minWinRateDelta) {
    reasons.push(`winRateDelta ${report.winRateDelta} < minWinRateDelta ${minWinRateDelta}`);
  }
  if (report.expectedScoreDelta < minExpectedScoreDelta) {
    reasons.push(`expectedScoreDelta ${report.expectedScoreDelta} < minExpectedScoreDelta ${minExpectedScoreDelta}`);
  }
  if (
    typeof minLearnedOracleMatchRate === 'number'
    && (report.learnedOracleMatchRate ?? 0) < minLearnedOracleMatchRate
  ) {
    reasons.push(
      `learnedOracleMatchRate ${report.learnedOracleMatchRate ?? 0} < minLearnedOracleMatchRate ${minLearnedOracleMatchRate}`,
    );
  }
  if (typeof minOracleMatchRateDelta === 'number') {
    const oracleMatchRateDelta = (report.learnedOracleMatchRate ?? 0) - (report.heuristicOracleMatchRate ?? 0);
    if (oracleMatchRateDelta < minOracleMatchRateDelta) {
      reasons.push(
        `oracleMatchRateDelta ${oracleMatchRateDelta} < minOracleMatchRateDelta ${minOracleMatchRateDelta}`,
      );
    }
  }
  if (minCategoryWinRateDelta && Object.keys(minCategoryWinRateDelta).length > 0) {
    for (const [category, threshold] of Object.entries(minCategoryWinRateDelta)) {
      if (!Number.isFinite(threshold)) {
        continue;
      }
      const categoryReport = report.benchmarkSummary.find((entry) => entry.name === category);
      if (!categoryReport) {
        reasons.push(`benchmarkSummary missing category ${category}`);
        continue;
      }
      if (categoryReport.winRateDelta < threshold) {
        reasons.push(
          `categoryWinRateDelta ${category} ${categoryReport.winRateDelta} < minCategoryWinRateDelta ${threshold}`,
        );
      }
    }
  }
  if (minCategoryOracleMatchRateDelta && Object.keys(minCategoryOracleMatchRateDelta).length > 0) {
    for (const [category, threshold] of Object.entries(minCategoryOracleMatchRateDelta)) {
      if (!Number.isFinite(threshold)) {
        continue;
      }
      const categoryReport = report.benchmarkSummary.find((entry) => entry.name === category);
      if (!categoryReport) {
        reasons.push(`benchmarkSummary missing category ${category}`);
        continue;
      }
      const categoryDelta = categoryReport.learnedOracleMatchRate - categoryReport.heuristicOracleMatchRate;
      if (categoryDelta < threshold) {
        reasons.push(
          `categoryOracleMatchRateDelta ${category} ${categoryDelta} < minCategoryOracleMatchRateDelta ${threshold}`,
        );
      }
    }
  }
  if (minActionFamilyWinRateDelta && Object.keys(minActionFamilyWinRateDelta).length > 0) {
    for (const [family, threshold] of Object.entries(minActionFamilyWinRateDelta)) {
      if (!Number.isFinite(threshold)) {
        continue;
      }
      const familyReport = report.actionFamilySummary?.find((entry) => entry.name === family);
      if (!familyReport) {
        if (threshold > 0) {
          reasons.push(`actionFamilySummary missing family ${family}`);
        }
        continue;
      }
      if (familyReport.winRateDelta < threshold) {
        reasons.push(
          `actionFamilyWinRateDelta ${family} ${familyReport.winRateDelta} < minActionFamilyWinRateDelta ${threshold}`,
        );
      }
    }
  }
  if (minActionFamilyOracleMatchRateDelta && Object.keys(minActionFamilyOracleMatchRateDelta).length > 0) {
    for (const [family, threshold] of Object.entries(minActionFamilyOracleMatchRateDelta)) {
      if (!Number.isFinite(threshold)) {
        continue;
      }
      const familyReport = report.actionFamilySummary?.find((entry) => entry.name === family);
      if (!familyReport) {
        if (threshold > 0) {
          reasons.push(`actionFamilySummary missing family ${family}`);
        }
        continue;
      }
      const familyDelta = familyReport.learnedOracleMatchRate - familyReport.heuristicOracleMatchRate;
      if (familyDelta < threshold) {
        reasons.push(
          `actionFamilyOracleMatchRateDelta ${family} ${familyDelta} < minActionFamilyOracleMatchRateDelta ${threshold}`,
        );
      }
    }
  }
  if (requiredBenchmarkVersion && report.benchmarkVersion !== requiredBenchmarkVersion) {
    reasons.push(
      `benchmarkVersion ${report.benchmarkVersion || 'undefined'} !== requiredBenchmarkVersion ${requiredBenchmarkVersion}`,
    );
  }

  return {
    passed: reasons.length === 0,
    minSamples,
    minWinRateDelta,
    minExpectedScoreDelta,
    minLearnedOracleMatchRate,
    minOracleMatchRateDelta,
    minCategoryWinRateDelta,
    minCategoryOracleMatchRateDelta,
    minActionFamilyWinRateDelta,
    minActionFamilyOracleMatchRateDelta,
    requiredBenchmarkVersion,
    reasons,
  };
}
