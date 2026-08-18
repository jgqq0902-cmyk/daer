import { AIAnalyzer } from '../ai/ai-analyzer';
import { AIPlayerAgent } from '../ai/ai-player-agent';
import { loadPolicyArtifact, resetPolicyArtifact } from '../ai/policy-artifact';
import type { GameState, AIAnalysis, AIDecisionTrace } from '../shared/types';
import type { PolicyArtifact } from '../shared/types/ai';
import type { PlayerAction } from '../shared/types/simulation';

export interface AIWorkerDecideRequest {
  id: string;
  type: 'decideWithTrace';
  payload: {
    playerId: string;
    state: GameState;
    mode?: 'fast' | 'medium' | 'learned';
  };
}

export interface AIWorkerAnalyzeRequest {
  id: string;
  type: 'analyze';
  payload: {
    playerIndex: number;
    state: GameState;
    options?: {
      simulationCount?: number;
      maxTime?: number;
      discardTopK?: number;
      chiOptionTopK?: number;
      policyMode?: 'heuristic' | 'learned';
    };
  };
}

export interface AIWorkerLoadPolicyArtifactRequest {
  id: string;
  type: 'loadPolicyArtifact';
  payload?: {
    artifact?: PolicyArtifact;
    resetToDefault?: boolean;
  };
}

export interface AIWorkerReadyRequest {
  id: string;
  type: 'ready';
  payload?: Record<string, never>;
}

export interface AIWorkerUnknownRequest {
  id: string;
  type: string;
  payload?: unknown;
}

export type AIWorkerRequest =
  | AIWorkerDecideRequest
  | AIWorkerAnalyzeRequest
  | AIWorkerLoadPolicyArtifactRequest
  | AIWorkerReadyRequest
  | AIWorkerUnknownRequest;

function isDecideRequest(request: AIWorkerRequest): request is AIWorkerDecideRequest {
  return request.type === 'decideWithTrace';
}

function isAnalyzeRequest(request: AIWorkerRequest): request is AIWorkerAnalyzeRequest {
  return request.type === 'analyze';
}

function isLoadPolicyArtifactRequest(request: AIWorkerRequest): request is AIWorkerLoadPolicyArtifactRequest {
  return request.type === 'loadPolicyArtifact';
}

export interface AIWorkerErrorPayload {
  code: 'UNSUPPORTED_REQUEST' | 'REQUEST_FAILED';
  message: string;
}

export interface AIWorkerDecideSuccessResponse {
  id: string;
  type: 'decideWithTrace';
  success: true;
  payload: {
    action: PlayerAction;
    trace: AIDecisionTrace;
  };
}

export interface AIWorkerAnalyzeSuccessResponse {
  id: string;
  type: 'analyze';
  success: true;
  payload: AIAnalysis;
}

export interface AIWorkerReadySuccessResponse {
  id: string;
  type: 'ready';
  success: true;
  payload: {
    ready: true;
  };
}

export interface AIWorkerLoadPolicyArtifactSuccessResponse {
  id: string;
  type: 'loadPolicyArtifact';
  success: true;
  payload: {
    policyVersion: string;
  };
}

export interface AIWorkerErrorResponse {
  id: string;
  type: string;
  success: false;
  error: AIWorkerErrorPayload;
}

export type AIWorkerResponse =
  | AIWorkerDecideSuccessResponse
  | AIWorkerAnalyzeSuccessResponse
  | AIWorkerLoadPolicyArtifactSuccessResponse
  | AIWorkerReadySuccessResponse
  | AIWorkerErrorResponse;

const aiAgentPool = new Map<string, AIPlayerAgent>();
let sharedAnalyzer: AIAnalyzer | null = null;

function getAIAnalyzer(): AIAnalyzer {
  if (!sharedAnalyzer) {
    sharedAnalyzer = new AIAnalyzer();
  }
  return sharedAnalyzer;
}

function getOrCreateAIAgent(playerId: string, mode: 'fast' | 'medium' | 'learned' = 'learned'): AIPlayerAgent {
  const cacheKey = `${playerId}:${mode}`;
  const cached = aiAgentPool.get(cacheKey);
  if (cached) {
    return cached;
  }

  const created = new AIPlayerAgent(playerId, { mode });
  aiAgentPool.set(cacheKey, created);
  return created;
}

export async function handleAIWorkerRequest(request: AIWorkerRequest): Promise<AIWorkerResponse> {
  try {
    if (request.type === 'ready') {
      return {
        id: request.id,
        type: 'ready',
        success: true,
        payload: { ready: true },
      };
    }

    if (isDecideRequest(request)) {
      const agent = getOrCreateAIAgent(request.payload.playerId, request.payload.mode || 'learned');
      const result = await agent.decideWithTrace(request.payload.state);
      return {
        id: request.id,
        type: 'decideWithTrace',
        success: true,
        payload: result,
      };
    }

    if (isAnalyzeRequest(request)) {
      const analyzer = getAIAnalyzer();
      const analysis = await analyzer.analyze(
        request.payload.state,
        request.payload.playerIndex,
        request.payload.options,
      );
      return {
        id: request.id,
        type: 'analyze',
        success: true,
        payload: analysis,
      };
    }

    if (isLoadPolicyArtifactRequest(request)) {
      const artifact = request.payload?.resetToDefault
        ? resetPolicyArtifact()
        : loadPolicyArtifact(request.payload?.artifact);
      return {
        id: request.id,
        type: 'loadPolicyArtifact',
        success: true,
        payload: {
          policyVersion: artifact.policyVersion,
        },
      };
    }

    return {
      id: request.id,
      type: request.type,
      success: false,
      error: {
        code: 'UNSUPPORTED_REQUEST',
        message: `Unsupported AI worker request: ${request.type}`,
      },
    };
  } catch (error) {
    return {
      id: request.id,
      type: request.type,
      success: false,
      error: {
        code: 'REQUEST_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function createAIWorkerMessageHandler(postMessage: (response: AIWorkerResponse) => void) {
  return async (request: AIWorkerRequest) => {
    const response = await handleAIWorkerRequest(request);
    postMessage(response);
    return response;
  };
}
