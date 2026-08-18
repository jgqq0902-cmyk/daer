import { createGodotAiRuntimeServer, shouldTerminateForGodotParent } from './godot-ai-runtime-server';
import { resolve } from 'node:path';

const port = Number(process.env.DAER_GODOT_AI_PORT || 48152);
const persistenceFile = process.env.DAER_GODOT_STATE_FILE || resolve(process.cwd(), '.daer', 'godot-game-state.json');
const sessionId = (process.env.DAER_GODOT_SESSION_ID || '').trim();
const parentProcessId = Number(process.env.DAER_GODOT_PARENT_PID || 0);
const server = createGodotAiRuntimeServer({ persistenceFile, sessionId });
let parentWatch: ReturnType<typeof setInterval> | undefined;
let closing = false;

function closeBridge(): void {
  if (closing) return;
  closing = true;
  if (parentWatch) clearInterval(parentWatch);
  const forceExit = setTimeout(() => process.exit(0), 1_500);
  forceExit.unref();
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}

server.once('close', () => {
  if (parentWatch) clearInterval(parentWatch);
});

server.listen(port, '127.0.0.1', () => {
  console.log('[godot-ai] daer core runtime listening on http://127.0.0.1:' + port + (sessionId ? ' for ' + sessionId : ''));
  if (!Number.isSafeInteger(parentProcessId) || parentProcessId <= 0) return;
  parentWatch = setInterval(() => {
    if (shouldTerminateForGodotParent(parentProcessId)) {
      console.log('[godot-ai] Godot parent exited; closing Bridge.');
      closeBridge();
    }
  }, 1_000);
  parentWatch.unref();
});

process.once('SIGINT', closeBridge);
process.once('SIGTERM', closeBridge);
