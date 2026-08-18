import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGodotHandPresentation, createGodotAiRuntimeServer, GODOT_PROTOCOL_VERSION, GODOT_RUNTIME_VERSION, shouldTerminateForGodotParent } from '../scripts/godot-ai-runtime-server';
import { handleAIWorkerRequest } from '../src/worker/ai-worker-runtime';
import { CardFactory } from '../src/shared/types/card';
import { GameManager } from '../src/game-engine/game-manager';

let server: Server | undefined;
let persistenceDir: string | undefined;
const TEST_TOKEN = 'a'.repeat(64);
const ROTATED_TEST_TOKEN = 'b'.repeat(64);

async function startServer(): Promise<string> {
  server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function startServerWithIllegalLearnedAction(): Promise<string> {
  server = createGodotAiRuntimeServer({
    authToken: TEST_TOKEN,
    requestAI: async (request) => {
      const result = await handleAIWorkerRequest(request);
      if (request.type === 'decideWithTrace' && request.payload.mode === 'learned' && result.success && result.type === 'decideWithTrace') {
        return {
          ...result,
          payload: {
            ...result.payload,
            action: { ...result.payload.action, type: 'discard', cards: [{ id: 'not-in-current-actions' }] },
          },
        };
      }
      return result;
    },
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function startServerWithHeuristicLearnedTrace(): Promise<string> {
  server = createGodotAiRuntimeServer({
    authToken: TEST_TOKEN,
    requestAI: async (request) => {
      const result = await handleAIWorkerRequest(request);
      if (request.type === 'decideWithTrace' && request.payload.mode === 'learned' && result.success && result.type === 'decideWithTrace') {
        return {
          ...result,
          payload: {
            ...result.payload,
            trace: { ...result.payload.trace, policySource: 'heuristic', policyVersion: 'heuristic-baseline' },
          },
        };
      }
      return result;
    },
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function request(baseUrl: string, path: string, body?: unknown, token: string | null = TEST_TOKEN) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    headers,
  });
  return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
}

function comparableState(state: Record<string, any>) {
  const copy = JSON.parse(JSON.stringify(state));
  for (const player of copy.players || []) {
    for (const passed of player.passedPlays || []) delete passed.timestamp;
  }
  return copy;
}

afterEach(async () => {
  vi.useRealTimers();
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  if (persistenceDir) rmSync(persistenceDir, { recursive: true, force: true });
  persistenceDir = undefined;
});

describe('Godot AI runtime Bridge', () => {
  it('publishes the session-aware runtime so Godot rejects stale Bridge bundles', async () => {
    const baseUrl = await startServer();
    const health = await request(baseUrl, '/health');

    expect(health.status).toBe(200);
    expect(health.body.runtimeVersion).toBe('daer-bridge-session-v6');
  });

  it('keeps response windows open when test mode disables the response timer', async () => {
    vi.useFakeTimers();
    server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN, disableResponseTimeout: true });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const health = await request(baseUrl, '/health');
    expect(health.body.responseTimeoutDisabled).toBe(true);

    const created = await request(baseUrl, '/api/game/new', { bottomCardCount: 2, seed: 20260818 });
    let current = created.body.state;
    for (let step = 0; step < 64 && !current.responseWindow; step += 1) {
      const offered = current.availableActions.find((action: Record<string, any>) => action.type !== 'pass') || current.availableActions[0];
      const result = current.awaitingHumanInput
        ? await request(baseUrl, '/api/game/action', {
            type: offered.type,
            cards: offered.cards,
            chiOptionId: offered.chiOptions?.[0]?.id,
            huOptionId: offered.huOptions?.[0]?.id,
            responseWindowId: current.responseWindow?.id,
          })
        : await request(baseUrl, '/api/game/ai-step', { mode: 'fast' });
      expect(result.status).toBe(200);
      current = result.body.state;
    }

    expect(current.responseWindow).toBeDefined();
    const windowId = current.responseWindow.id;
    await vi.advanceTimersByTimeAsync(60_000);
    const afterWait = await request(baseUrl, '/api/game/state');
    expect(afterWait.body.state.responseWindow?.id).toBe(windowId);
    expect(afterWait.body.state.lastTransition?.actionType).not.toMatch(/^timeout_/);
  });

  it('requires the current session token and does not opt into browser CORS', async () => {
    const baseUrl = await startServer();

    const missing = await request(baseUrl, '/health', undefined, null);
    expect(missing).toMatchObject({ status: 401, body: { ok: false, error: 'Unauthorized' } });

    const wrong = await request(baseUrl, '/api/game/new', { bottomCardCount: 2 }, ROTATED_TEST_TOKEN);
    expect(wrong).toMatchObject({ status: 401, body: { ok: false, error: 'Unauthorized' } });

    const preflight = await fetch(baseUrl + '/api/game/state', {
      method: 'OPTIONS',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(preflight.status).toBe(404);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects an old session token after the Bridge session rotates', async () => {
    server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN, sessionId: 'godot-old' });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));

    server = createGodotAiRuntimeServer({ authToken: ROTATED_TEST_TOKEN, sessionId: 'godot-new' });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    expect((await request(baseUrl, '/health', undefined, TEST_TOKEN)).status).toBe(401);
    expect((await request(baseUrl, '/health', undefined, ROTATED_TEST_TOKEN)).body.sessionId).toBe('godot-new');
  });

  it('bounds JSON input and rejects malformed or non-JSON bodies', async () => {
    const baseUrl = await startServer();
    const headers = {
      authorization: `Bearer ${TEST_TOKEN}`,
      'content-type': 'application/json',
    };

    const oversized = await fetch(baseUrl + '/api/game/new', {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: 'x'.repeat(70 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ ok: false, error: 'Request body is too large.' });

    const malformed = await fetch(baseUrl + '/api/game/new', {
      method: 'POST',
      headers,
      body: '{"bottomCardCount":',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ ok: false, error: 'Request body must be valid JSON.' });

    const arrayBody = await fetch(baseUrl + '/api/game/new', {
      method: 'POST',
      headers,
      body: '[]',
    });
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({ ok: false, error: 'Request body must be a JSON object.' });

    const wrongContentType = await fetch(baseUrl + '/api/game/new', {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(wrongContentType.status).toBe(415);
    expect(await wrongContentType.json()).toMatchObject({ ok: false, error: 'Content-Type must be application/json.' });
  });

  it('publishes the Godot session id so a new front end cannot reuse an older Bridge', async () => {
    server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN, sessionId: 'godot-8123-4567' });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const health = await request(baseUrl, '/health');

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ sessionId: 'godot-8123-4567' });
  });

  it('marks the Bridge for shutdown only when its Godot parent is gone', () => {
    expect(shouldTerminateForGodotParent(0, () => false)).toBe(false);
    expect(shouldTerminateForGodotParent(8123, () => true)).toBe(false);
    expect(shouldTerminateForGodotParent(8123, () => false)).toBe(true);
  });

  it('projects only rule-locked human melds for the hand presentation', () => {
    const state = new GameManager().createGame({ playerCount: 3, bottomCardCount: 2, seed: 20260812 });
    const triple = [CardFactory.create('三', 'small'), CardFactory.create('三', 'small'), CardFactory.create('三', 'small')];
    const pair = [CardFactory.create('四', 'small'), CardFactory.create('四', 'small')];
    const sequence = [CardFactory.create('五', 'small'), CardFactory.create('六', 'small'), CardFactory.create('七', 'small')];
    const legalDiscard = CardFactory.create('八', 'small');
    state.players[0].cards = [...triple, ...pair, ...sequence, legalDiscard];
    state.availableActions = [{ type: 'discard', cards: [legalDiscard], isMandatory: false, description: '出 八' }];

    expect(buildGodotHandPresentation(state).lockedHandMelds).toEqual([
      expect.objectContaining({ type: 'triple', label: '坎', cardIds: triple.map((card) => card.id).sort(), draggable: false }),
    ]);

    const quadruple = [CardFactory.create('玖', 'big'), CardFactory.create('玖', 'big'), CardFactory.create('玖', 'big'), CardFactory.create('玖', 'big')];
    state.players[0].cards = [...quadruple, legalDiscard];
    state.availableActions = [{ type: 'discard', cards: [legalDiscard], isMandatory: false, description: '出 八' }];
    expect(buildGodotHandPresentation(state).lockedHandMelds).toEqual([
      expect.objectContaining({ type: 'quadruple', label: '提', cardIds: quadruple.map((card) => card.id).sort() }),
    ]);

    // The core's all-locked deadlock fallback exposes the cards again. The UI
    // must follow availableActions and leave the display projection empty.
    state.availableActions = quadruple.map((card) => ({ type: 'discard' as const, cards: [card], isMandatory: false, description: '兜底出牌' }));
    expect(buildGodotHandPresentation(state).lockedHandMelds).toEqual([]);
  });

  it('restores an in-progress game by replaying the durable action log', async () => {
    persistenceDir = mkdtempSync(join(tmpdir(), 'daer-godot-state-'));
    const persistenceFile = join(persistenceDir, 'state.json');
    server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN, persistenceFile });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const firstUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const created = await request(firstUrl, '/api/game/new', { bottomCardCount: 2, seed: 20260812 });
    const discard = created.body.state.availableActions.find((action: Record<string, any>) => action.type === 'discard');
    const applied = await request(firstUrl, '/api/game/action', { type: 'discard', cards: [discard.cards[0]] });
    const expected = applied.body.state;
    const replayBeforeRestart = await request(firstUrl, '/api/game/replay');
    expect(replayBeforeRestart.status).toBe(200);
    expect(replayBeforeRestart.body.steps).toHaveLength(2);
    expect(replayBeforeRestart.body.steps[0].action.type).toBe('start');
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN, persistenceFile });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const restored = await request(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, '/api/game/state');
    expect(restored.status).toBe(200);
    expect(comparableState(restored.body.state)).toEqual(comparableState(expected));
    const replayAfterRestart = await request(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, '/api/game/replay');
    expect(replayAfterRestart.body.steps).toHaveLength(2);
    expect(comparableState(replayAfterRestart.body.steps[1].state)).toEqual(comparableState(expected));
  });

  it('falls back to the rule-valid opening state when a persisted action is no longer legal', async () => {
    persistenceDir = mkdtempSync(join(tmpdir(), 'daer-stale-state-'));
    const persistenceFile = join(persistenceDir, 'state.json');
    server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN, persistenceFile });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const firstUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const created = await request(firstUrl, '/api/game/new', { bottomCardCount: 2, seed: 20260818 });
    const snapshot = JSON.parse(readFileSync(persistenceFile, 'utf8')) as Record<string, any>;
    snapshot.actionLog.push({
      type: 'discard',
      playerId: snapshot.state.players[0].playerId,
      cards: [{ id: 'stale-card-no-longer-offered' }],
      timestamp: 1,
    });
    writeFileSync(persistenceFile, JSON.stringify(snapshot), 'utf8');
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));

    server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN, persistenceFile });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const restoredUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const health = await request(restoredUrl, '/health');
    const restored = await request(restoredUrl, '/api/game/state');
    const replay = await request(restoredUrl, '/api/game/replay');

    expect(health.body.activeGame).toBe(true);
    expect(restored.status).toBe(200);
    expect(restored.body.state.phase).toBe(created.body.state.phase);
    expect(restored.body.state.turnCount).toBe(created.body.state.turnCount);
    expect(replay.status).toBe(200);
    expect(replay.body.steps).toHaveLength(1);
    expect(replay.body.steps[0].action.type).toBe('start');
  });

  it('does not restore a pre-profile persistence snapshot', async () => {
    persistenceDir = mkdtempSync(join(tmpdir(), 'daer-old-state-'));
    const persistenceFile = join(persistenceDir, 'state.json');
    writeFileSync(persistenceFile, JSON.stringify({
      version: 2,
      gameConfig: { playerCount: 3, bottomCardCount: 2, seed: 20260818 },
      actionLog: [],
    }), 'utf8');

    server = createGodotAiRuntimeServer({ authToken: TEST_TOKEN, persistenceFile });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const health = await request(baseUrl, '/health');

    expect(health.body.activeGame).toBe(false);
  });

  it('uses the core state as the only action source and returns an AI decision trace', async () => {
    const baseUrl = await startServer();
    const health = await request(baseUrl, '/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, runtime: 'daer-core', protocolVersion: GODOT_PROTOCOL_VERSION, runtimeVersion: GODOT_RUNTIME_VERSION, activeGame: false });

    const created = await request(baseUrl, '/api/game/new', { playerCount: 4, bottomCardCount: 1, seed: 20260812 });
    expect(created.status).toBe(200);
    expect(created.body.state.players).toHaveLength(3);
    expect(created.body.state.remainingDeckCards).toBe(18);
    expect(created.body.state.lastTransition).toMatchObject({ sequence: 0, actionType: 'start' });

    const offeredDiscard = created.body.state.availableActions.find((action: Record<string, any>) => action.type === 'discard');
    const forged = { ...offeredDiscard.cards[0], value: 10, rank: '拾' };
    const applied = await request(baseUrl, '/api/game/action', { type: 'discard', cards: [forged] });
    expect(applied.status).toBe(200);
    expect(applied.body.action.cards[0]).toEqual(offeredDiscard.cards[0]);
    expect(applied.body.state.phase).toBe('drawing');
    expect(applied.body.state.awaitingHumanInput).toBe(false);
    expect(applied.body.state.lastTransition).toMatchObject({
      sequence: 1,
      actionType: 'discard',
      actorPlayerIndex: 0,
      phaseBefore: 'discarding',
      phaseAfter: 'drawing',
    });

    const aiStep = await request(baseUrl, '/api/game/ai-step', { mode: 'medium' });
    expect(aiStep.status).toBe(200);
    expect(aiStep.body.action.playerId).toBe(applied.body.state.players[applied.body.state.activePlayerIndex].playerId);
    expect(aiStep.body.decision.trace).toMatchObject({
      playerId: aiStep.body.action.playerId,
      chosenAction: aiStep.body.action.type,
      legal: { withinAvailableActions: true },
    });
    expect(aiStep.body.state).not.toEqual(applied.body.state);

    let currentState = aiStep.body.state;
    const traces = [aiStep.body.decision.trace];
    for (let step = 0; !currentState.isGameOver && step < 720; step += 1) {
      const offered = currentState.availableActions[0];
      const result = currentState.awaitingHumanInput
        ? await request(baseUrl, '/api/game/action', {
            type: offered.type,
            cards: offered.cards,
            chiOptionId: offered.chiOptions?.[0]?.id,
            huOptionId: offered.huOptions?.[0]?.id,
            responseWindowId: currentState.responseWindow?.id,
          })
        : await request(baseUrl, '/api/game/ai-step', { mode: 'medium' });
      expect(result.status).toBe(200);
      if (result.body.decision) {
        expect(result.body.decision.trace.legal.withinAvailableActions).toBe(true);
        traces.push(result.body.decision.trace);
      }
      currentState = result.body.state;
    }
    expect(currentState).toMatchObject({ isGameOver: true, phase: 'ended' });
    expect(traces.length).toBeGreaterThan(10);

    const terminalAiStep = await request(baseUrl, '/api/game/ai-step', { mode: 'medium' });
    expect(terminalAiStep).toMatchObject({
      status: 409,
      body: { ok: false, error: 'Game is already over.', state: { isGameOver: true, phase: 'ended' } },
    });
    const terminalAction = await request(baseUrl, '/api/game/action', { type: 'pass' });
    expect(terminalAction).toMatchObject({
      status: 409,
      body: { ok: false, error: 'Game is already over.', state: { isGameOver: true, phase: 'ended' } },
    });
    const terminalAdvice = await request(baseUrl, '/api/game/advice', { playerIndex: 0, mode: 'learned' });
    expect(terminalAdvice).toMatchObject({
      status: 409,
      body: { ok: false, error: 'Game is already over.', state: { isGameOver: true, phase: 'ended' } },
    });
  }, 45_000);

  it('runs the rule-conditioned fast policy inside the Bridge with an auditable trace', async () => {
    const baseUrl = await startServer();
    const created = await request(baseUrl, '/api/game/new', { bottomCardCount: 2, seed: 24680 });
    expect(created.status).toBe(200);

    const humanAction = created.body.state.availableActions[0];
    const afterHuman = await request(baseUrl, '/api/game/action', {
      type: humanAction.type,
      cards: humanAction.cards,
      chiOptionId: humanAction.chiOptions?.[0]?.id,
      huOptionId: humanAction.huOptions?.[0]?.id,
    });
    expect(afterHuman.status).toBe(200);

    const fastStep = await request(baseUrl, '/api/game/ai-step', { mode: 'fast' });
    expect(fastStep.status).toBe(200);
    expect(fastStep.body.decision.trace).toMatchObject({
      policySource: 'heuristic',
      policyVersion: 'rule-conditioned-fast-v1',
      chosenAction: fastStep.body.action.type,
      legal: { withinAvailableActions: true },
    });
    expect(fastStep.body.state).not.toEqual(afterHuman.body.state);

    const replay = await request(baseUrl, '/api/game/replay');
    expect(replay.body.steps).toHaveLength(3);
    expect(replay.body.steps[2].decision.trace.policySource).toBe('heuristic');
  });

  it('falls back to medium when learned returns an action outside the core snapshot', async () => {
    const baseUrl = await startServerWithIllegalLearnedAction();
    const created = await request(baseUrl, '/api/game/new', { bottomCardCount: 2, seed: 20260812 });
    const discard = created.body.state.availableActions.find((action: Record<string, any>) => action.type === 'discard');
    const response = await request(baseUrl, '/api/game/action', { type: 'discard', cards: discard.cards });
    expect(response.status).toBe(200);

    const aiStep = await request(baseUrl, '/api/game/ai-step', { mode: 'learned' });
    expect(aiStep.status).toBe(200);
    expect(aiStep.body.decision.trace).toMatchObject({
      policySource: 'fallback',
      legal: { withinAvailableActions: true, fallbackApplied: true, fallbackReason: 'learned_illegal_action' },
    });
    expect(aiStep.body.action.cards).not.toEqual([{ id: 'not-in-current-actions' }]);
  });

  it('audits an internal learned-policy fallback in the decision trace', async () => {
    const baseUrl = await startServerWithHeuristicLearnedTrace();
    const created = await request(baseUrl, '/api/game/new', { bottomCardCount: 2, seed: 20260812 });
    const discard = created.body.state.availableActions.find((action: Record<string, any>) => action.type === 'discard');
    await request(baseUrl, '/api/game/action', { type: 'discard', cards: discard.cards });

    const aiStep = await request(baseUrl, '/api/game/ai-step', { mode: 'learned' });
    expect(aiStep.status).toBe(200);
    expect(aiStep.body.decision.trace).toMatchObject({
      policySource: 'fallback',
      policyVersion: 'heuristic-baseline',
      legal: { withinAvailableActions: true, fallbackApplied: true, fallbackReason: 'learned_policy_fallback' },
    });
  });
});
