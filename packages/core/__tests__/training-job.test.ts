import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createTrainingJobTracker,
  readTrainingJobStatus,
  requestTrainingJobCancel,
} from '../scripts/training-job';
import {
  buildManagedTrainingConfig,
  buildTrainingCommand,
} from '../scripts/manage-training-job';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'daer-train-job-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('training job tracking', () => {
  it('writes durable status and event files as progress changes', () => {
    const outputDir = makeTempDir();
    const tracker = createTrainingJobTracker({
      outputDir,
      jobId: 'train-test',
      name: 'test-job',
      initialPhase: 'sampling',
    });

    tracker.update({
      phase: 'oracle',
      message: 'oracle progress 2/4',
      progress: {
        sampledDecisionCount: 4,
        oracleCompletedSamples: 2,
        oracleTotalSamples: 4,
      },
    });
    tracker.complete({ message: 'done' });

    const status = readTrainingJobStatus(outputDir);
    expect(status.state).toBe('completed');
    expect(status.phase).toBe('completed');
    expect(status.progress?.oracleCompletedSamples).toBe(2);
    expect(readFileSync(tracker.eventsFile, 'utf8')).toContain('"type":"completed"');
  });

  it('records cancellation through a durable cancel marker', () => {
    const outputDir = makeTempDir();
    const tracker = createTrainingJobTracker({ outputDir, jobId: 'train-cancel' });
    requestTrainingJobCancel(outputDir, 'test cancel');

    expect(() => tracker.assertNotCancelled()).toThrow(/cancelled/);
    expect(readTrainingJobStatus(outputDir).state).toBe('cancelled');
  });

  it('builds managed config and detached training command', () => {
    const config = buildManagedTrainingConfig({
      outputDir: 'artifacts/custom-train',
      oracleParallelism: 4,
      maxSamples: 1400,
      maxSampleResponseToDiscardRatio: 0.5,
      maxResponseToDiscardRatio: 0.7,
      discardSampleWeight: 1.6,
      discardStageMinShare: 0.3,
      discardOpeningWeight: 1.9,
      openingHeuristicDisagreementWeight: 3.2,
      hardExampleWeight: 2.4,
    });
    const command = buildTrainingCommand('artifacts/custom-train/training-config.json');

    expect(config.samplePhase).toBe('all');
    expect(config.oracleParallelism).toBe(4);
    expect(config.maxSamples).toBe(1400);
    expect(config.maxSampleResponseToDiscardRatio).toBe(0.5);
    expect(config.maxResponseToDiscardRatio).toBe(0.7);
    expect(config.discardSampleWeight).toBe(1.6);
    expect(config.discardStageMinShare).toBe(0.3);
    expect(config.discardOpeningWeight).toBe(1.9);
    expect(config.openingHeuristicDisagreementWeight).toBe(3.2);
    expect(config.hardExampleWeight).toBe(2.4);
    expect(command.join(' ')).toContain('rollout-train-learned-policy.ts');
    expect(command.join(' ')).toContain('--resume');
  });
});
