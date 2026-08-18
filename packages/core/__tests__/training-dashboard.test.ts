import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTrainingDashboardSnapshot,
  renderTrainingDashboard,
} from '../scripts/training-dashboard-server';
import { createTrainingJobTracker } from '../scripts/training-job';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'daer-dashboard-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('training dashboard', () => {
  it('renders the local training console shell', () => {
    const html = renderTrainingDashboard();

    expect(html).toContain('大贰 AI 训练控制台');
    expect(html).toContain('/api/snapshot');
    expect(html).toContain('事件流');
    expect(html).toContain('maxSampleResponseToDiscardRatio');
    expect(html).toContain('openingHeuristicDisagreementWeight');
  });

  it('builds snapshot data from durable job files', () => {
    const outputDir = makeTempDir();
    const tracker = createTrainingJobTracker({ outputDir, jobId: 'dashboard-job' });
    tracker.update({
      phase: 'oracle',
      message: 'oracle progress 1/2',
      progress: { oracleCompletedSamples: 1, oracleTotalSamples: 2 },
    });

    const snapshot = buildTrainingDashboardSnapshot(outputDir);

    expect(snapshot.status?.jobId).toBe('dashboard-job');
    expect(snapshot.status?.phase).toBe('oracle');
    expect(snapshot.events.length).toBeGreaterThan(0);
    expect(snapshot.diagnostics.headline).toContain('任务状态');
    expect(snapshot.files.logFile).toContain('training-run.log');
  });
});
