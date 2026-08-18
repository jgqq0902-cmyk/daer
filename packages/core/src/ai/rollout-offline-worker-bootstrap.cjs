const { createRequire } = require('node:module');
const { parentPort } = require('node:worker_threads');
const path = require('node:path');

const requireFromCore = createRequire(path.resolve(__dirname, '../../package.json'));
requireFromCore('tsx/cjs');

const {
  evaluateDiscardCandidatesWithRolloutsInWorker,
} = require('./rollout-offline-worker-runtime.ts');

if (!parentPort) {
  throw new Error('oracle worker requires parentPort');
}

parentPort.on('message', async (task) => {
  try {
    const oracle = await evaluateDiscardCandidatesWithRolloutsInWorker(task.sample, task.options);
    parentPort.postMessage({
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
