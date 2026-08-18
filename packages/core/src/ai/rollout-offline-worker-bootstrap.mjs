import { register } from 'tsx/esm/api';

register({
  tsconfig: false,
});

await import('./rollout-offline-worker.ts');
