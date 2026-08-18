import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { GameManager } from '../src/game-engine/game-manager';
import { MeldDetector } from '../src/game-engine/meld-detector';
import { handleAIWorkerRequest } from '../src/worker/ai-worker-runtime';
import type { Card, GameConfig, GameState, PlayerAction } from '../src/shared/types';
import { normalizeGodotAction } from '../src/bridge/godot-action-guard';

export const GODOT_PROTOCOL_VERSION = 'daer-godot-v2';
// Bump when Bridge behavior changes without an HTTP schema change. Godot uses
// this to avoid silently connecting to an already-running older sidecar.
export const GODOT_RUNTIME_VERSION = 'daer-bridge-session-v6';

type AIDecisionMode = 'fast' | 'medium' | 'learned';
type AIWorkerRequest = typeof handleAIWorkerRequest;

export const GODOT_MAX_REQUEST_BYTES = 64 * 1024;

class BridgeRequestError extends Error {
  constructor(public readonly statusCode: 400 | 413 | 415, message: string) {
    super(message);
    this.name = 'BridgeRequestError';
  }
}

export interface GodotAiRuntimeServerOptions {
  requestAI?: AIWorkerRequest;
  /** Optional durable action-log snapshot. Omit in isolated tests. */
  persistenceFile?: string;
  /** Unique Godot run that owns this sidecar. */
  sessionId?: string;
  /** Injectable core clock for deterministic response-window tests. */
  clock?: () => number;
  /** Temporary per-Godot-session bearer token. Never log or expose it. */
  authToken?: string;
  /** Development-only switch that keeps response windows open for manual testing. */
  disableResponseTimeout?: boolean;
}

export type GodotParentAliveProbe = (processId: number) => boolean;

export function isGodotParentAlive(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

export function shouldTerminateForGodotParent(
  parentProcessId: number,
  isParentAlive: GodotParentAliveProbe = isGodotParentAlive,
): boolean {
  return Number.isSafeInteger(parentProcessId) && parentProcessId > 0 && !isParentAlive(parentProcessId);
}

export function isResponseTimeoutDisabled(value: unknown = process.env.DAER_DISABLE_RESPONSE_TIMEOUT): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export interface LockedHandMeldPresentation {
  id: string;
  type: 'triple' | 'quadruple';
  label: '坎' | '提';
  cardIds: string[];
  isConcealed: true;
  draggable: false;
}

export interface GodotHandPresentation {
  lockedHandMelds: LockedHandMeldPresentation[];
}

export interface GodotTransitionPresentation {
  sequence: number;
  actionType: PlayerAction['type'] | 'start';
  actorPlayerIndex: number;
  phaseBefore: GameState['phase'];
  phaseAfter: GameState['phase'];
  occurredAt: number;
}

export type GodotPresentedGameState = GameState & {
  handPresentation: GodotHandPresentation;
  activePlayerIndex: number;
  awaitingHumanInput: boolean;
  lastTransition?: GodotTransitionPresentation;
};

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > GODOT_MAX_REQUEST_BYTES) {
      request.resume();
      throw new BridgeRequestError(413, 'Request body is too large.');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BridgeRequestError(400, 'Request body must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BridgeRequestError(400, 'Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function stateSignature(gameState: GameState): string {
  return JSON.stringify({
    phase: gameState.phase,
    currentPlayerIndex: gameState.currentPlayerIndex,
    turnCount: gameState.turnCount,
    pendingCardSource: gameState.pendingCardSource,
    responder: gameState.responseWindow?.currentResponderIndex,
    responseWindowId: gameState.responseWindow?.id,
    deadlineAt: gameState.responseWindow?.deadlineAt,
    responses: gameState.responseWindow?.responses.length || 0,
    activeCard: gameState.discardPile.lastDiscard?.id,
    hands: gameState.players.map(player => player.cards.length),
    melds: gameState.players.map(player => player.melds.length),
    ruleVersion: gameState.ruleVersion,
    openingPhase: gameState.openingPhase,
    drawOrdinal: gameState.drawOrdinal,
    gameOver: gameState.isGameOver,
  });
}

function actingPlayerIndex(currentState: GameState): number {
  return currentState.phase === 'response_collecting' && typeof currentState.responseWindow?.currentResponderIndex === 'number'
    ? currentState.responseWindow.currentResponderIndex
    : currentState.currentPlayerIndex;
}

function aiMode(value: unknown): AIDecisionMode {
  return value === 'fast' || value === 'medium' || value === 'learned' ? value : 'learned';
}

/**
 * Presentation-only projection for Godot's local human hand. Rules remain
 * authoritative in GameState.availableActions and are never mutated here.
 */
export function buildGodotHandPresentation(currentState: GameState): GodotHandPresentation {
  const humanPlayer = currentState.players[0];
  if (!humanPlayer) return { lockedHandMelds: [] };

  const meldDetector = new MeldDetector();
  const quadruples = meldDetector.detectQuadruples(humanPlayer.cards).melds;
  const quadrupleIds = new Set(quadruples.flatMap((meld) => meld.cards.map((card) => card.id)));
  // A four-of-a-kind must only be presented as a 提, never again as a 坎.
  const triples = meldDetector.detectTriples(
    humanPlayer.cards.filter((card) => !quadrupleIds.has(card.id)),
  ).melds;
  const discardIds = new Set(
    currentState.availableActions
      .filter((action) => action.type === 'discard')
      .flatMap((action) => action.cards.map((card) => card.id)),
  );
  const toPresentation = (
    type: LockedHandMeldPresentation['type'],
    label: LockedHandMeldPresentation['label'],
    cards: Card[],
  ): LockedHandMeldPresentation => {
    const cardIds = cards.map((card) => card.id).sort();
    return {
      id: `${type}:${cardIds.join('|')}`,
      type,
      label,
      cardIds,
      isConcealed: true,
      draggable: false,
    };
  };

  const candidates = [
    ...quadruples.map((meld) => toPresentation('quadruple', '提', meld.cards)),
    ...triples.map((meld) => toPresentation('triple', '坎', meld.cards)),
  ];

  return {
    // The TurnManager intentionally opens every card as a deadlock fallback
    // when a whole hand is locked. In that state availableActions wins.
    lockedHandMelds: candidates.filter((meld) => meld.cardIds.every((id) => !discardIds.has(id))),
  };
}

function presentState(currentState: GameState, lastTransition?: GodotTransitionPresentation): GodotPresentedGameState {
  const activePlayerIndex = actingPlayerIndex(currentState);
  return {
    ...currentState,
    handPresentation: buildGodotHandPresentation(currentState),
    activePlayerIndex,
    awaitingHumanInput: !currentState.isGameOver && activePlayerIndex === 0 && currentState.availableActions.length > 0,
    lastTransition,
  };
}

function presentReplaySteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return steps.map((step) => {
    const rawState = step.state;
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return step;
    return { ...step, state: presentState(rawState as GameState, step.transition as GodotTransitionPresentation | undefined) };
  });
}

export function createGodotAiRuntimeServer(options: GodotAiRuntimeServerOptions = {}): Server {
  const manager = new GameManager(options.clock);
  const requestAI = options.requestAI || handleAIWorkerRequest;
  const sessionId = options.sessionId?.trim() || '';
  const responseTimeoutDisabled = options.disableResponseTimeout ?? isResponseTimeoutDisabled();
  const configuredAuthToken = options.authToken?.trim() || process.env.DAER_BRIDGE_TOKEN?.trim() || '';
  if (configuredAuthToken && Buffer.byteLength(configuredAuthToken, 'utf8') < 32) {
    throw new Error('Bridge auth token must contain at least 256 bits.');
  }
  const authToken = configuredAuthToken || randomBytes(32).toString('hex');
  let state: GameState | null = null;
  let gameConfig: Partial<GameConfig> | null = null;
  let actionLog: PlayerAction[] = [];
  let replaySteps: Array<Record<string, unknown>> = [];
  let lastTransition: GodotTransitionPresentation | undefined;
  let responseTimer: ReturnType<typeof setTimeout> | undefined;
  let scheduledTimeoutKey: string | undefined;

  function transitionFor(before: GameState, after: GameState, action: PlayerAction): GodotTransitionPresentation {
    const actorPlayerIndex = before.players.findIndex(player => player.playerId === action.playerId);
    return {
      sequence: actionLog.length + 1,
      actionType: action.type,
      actorPlayerIndex,
      phaseBefore: before.phase,
      phaseAfter: after.phase,
      occurredAt: action.timestamp,
    };
  }

  function persist(): void {
    if (!options.persistenceFile || !gameConfig || !state) return;
    mkdirSync(dirname(options.persistenceFile), { recursive: true });
    writeFileSync(options.persistenceFile, JSON.stringify({ version: 3, gameConfig, actionLog, state, replaySteps }, null, 2), 'utf8');
  }

  function clearResponseTimer(): void {
    if (responseTimer) clearTimeout(responseTimer);
    responseTimer = undefined;
    scheduledTimeoutKey = undefined;
  }

  function commitTransition(before: GameState, after: GameState, action: PlayerAction, decision?: unknown): void {
    lastTransition = transitionFor(before, after, action);
    state = after;
    actionLog.push(action);
    replaySteps.push({ state, action, ...(decision ? { decision } : {}), transition: lastTransition });
    persist();
  }

  function runResponseTimeout(): void {
    const current = state;
    const window = current?.responseWindow;
    if (!current || !window || typeof window.currentResponderIndex !== 'number') {
      clearResponseTimer();
      return;
    }

    const action: PlayerAction = {
      type: window.timeoutAction,
      playerId: current.players[window.currentResponderIndex].playerId,
      cards: [],
      timestamp: Date.now(),
      responseWindowId: window.id,
      isSystem: true,
    };
    const next = manager.processAction(current, action);
    if (stateSignature(current) === stateSignature(next)) {
      clearResponseTimer();
      return;
    }
    commitTransition(current, next, action);
    syncResponseTimer();
  }

  function syncResponseTimer(): void {
    if (responseTimeoutDisabled) {
      clearResponseTimer();
      return;
    }
    const window = state?.responseWindow;
    if (!window || typeof window.currentResponderIndex !== 'number') {
      clearResponseTimer();
      return;
    }

    const key = `${window.id}:${window.currentResponderIndex}:${window.timeoutAction}:${window.deadlineAt}`;
    if (key === scheduledTimeoutKey) return;
    clearResponseTimer();
    scheduledTimeoutKey = key;
    responseTimer = setTimeout(runResponseTimeout, Math.max(0, window.deadlineAt - Date.now()));
  }

  function restore(): void {
    if (!options.persistenceFile) return;
    let fallbackConfig: Partial<GameConfig> | undefined;
    try {
      const snapshot = JSON.parse(readFileSync(options.persistenceFile, 'utf8')) as {
        version?: number;
        gameConfig?: Partial<GameConfig>;
        actionLog?: PlayerAction[];
        replaySteps?: Array<Record<string, unknown>>;
      };
      if (snapshot.version !== 3 || !snapshot.gameConfig || typeof snapshot.gameConfig.ruleVersion !== 'string' || !Array.isArray(snapshot.actionLog)) return;
      fallbackConfig = snapshot.gameConfig;
      gameConfig = snapshot.gameConfig;
      state = manager.createGame(gameConfig);
      actionLog = [];
      replaySteps = Array.isArray(snapshot.replaySteps) ? snapshot.replaySteps : [{ state, action: { type: 'start', cards: [] } }];
      for (const loggedAction of snapshot.actionLog) {
        const normalized = normalizeGodotAction(state, loggedAction);
        if (!normalized) throw new Error('Persisted action is no longer legal');
        const next = manager.processAction(state, normalized);
        if (stateSignature(state) === stateSignature(next)) throw new Error('Persisted action no longer advances the game');
        lastTransition = transitionFor(state, next, normalized);
        state = next;
        actionLog.push(normalized);
      }
    } catch {
      if (fallbackConfig) {
        try {
          gameConfig = fallbackConfig;
          state = manager.createGame(gameConfig);
          actionLog = [];
          replaySteps = [{ state, action: { type: 'start', cards: [] } }];
          lastTransition = undefined;
          persist();
          return;
        } catch {
          // Fall through to the inactive state below if the config itself is unusable.
        }
      }
      state = null;
      gameConfig = null;
      actionLog = [];
      lastTransition = undefined;
    }
  }

  restore();
  syncResponseTimer();

  function requireState(): GameState {
    if (!state) throw new Error('No active game. Call /api/game/new first.');
    return state;
  }

  function actionForCurrentPlayer(raw: Record<string, unknown>): PlayerAction {
    const currentState = requireState();
    const current = currentState.players[actingPlayerIndex(currentState)];
    return {
      type: String(raw.type || 'pass') as PlayerAction['type'],
      playerId: String(raw.playerId || current.playerId),
      cards: Array.isArray(raw.cards) ? raw.cards as PlayerAction['cards'] : [],
      chiOptionId: typeof raw.chiOptionId === 'string' ? raw.chiOptionId : undefined,
      huOptionId: typeof raw.huOptionId === 'string' ? raw.huOptionId : undefined,
      timestamp: Date.now(),
      responseWindowId: typeof raw.responseWindowId === 'string' ? raw.responseWindowId : undefined,
      isSystem: raw.isSystem === true,
    };
  }

  function rejectFinishedGame(response: ServerResponse, currentState: GameState): boolean {
    if (!currentState.isGameOver) return false;
    sendJson(response, 409, { ok: false, error: 'Game is already over.', state: presentState(currentState) });
    return true;
  }

  async function decide(currentState: GameState, mode: AIDecisionMode) {
    const playerIndex = actingPlayerIndex(currentState);
    const player = currentState.players[playerIndex];
    const decisionState = playerIndex === currentState.currentPlayerIndex
      ? currentState
      : { ...currentState, currentPlayerIndex: playerIndex };
    const request = (requestedMode: AIDecisionMode) => requestAI({
      id: 'godot-ai-' + Date.now(), type: 'decideWithTrace',
      payload: { playerId: player.playerId, state: decisionState, mode: requestedMode },
    });
    let result = await request(mode);
    let fallbackReason = '';
    if ((!result.success || result.type !== 'decideWithTrace') && mode === 'learned') {
      fallbackReason = !result.success ? result.error.message : 'unexpected_learned_response';
      result = await request('medium');
    }
    if (!result.success || result.type !== 'decideWithTrace') {
      throw new Error(!result.success ? result.error.message : 'Unexpected AI response');
    }
    let normalized = normalizeGodotAction(currentState, result.payload.action);
    if (!normalized && mode === 'learned' && !fallbackReason) {
      fallbackReason = 'learned_illegal_action';
      result = await request('medium');
      if (!result.success || result.type !== 'decideWithTrace') {
        throw new Error(!result.success ? result.error.message : 'Medium fallback returned an unexpected response');
      }
      normalized = normalizeGodotAction(currentState, result.payload.action);
    }
    if (!normalized) {
      throw new Error('AI returned an action that is not legal in the current state.');
    }
    result.payload.action = normalized;
    // A learned request may legitimately be answered by the agent's own
    // heuristic/analysis fallback (for example, forced bao or hu choices).
    // Surface that transition to Godot instead of presenting it as learned.
    if (!fallbackReason && mode === 'learned' && result.payload.trace.policySource !== 'learned') {
      fallbackReason = 'learned_policy_fallback';
    }
    if (fallbackReason) {
      result.payload.trace.policySource = 'fallback';
      result.payload.trace.policyVersion = 'heuristic-baseline';
      result.payload.trace.legal.fallbackApplied = true;
      result.payload.trace.legal.fallbackReason = fallbackReason === 'learned_illegal_action'
        ? 'learned_illegal_action'
        : fallbackReason === 'learned_policy_fallback'
          ? 'learned_policy_fallback'
          : 'learned_runtime_failed';
      result.payload.trace.summary = fallbackReason === 'learned_illegal_action'
        ? '原版强化策略返回的动作与当前规则不匹配，已降级为规则分析。'
        : fallbackReason === 'learned_policy_fallback'
          ? '当前局面由规则分析接管，已选择当前合法动作。'
          : '原版强化策略不可用，已降级为规则分析：' + fallbackReason;
    }
    return result.payload;
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorization = request.headers.authorization || '';
    const providedToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    const expectedToken = Buffer.from(authToken, 'utf8');
    const actualToken = Buffer.from(providedToken, 'utf8');
    if (actualToken.length !== expectedToken.length || !timingSafeEqual(actualToken, expectedToken)) {
      sendJson(response, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, runtime: 'daer-core', protocolVersion: GODOT_PROTOCOL_VERSION, runtimeVersion: GODOT_RUNTIME_VERSION, sessionId, activeGame: !!state, responseTimeoutDisabled }); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/game/state') {
      sendJson(response, 200, { ok: true, state: presentState(requireState(), lastTransition) }); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/game/replay') {
      requireState();
      sendJson(response, 200, { ok: true, steps: presentReplaySteps(replaySteps) }); return;
    }
    if (request.method !== 'POST') { sendJson(response, 404, { ok: false, error: 'Not found' }); return; }
    const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      sendJson(response, 415, { ok: false, error: 'Content-Type must be application/json.' });
      return;
    }
    const body = await readJson(request);
    if (url.pathname === '/api/game/new') {
      const bottomCardCount = Number(body.bottomCardCount);
      const seed = typeof body.seed === 'number' ? body.seed : Math.floor(Math.random() * 0x7fffffff);
      const bottomCardCountValue = bottomCardCount === 0 ? 0 : bottomCardCount === 1 ? 1 : 2;
      actionLog = [];
      state = manager.createGame({ playerCount: 3, bottomCardCount: bottomCardCountValue, seed });
      gameConfig = { ...state.ruleProfile!, seed };
      lastTransition = {
        sequence: 0,
        actionType: 'start',
        actorPlayerIndex: actingPlayerIndex(state),
        phaseBefore: state.phase,
        phaseAfter: state.phase,
        occurredAt: Date.now(),
      };
      replaySteps = [{ state, action: { type: 'start', cards: [] }, transition: lastTransition }];
      persist();
      syncResponseTimer();
      sendJson(response, 200, { ok: true, state: presentState(state, lastTransition) }); return;
    }
    if (url.pathname === '/api/game/action') {
      const currentState = requireState();
      if (rejectFinishedGame(response, currentState)) return;
      if (!presentState(currentState).awaitingHumanInput) {
        sendJson(response, 409, { ok: false, error: 'The game is not waiting for the human player.', state: presentState(currentState) }); return;
      }
      if (currentState.responseWindow && body.responseWindowId !== currentState.responseWindow.id) {
        sendJson(response, 409, { ok: false, error: 'The response window is stale or missing.', state: presentState(currentState) }); return;
      }
      const action = normalizeGodotAction(currentState, actionForCurrentPlayer(body));
      if (!action) { sendJson(response, 400, { ok: false, error: 'Action is not legal in the current state.', state: presentState(currentState) }); return; }
      const next = manager.processAction(currentState, action);
      if (stateSignature(currentState) === stateSignature(next)) {
        sendJson(response, 409, { ok: false, error: 'The action did not advance the game.', state: presentState(currentState) }); return;
      }
      commitTransition(currentState, next, action);
      syncResponseTimer();
      sendJson(response, 200, { ok: true, state: presentState(state, lastTransition), action }); return;
    }
    if (url.pathname === '/api/game/timeout') {
      const currentState = requireState();
      if (rejectFinishedGame(response, currentState)) return;
      if (responseTimeoutDisabled) {
        sendJson(response, 409, { ok: false, error: 'Response timeout is disabled in test mode.', state: presentState(currentState) }); return;
      }
      const window = currentState.responseWindow;
      if (!window || typeof window.currentResponderIndex !== 'number') {
        sendJson(response, 409, { ok: false, error: 'There is no active response window.', state: presentState(currentState) }); return;
      }
      const requestedWindowId = typeof body.responseWindowId === 'string' ? body.responseWindowId : '';
      const requestedType = typeof body.type === 'string' ? body.type : window.timeoutAction;
      const action: PlayerAction = {
        type: requestedType as PlayerAction['type'],
        playerId: currentState.players[window.currentResponderIndex].playerId,
        cards: [],
        timestamp: Date.now(),
        responseWindowId: requestedWindowId,
        isSystem: true,
      };
      const next = manager.processAction(currentState, action);
      if (stateSignature(currentState) === stateSignature(next)) {
        sendJson(response, 409, { ok: false, error: 'The timeout action is stale, early, or not legal.', state: presentState(currentState) }); return;
      }
      commitTransition(currentState, next, action);
      syncResponseTimer();
      sendJson(response, 200, { ok: true, state: presentState(state, lastTransition), action }); return;
    }
    if (url.pathname === '/api/game/ai-step') {
      const currentState = requireState();
      if (rejectFinishedGame(response, currentState)) return;
      if (presentState(currentState).awaitingHumanInput) {
        sendJson(response, 409, { ok: false, error: 'The game is waiting for the human player.', state: presentState(currentState) }); return;
      }
      const decision = await decide(currentState, aiMode(body.mode));
      const action = decision.action;
      const next = manager.processAction(currentState, action);
      if (stateSignature(currentState) === stateSignature(next)) {
        sendJson(response, 409, { ok: false, error: 'The AI action did not advance the game.', state: presentState(currentState) }); return;
      }
      commitTransition(currentState, next, action, decision);
      syncResponseTimer();
      sendJson(response, 200, { ok: true, state: presentState(state, lastTransition), action, decision }); return;
    }
    if (url.pathname === '/api/game/advice') {
      const currentState = requireState();
      if (rejectFinishedGame(response, currentState)) return;
      const rawIndex = typeof body.playerIndex === 'number' ? body.playerIndex : currentState.currentPlayerIndex;
      const playerIndex = Math.max(0, Math.min(currentState.players.length - 1, rawIndex));
      const result = await handleAIWorkerRequest({
        id: 'godot-advice-' + Date.now(), type: 'analyze', payload: {
          playerIndex, state: currentState,
          options: { discardTopK: 1, chiOptionTopK: 1, policyMode: body.mode === 'learned' ? 'learned' : 'heuristic' },
        },
      });
      if (!result.success || result.type !== 'analyze') throw new Error(!result.success ? result.error.message : 'Unexpected analysis response');
      sendJson(response, 200, { ok: true, state: presentState(currentState, lastTransition), analysis: result.payload }); return;
    }
    sendJson(response, 404, { ok: false, error: 'Not found' });
  }

  const server = createServer((request, response) => {
    route(request, response).catch((error) => {
      if (error instanceof BridgeRequestError) {
        sendJson(response, error.statusCode, { ok: false, error: error.message });
        return;
      }
      sendJson(response, 500, { ok: false, error: 'Internal server error.' });
    });
  });
  server.on('close', clearResponseTimer);
  return server;
}
