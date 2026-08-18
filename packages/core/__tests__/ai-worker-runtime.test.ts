import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-engine/game-manager';
import type { GameState } from '../src';
import {
  handleAIWorkerRequest,
  type AIWorkerAnalyzeRequest,
  type AIWorkerDecideRequest,
  type AIWorkerLoadPolicyArtifactRequest,
  type AIWorkerUnknownRequest,
} from '../src/worker';

describe('AI worker runtime', () => {
  const createState = (): GameState => {
    const manager = new GameManager();
    return manager.createGame({ playerCount: 3 }) as GameState;
  };

  it('handles decideWithTrace requests with structured success payload', async () => {
    const state = createState();
    const currentPlayerId = state.players[state.currentPlayerIndex].playerId;
    const request: AIWorkerDecideRequest = {
      id: 'req-decide-1',
      type: 'decideWithTrace',
      payload: {
        playerId: currentPlayerId,
        state,
        mode: 'learned',
      },
    };

    const response = await handleAIWorkerRequest(request);

    expect(response.id).toBe(request.id);
    expect(response.success).toBe(true);
    if (!response.success) {
      throw new Error('expected success response');
    }

    expect(response.type).toBe('decideWithTrace');
    expect(response.payload.action.playerId).toBe(currentPlayerId);
    expect(response.payload.trace.playerId).toBe(currentPlayerId);
    expect(response.payload.trace.chosenAction).toBeTruthy();
    expect(response.payload.trace.policySource).toBeTruthy();
  });

  it('handles analyze requests with recommendation payload', async () => {
    const state = createState();
    const request: AIWorkerAnalyzeRequest = {
      id: 'req-analyze-1',
      type: 'analyze',
      payload: {
        playerIndex: state.currentPlayerIndex,
        state,
        options: {
          policyMode: 'learned',
        },
      },
    };

    const response = await handleAIWorkerRequest(request);

    expect(response.id).toBe(request.id);
    expect(response.success).toBe(true);
    if (!response.success) {
      throw new Error('expected success response');
    }

    expect(response.type).toBe('analyze');
    expect(Array.isArray(response.payload.recommendations)).toBe(true);
    expect(response.payload.recommendations.length).toBeGreaterThanOrEqual(0);
    if (response.payload.recommendations.length > 0) {
      expect(response.payload.recommendations[0].action).toBeTruthy();
    }
  });

  it('loads a policy artifact through worker runtime', async () => {
    const request: AIWorkerLoadPolicyArtifactRequest = {
      id: 'req-policy-1',
      type: 'loadPolicyArtifact',
      payload: {
        artifact: {
          policyVersion: 'test-policy-v1',
          featureSchemaVersion: 'discard-v1',
          generatedAt: '2026-03-19T00:00:00.000Z',
          objective: 'dual_balanced',
          scoreWeights: {
            heuristic_priority: 1,
          },
        },
      },
    };

    const response = await handleAIWorkerRequest(request);

    expect(response.id).toBe(request.id);
    expect(response.success).toBe(true);
    if (!response.success) {
      throw new Error('expected success response');
    }

    expect(response.type).toBe('loadPolicyArtifact');
    expect(response.payload.policyVersion).toBe('test-policy-v1');
  });

  it('returns a structured error for unsupported requests', async () => {
    const request: AIWorkerUnknownRequest = {
      id: 'req-bad-1',
      type: 'unknown',
      payload: {},
    };

    const response = await handleAIWorkerRequest(request);

    expect(response.id).toBe(request.id);
    expect(response.success).toBe(false);
    if (response.success) {
      throw new Error('expected failure response');
    }

    expect(response.error.code).toBe('UNSUPPORTED_REQUEST');
    expect(response.error.message).toContain('unknown');
  });
});
