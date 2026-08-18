import { AIAnalyzer } from '../src/ai/ai-analyzer';
import { gameSimulator } from '../src/game-engine/simulator';
import type { SelfPlayDatasetSample } from '../src/shared/types/ai';
import type { SimulationConfig } from '../src/shared/types/simulation';
import { cardToCode, createHeartbeatLogger, parseArgs, writeJsonFile } from './_common';

interface SelfPlayDataset {
  version: string;
  generatedAt: string;
  config: {
    games: number;
    seed: number;
    maxSamples: number;
    mode: 'fast' | 'medium' | 'learned';
  };
  samples: SelfPlayDatasetSample[];
}

function getArgNumber(value: string | number | boolean | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getArgString(value: string | number | boolean | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const games = getArgNumber(args.games, 24);
  const seed = getArgNumber(args.seed, 20260319);
  const maxSamples = getArgNumber(args.samples, 250);
  const output = getArgString(args.out, 'artifacts/selfplay-dataset.json');
  const mode = getArgString(args.mode, 'learned') as 'fast' | 'medium' | 'learned';
  const heartbeat = createHeartbeatLogger({ label: 'selfplay' });

  try {
    const analyzer = new AIAnalyzer();
    const samples: SelfPlayDatasetSample[] = [];

    for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
      heartbeat.update(`game ${gameIndex + 1}/${games} samples=${samples.length}/${maxSamples}`);
      const simulationConfig: SimulationConfig = {
      playerCount: 3,
      aiPlayers: [0, 1, 2],
      aiModeByPlayer: { 0: mode, 1: mode, 2: mode },
      seed: seed + gameIndex,
      recordHistory: true,
      maxTurns: 80,
    };

    const result = await gameSimulator.simulate(simulationConfig);
    for (let stepIndex = 0; stepIndex < result.history.length; stepIndex += 1) {
      if (samples.length >= maxSamples) break;

      const snapshot = result.history[stepIndex];
      const action = snapshot.action;
      if (action.type !== 'discard') continue;
      if (!action.cards || action.cards.length === 0) continue;

      const state = snapshot.state;
      const playerId = action.playerId;
      const playerIndex = state.players.findIndex((player) => player.playerId === playerId);
      if (playerIndex < 0) continue;

      const legalDiscards = (state.availableActions || [])
        .filter((item) => item.type === 'discard' && item.cards.length > 0)
        .map((item) => cardToCode(item.cards[0]));
      if (legalDiscards.length === 0) continue;

      const analysis = await analyzer.analyze(state, playerIndex, { discardTopK: 6 });
      const discardRecommendations = (analysis.recommendations || []).filter((item) => item.action === 'discard');
      const featuresByAction: Record<string, Record<string, number>> = {};
      let heuristicTopOption: string | undefined;
      let bestPriority = -Infinity;

      for (const recommendation of discardRecommendations) {
        const code = recommendation.card ? cardToCode(recommendation.card) : undefined;
        if (!code) continue;
        if (recommendation.policyFeatures) {
          featuresByAction[code] = recommendation.policyFeatures;
        }
        if (recommendation.priority > bestPriority) {
          bestPriority = recommendation.priority;
          heuristicTopOption = code;
        }
      }

      const stateSignature = [
        state.phase,
        state.turnCount,
        state.currentPlayerIndex,
        state.remainingDeckCards,
        legalDiscards.join(','),
      ].join('|');

      samples.push({
        sampleId: `g${gameIndex}_s${stepIndex}_${playerId}`,
        stateSignature,
        playerId,
        turnCount: state.turnCount,
        phase: state.phase,
        legalDiscards,
        heuristicTopOption,
        policyFeaturesByAction: Object.keys(featuresByAction).length > 0 ? featuresByAction : undefined,
      });
    }

      if (samples.length >= maxSamples) break;
    }

    const dataset: SelfPlayDataset = {
      version: 'selfplay-discard-dataset-v1',
      generatedAt: new Date().toISOString(),
      config: {
        games,
        seed,
        maxSamples,
        mode,
      },
      samples,
    };

    heartbeat.update('writing dataset output');
    writeJsonFile(output, dataset);
    console.log(`[selfplay] wrote ${samples.length} samples to ${output}`);
  } finally {
    heartbeat.stop();
  }
}

main().catch((error) => {
  console.error('[selfplay] failed', error);
  process.exit(1);
});
