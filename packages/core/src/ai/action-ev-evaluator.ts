import { GameState } from '../shared/types';
import type { ActionScoreBreakdown } from './types';

interface EvaluateEVParams {
  gameState?: GameState;
  playerIndex?: number;
  beforeSteps?: number;
  afterSteps?: number;
  beforeUkeire?: number;
  afterUkeire?: number;
  beforeScorePotential?: number;
  afterScorePotential?: number;
  dangerScore?: number;
}

export class ActionEvEvaluator {
  evaluate(params: EvaluateEVParams): ActionScoreBreakdown {
    const beforeSteps = params.beforeSteps ?? 3;
    const afterSteps = params.afterSteps ?? beforeSteps;
    const beforeUkeire = params.beforeUkeire ?? 0;
    const afterUkeire = params.afterUkeire ?? beforeUkeire;
    const beforeScorePotential = params.beforeScorePotential ?? 0;
    const afterScorePotential = params.afterScorePotential ?? beforeScorePotential;
    const dangerScore = Math.max(0, params.dangerScore ?? 0);
    const emergencyDefense = this.shouldEmergencyDefend(params.gameState, params.playerIndex, beforeSteps);

    const shantenDelta = beforeSteps - afterSteps;
    const shantenReward = shantenDelta > 0 ? shantenDelta * 800 : shantenDelta < 0 ? shantenDelta * 500 : 0;

    const ukeireDelta = afterUkeire - beforeUkeire;
    const ukeireReward = ukeireDelta * 10 + Math.max(0, afterUkeire) * 0.6;

    const scoreDelta = afterScorePotential - beforeScorePotential;
    const crossed10 = beforeScorePotential < 10 && afterScorePotential >= 10 ? 50 : 0;
    const crossed20 = beforeScorePotential < 20 && afterScorePotential >= 20 ? 50 : 0;
    const scoreBonus = scoreDelta * 2 + crossed10 + crossed20;

    const riskWeight = emergencyDefense
      ? 1.4
      : 0.08 + 0.27 / (1 + Math.exp(-0.12 * (dangerScore - 55)));
    const dangerPenalty = dangerScore * riskWeight;

    return {
      shantenReward,
      ukeireReward,
      scoreBonus,
      dangerPenalty,
      total: shantenReward + ukeireReward + scoreBonus - dangerPenalty,
      emergencyDefense,
    };
  }

  private shouldEmergencyDefend(gameState?: GameState, playerIndex?: number, beforeSteps: number = 3): boolean {
    if (!gameState || playerIndex === undefined) {
      return false;
    }

    if (beforeSteps < 2) {
      return false;
    }

    return gameState.players.some((player, index) => {
      if (index === playerIndex) {
        return false;
      }
      const exposedHu = (player.melds || []).reduce((sum, meld) => sum + (meld.huPoints || 0), 0);
      const matureShape = (player.melds?.length || 0) >= 3 || (player.cards?.length || 0) <= 6 || !!player.isBao;
      return exposedHu >= 15 && matureShape;
    });
  }
}