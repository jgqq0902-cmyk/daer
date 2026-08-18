import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { GameSimulator } from '../src/game-engine/simulator';
import { AIPlayerAgent } from '../src/ai/ai-player-agent';
import type { GameState } from '../src/shared/types';

interface ABResult {
  wins: number;
  draws: number;
  winRate: number;
  durationMs: number;
}

interface LatencyResult {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

const runBenchmark = process.env.RUN_AI_BENCHMARK === '1';
const benchIt = runBenchmark ? it : it.skip;

function quantile(input: number[], percentile: number): number {
  if (input.length === 0) return 0;
  const sorted = [...input].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[rank];
}

type BenchAiMode = 'fast' | 'medium' | 'learned';

async function runABForSeat0(mode: BenchAiMode, games: number, seedBase: number): Promise<ABResult> {
  const simulator = new GameSimulator();
  let wins = 0;
  let draws = 0;
  const started = Date.now();

  for (let game = 0; game < games; game++) {
    const result = await simulator.simulate({
      playerCount: 3,
      aiPlayers: [0, 1, 2],
      aiModeByPlayer: {
        0: mode,
        1: 'fast',
        2: 'fast',
      },
      maxTurns: 140,
      seed: seedBase + game,
      recordHistory: false,
    });

    if (result.winnerIndex === 0) {
      wins += 1;
    } else if (result.winnerIndex === undefined) {
      draws += 1;
    }
  }

  return {
    wins,
    draws,
    winRate: wins / games,
    durationMs: Date.now() - started,
  };
}

async function collectDecisionSamples(sampleGames: number, seedBase: number, maxSamples: number): Promise<Array<{ state: GameState; playerId: string }>> {
  const simulator = new GameSimulator();
  const samples: Array<{ state: GameState; playerId: string }> = [];

  for (let game = 0; game < sampleGames && samples.length < maxSamples; game++) {
    const result = await simulator.simulate({
      playerCount: 3,
      aiPlayers: [0, 1, 2],
      aiModeByPlayer: {
        0: 'fast',
        1: 'fast',
        2: 'fast',
      },
      maxTurns: 80,
      seed: seedBase + game,
      recordHistory: true,
    });

    for (const entry of result.history) {
      if (!entry?.state || !entry?.action?.playerId) {
        continue;
      }

      samples.push({
        state: JSON.parse(JSON.stringify(entry.state)) as GameState,
        playerId: entry.action.playerId,
      });

      if (samples.length >= maxSamples) {
        break;
      }
    }
  }

  return samples;
}

async function measureLatency(
  mode: BenchAiMode,
  samples: Array<{ state: GameState; playerId: string }>,
): Promise<LatencyResult> {
  const agents = new Map<string, AIPlayerAgent>();
  const durations: number[] = [];

  for (const sample of samples) {
    const state = JSON.parse(JSON.stringify(sample.state)) as GameState;
    if (!agents.has(sample.playerId)) {
      agents.set(sample.playerId, new AIPlayerAgent(sample.playerId, { mode }));
    }
    const agent = agents.get(sample.playerId)!;

    const started = performance.now();
    await agent.decideWithTrace(state);
    durations.push(performance.now() - started);
  }

  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    count: durations.length,
    avg: durations.length > 0 ? total / durations.length : 0,
    p50: quantile(durations, 50),
    p95: quantile(durations, 95),
    max: durations.length > 0 ? Math.max(...durations) : 0,
  };
}

describe('AI benchmark (manual)', () => {
  benchIt('runs AB(5000) and latency sampling', async () => {
    const games = Number(process.env.AI_BENCH_GAMES || 5000);
    const seedBase = Number(process.env.AI_BENCH_SEED || 20260318);
    const latencySampleGames = Number(process.env.AI_BENCH_SAMPLE_GAMES || 120);
    const latencySampleCount = Number(process.env.AI_BENCH_SAMPLE_COUNT || 2500);
    const minLatencySamples = Number(process.env.AI_BENCH_MIN_LATENCY_SAMPLES || 250);
    const learnedP95BudgetMs = Number(process.env.AI_BENCH_LEARNED_P95_MS || 1000);
    const learnedMaxBudgetMs = Number(process.env.AI_BENCH_LEARNED_MAX_MS || 1500);
    const skipLatency = process.env.AI_BENCH_SKIP_LATENCY === '1';

    const baseline = await runABForSeat0('fast', games, seedBase);
    const variant = await runABForSeat0('medium', games, seedBase);
    const learned = await runABForSeat0('learned', games, seedBase);
    const winRateDelta = variant.winRate - baseline.winRate;
    const learnedWinRateDelta = learned.winRate - baseline.winRate;

    console.log('\n[AI-Benchmark]');
    console.log(`games=${games}, seedBase=${seedBase}`);
    console.log(`baseline_fast winRate=${(baseline.winRate * 100).toFixed(2)}% wins=${baseline.wins} draws=${baseline.draws} durationMs=${baseline.durationMs}`);
    console.log(`variant_medium winRate=${(variant.winRate * 100).toFixed(2)}% wins=${variant.wins} draws=${variant.draws} durationMs=${variant.durationMs}`);
    console.log(`variant_learned winRate=${(learned.winRate * 100).toFixed(2)}% wins=${learned.wins} draws=${learned.draws} durationMs=${learned.durationMs}`);
    console.log(`winRateDelta=${(winRateDelta * 100).toFixed(2)}%`);
    console.log(`learnedWinRateDelta=${(learnedWinRateDelta * 100).toFixed(2)}%`);

    let sampleCount = 0;
    if (!skipLatency) {
      const samples = await collectDecisionSamples(latencySampleGames, seedBase + 100000, latencySampleCount);
      const latencyFast = await measureLatency('fast', samples);
      const latencyMedium = await measureLatency('medium', samples);
      const latencyLearned = await measureLatency('learned', samples);
      const p95DeltaRate = latencyFast.p95 > 0
        ? (latencyFast.p95 - latencyMedium.p95) / latencyFast.p95
        : 0;

      sampleCount = samples.length;
      console.log(`latency_fast count=${latencyFast.count} avg=${latencyFast.avg.toFixed(2)}ms p50=${latencyFast.p50.toFixed(2)}ms p95=${latencyFast.p95.toFixed(2)}ms max=${latencyFast.max.toFixed(2)}ms`);
      console.log(`latency_medium count=${latencyMedium.count} avg=${latencyMedium.avg.toFixed(2)}ms p50=${latencyMedium.p50.toFixed(2)}ms p95=${latencyMedium.p95.toFixed(2)}ms max=${latencyMedium.max.toFixed(2)}ms`);
      console.log(`latency_learned count=${latencyLearned.count} avg=${latencyLearned.avg.toFixed(2)}ms p50=${latencyLearned.p50.toFixed(2)}ms p95=${latencyLearned.p95.toFixed(2)}ms max=${latencyLearned.max.toFixed(2)}ms`);
      console.log(`p95_drop_vs_fast=${(p95DeltaRate * 100).toFixed(2)}%`);

      expect(latencyFast.count).toBe(samples.length);
      expect(latencyMedium.count).toBe(samples.length);
      expect(latencyLearned.count).toBe(samples.length);
      expect(samples.length).toBeGreaterThanOrEqual(minLatencySamples);
      expect(latencyLearned.p95).toBeLessThan(learnedP95BudgetMs);
      expect(latencyLearned.max).toBeLessThan(learnedMaxBudgetMs);
    } else {
      console.log('latency_sampling=skipped');
    }

    expect(baseline.wins + baseline.draws).toBeLessThanOrEqual(games);
    expect(variant.wins + variant.draws).toBeLessThanOrEqual(games);
    expect(learned.wins + learned.draws).toBeLessThanOrEqual(games);
    if (!skipLatency) {
      expect(sampleCount).toBeGreaterThan(0);
    }
  }, 60 * 60 * 1000);
});
