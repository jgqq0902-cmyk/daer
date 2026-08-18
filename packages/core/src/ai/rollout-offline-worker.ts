import { parentPort } from 'node:worker_threads';
import type {
  OfflineSample,
  OfflineTrainingOptions,
} from './rollout-offline-worker-runtime';

interface OracleWorkerTask {
  sampleIndex: number;
  sample: OfflineSample;
  options: OfflineTrainingOptions;
}

if (!parentPort) {
  throw new Error('oracle worker requires parentPort');
}

parentPort.on('message', async (task: OracleWorkerTask) => {
  try {
    const runtimeModule = await import('./rollout-offline-worker-runtime' + '.ts');
    const evaluateDiscardCandidatesWithRolloutsInWorker = runtimeModule.evaluateDiscardCandidatesWithRolloutsInWorker;
    const oracle = await evaluateDiscardCandidatesWithRolloutsInWorker(task.sample, task.options);
    parentPort?.postMessage({
      sampleIndex: task.sampleIndex,
      sample: {
        ...task.sample,
        oracle,
      },
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
});
