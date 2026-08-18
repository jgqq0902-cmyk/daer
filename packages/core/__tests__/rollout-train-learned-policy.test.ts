import { describe, expect, it } from 'vitest';
import { buildConfig } from '../scripts/rollout-train-learned-policy';

describe('rollout-train-learned-policy defaults', () => {
  it('uses the quality-oriented default training profile', () => {
    const config = buildConfig([]);

    expect(config.selfPlayGames).toBe(120);
    expect(config.maxSamples).toBe(1200);
    expect(config.rolloutCountPerAction).toBe(16);
    expect(config.maxRolloutSteps).toBe(120);
    expect(config.oracleChunkSize).toBe(8);
    expect(config.oracleParallelism).toBe(4);
  });

  it('merges config file values with cli overrides', () => {
    const config = buildConfig([
      '--configFile=__tests__/fixtures/train-config.json',
      '--maxSamples=64',
    ]);

    expect(config.jobId).toBe('fixture-job');
    expect(config.outputDir).toBe('artifacts/fixture-train');
    expect(config.selfPlayGames).toBe(12);
    expect(config.maxSamples).toBe(64);
  });
});
