import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type TrainingJobState = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TrainingJobProgress {
  sampledDecisionCount?: number;
  samplingTargetSamples?: number;
  oracleCompletedSamples?: number;
  oracleTotalSamples?: number;
  retainedSampleCount?: number;
  filteredSampleCount?: number;
}

export interface TrainingJobOutputs {
  artifactFile?: string;
  datasetFile?: string;
  reportFile?: string;
  fixturesFile?: string;
}

export interface TrainingJobStatus {
  jobId: string;
  name: string;
  state: TrainingJobState;
  phase: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  outputDir: string;
  configFile?: string;
  statusFile: string;
  eventsFile: string;
  cancelFile: string;
  pid?: number;
  lastMessage?: string;
  progress?: TrainingJobProgress;
  outputs?: TrainingJobOutputs;
  gate?: {
    passed: boolean;
    reasons?: string[];
  };
  error?: string;
}

export interface TrainingJobEvent {
  at: string;
  jobId: string;
  type: 'created' | 'progress' | 'completed' | 'failed' | 'cancelled' | 'message';
  phase: string;
  message?: string;
  progress?: TrainingJobProgress;
}

export interface TrainingJobTracker {
  readonly statusFile: string;
  readonly eventsFile: string;
  readonly cancelFile: string;
  update(next: {
    phase?: string;
    message?: string;
    progress?: TrainingJobProgress;
    outputs?: TrainingJobOutputs;
    gate?: TrainingJobStatus['gate'];
  }): void;
  complete(next?: {
    message?: string;
    progress?: TrainingJobProgress;
    outputs?: TrainingJobOutputs;
    gate?: TrainingJobStatus['gate'];
  }): void;
  fail(error: unknown): void;
  assertNotCancelled(): void;
}

export function createJobId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `train-${stamp}`;
}

export function getTrainingJobPaths(outputDir: string): Pick<TrainingJobStatus, 'statusFile' | 'eventsFile' | 'cancelFile'> {
  const root = resolve(outputDir);
  return {
    statusFile: resolve(root, 'training-status.json'),
    eventsFile: resolve(root, 'training-events.jsonl'),
    cancelFile: resolve(root, 'training.cancel'),
  };
}

export function readTrainingJobStatus(outputDirOrStatusFile: string): TrainingJobStatus {
  const candidate = resolve(outputDirOrStatusFile);
  const statusFile = candidate.endsWith('.json')
    ? candidate
    : getTrainingJobPaths(candidate).statusFile;
  return JSON.parse(readFileSync(statusFile, 'utf8')) as TrainingJobStatus;
}

export function requestTrainingJobCancel(outputDir: string, reason = 'cancel requested'): string {
  const { cancelFile } = getTrainingJobPaths(outputDir);
  mkdirSync(dirname(cancelFile), { recursive: true });
  writeFileSync(cancelFile, `${new Date().toISOString()} ${reason}\n`, 'utf8');
  return cancelFile;
}

export function createTrainingJobTracker(options: {
  outputDir: string;
  jobId?: string;
  name?: string;
  configFile?: string;
  pid?: number;
  initialPhase?: string;
}): TrainingJobTracker {
  const outputDir = resolve(options.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const paths = getTrainingJobPaths(outputDir);
  const now = new Date().toISOString();
  let status: TrainingJobStatus = {
    jobId: options.jobId || createJobId(),
    name: options.name || 'learned-policy-training',
    state: 'running',
    phase: options.initialPhase || 'starting',
    startedAt: now,
    updatedAt: now,
    outputDir,
    configFile: options.configFile ? resolve(options.configFile) : undefined,
    pid: options.pid,
    ...paths,
  };

  const writeStatus = () => {
    writeFileSync(paths.statusFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  };
  const writeEvent = (event: Omit<TrainingJobEvent, 'at' | 'jobId' | 'phase'> & { phase?: string }) => {
    const fullEvent: TrainingJobEvent = {
      at: new Date().toISOString(),
      jobId: status.jobId,
      phase: event.phase || status.phase,
      ...event,
    };
    appendFileSync(paths.eventsFile, `${JSON.stringify(fullEvent)}\n`, 'utf8');
  };

  writeStatus();
  writeEvent({ type: 'created', message: 'training job started' });

  const assertNotCancelled = () => {
    if (existsSync(paths.cancelFile)) {
      status = {
        ...status,
        state: 'cancelled',
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        lastMessage: 'cancel requested',
      };
      writeStatus();
      writeEvent({ type: 'cancelled', message: 'cancel requested' });
      throw new Error(`training job cancelled: ${paths.cancelFile}`);
    }
  };

  return {
    statusFile: paths.statusFile,
    eventsFile: paths.eventsFile,
    cancelFile: paths.cancelFile,
    update(next) {
      assertNotCancelled();
      status = {
        ...status,
        state: 'running',
        phase: next.phase || status.phase,
        updatedAt: new Date().toISOString(),
        lastMessage: next.message || status.lastMessage,
        progress: {
          ...(status.progress || {}),
          ...(next.progress || {}),
        },
        outputs: {
          ...(status.outputs || {}),
          ...(next.outputs || {}),
        },
        gate: next.gate || status.gate,
      };
      writeStatus();
      writeEvent({
        type: 'progress',
        phase: status.phase,
        message: next.message,
        progress: next.progress,
      });
    },
    complete(next = {}) {
      status = {
        ...status,
        state: 'completed',
        phase: 'completed',
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        lastMessage: next.message || 'completed',
        progress: {
          ...(status.progress || {}),
          ...(next.progress || {}),
        },
        outputs: {
          ...(status.outputs || {}),
          ...(next.outputs || {}),
        },
        gate: next.gate || status.gate,
      };
      writeStatus();
      writeEvent({ type: 'completed', message: status.lastMessage, progress: next.progress });
    },
    fail(error) {
      const message = error instanceof Error ? error.message : String(error);
      status = {
        ...status,
        state: status.state === 'cancelled' ? 'cancelled' : 'failed',
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        lastMessage: message,
        error: message,
      };
      writeStatus();
      writeEvent({ type: status.state === 'cancelled' ? 'cancelled' : 'failed', message });
    },
    assertNotCancelled,
  };
}
