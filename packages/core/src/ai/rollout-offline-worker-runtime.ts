import { GameManager } from '../game-engine/game-manager';
import { GamePhase } from '../shared/types';
import { HandAnalyzer } from '../game-engine/hand-analyzer';
import { ScoreCalculator } from '../game-engine/score-calculator';
import { AIAnalyzer } from './ai-analyzer';
import { AIPlayerAgent } from './ai-player-agent';
import { WinRateCalculator } from './win-rate-calculator';
import {
  computePolicyObjective,
  DEFAULT_POLICY_EXPECTED_SCORE_WEIGHT,
  DEFAULT_POLICY_WIN_RATE_WEIGHT,
  type PolicyMode,
} from './policy-artifact';
import type {
  GameState,
  AvailableAction,
  Card,
  AIPlayRecommendation,
} from '../shared/types';
import type { PlayerAction } from '../shared/types/simulation';
import type {
  RolloutEvaluationCandidate,
  RolloutEvaluationResult,
} from '../shared/types/ai';
import { buildPolicyFeatures } from './policy-feature-builder';

const DEFAULT_MAX_ROLLOUT_STEPS = 120;

export interface OfflineSample {
  sampleId: string;
  stateSignature: string;
  playerId: string;
  playerIndex: number;
  turnCount: number;
  phase: GameState['phase'];
  remainingDeckCards: number;
  legalDiscards: string[];
  heuristicTopOption: string;
  policyFeaturesByAction: Record<string, Record<string, number>>;
  oracle?: RolloutEvaluationResult;
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
  oracleTopK?: number;
  earlyStopDelta?: number;
  oracleChunkSize?: number;
  oracleParallelism?: number;
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
    return { winSignal: 0, score: 0 };
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

export async function evaluateDiscardCandidatesWithRolloutsInWorker(
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

  let rolloutCandidates = allCandidates;
  let prunedCandidates: typeof allCandidates = [];
  if (oracleTopK && oracleTopK > 0 && allCandidates.length > oracleTopK) {
    const featuresByAction = sample.policyFeaturesByAction || {};
    const scored = allCandidates.map((candidate) => {
      const features = featuresByAction[candidate.key];
      const heuristicPriority = features?.heuristic_priority ?? features?.heuristicPriority ?? 0;
      return { ...candidate, heuristicPriority };
    }).sort((left, right) => right.heuristicPriority - left.heuristicPriority);
    rolloutCandidates = scored.slice(0, oracleTopK);
    prunedCandidates = scored.slice(oracleTopK);
  }

  const rolloutCount = options.rolloutCountPerAction;
  const earlyStopCheckInterval = earlyStopDelta ? Math.max(1, Math.ceil(rolloutCount / 3)) : rolloutCount;
  const actionRolloutResults: Map<number, ContinuationResult[]> = new Map();
  for (let actionIndex = 0; actionIndex < rolloutCandidates.length; actionIndex += 1) {
    actionRolloutResults.set(actionIndex, []);
  }

  for (let rolloutIndex = 0; rolloutIndex < rolloutCount; rolloutIndex += 1) {
    if (earlyStopDelta && rolloutIndex > 0 && rolloutIndex % earlyStopCheckInterval === 0 && rolloutCandidates.length > 1) {
      const winRates = [...actionRolloutResults.entries()].map(([idx, results]) => {
        const winSum = results.reduce((sum, result) => sum + result.winSignal, 0);
        return { idx, winRate: winSum / results.length };
      }).sort((left, right) => right.winRate - left.winRate);
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
      actionRolloutResults.get(actionIndex)?.push(result);
    }
  }

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
