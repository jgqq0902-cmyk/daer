import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface ScriptArgs {
  [key: string]: string | boolean | number | undefined;
}

export interface HeartbeatLogger {
  update(status: string): void;
  stop(): void;
}

interface HeartbeatLoggerOptions {
  label: string;
  intervalMs?: number;
  log?: (message: string) => void;
}

export function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, value] = raw.slice(2).split('=');
    if (!key) continue;
    if (value === undefined || value === '') {
      args[key] = true;
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      args[key] = Number(value);
      continue;
    }
    if (value === 'true' || value === 'false') {
      args[key] = value === 'true';
      continue;
    }
    args[key] = value;
  }
  return args;
}

export function writeJsonFile(filePath: string, value: unknown): void {
  const outputPath = resolve(filePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const outputPath = resolve(filePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, outputPath);
}

export function readJsonFile<T>(filePath: string): T {
  const content = readFileSync(resolve(filePath), 'utf8');
  return JSON.parse(content) as T;
}

export function cardToCode(card: { size: 'small' | 'big'; value: number }): string {
  return `${card.size === 'small' ? 'S' : 'B'}${card.value}`;
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createHeartbeatLogger(options: HeartbeatLoggerOptions): HeartbeatLogger {
  const intervalMs = Math.max(1_000, Math.floor(options.intervalMs ?? 60_000));
  const log = options.log ?? console.log;
  const startedAt = Date.now();
  let status = 'running';

  const timer = setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);
    const elapsedSeconds = Math.floor((elapsedMs % 60_000) / 1_000);
    log(
      `[${options.label}] heartbeat ${elapsedMinutes}m${elapsedSeconds.toString().padStart(2, '0')}s status=${status}`,
    );
  }, intervalMs);

  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }

  return {
    update(nextStatus: string) {
      status = nextStatus;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
