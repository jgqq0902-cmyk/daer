import { existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, readJsonFile, writeJsonFile } from './_common';
import {
  createJobId,
  getTrainingJobPaths,
  readTrainingJobStatus,
  requestTrainingJobCancel,
  type TrainingJobStatus,
} from './training-job';

export interface ManagedTrainingConfig {
  jobId: string;
  jobName: string;
  outputDir: string;
  resume: boolean;
  samplePhase: 'discard' | 'response' | 'all';
  selfPlayGames: number;
  maxSamples: number;
  maxTurnsPerGame: number;
  rolloutCountPerAction: number;
  maxRolloutSteps: number;
  oracleTopK: number;
  earlyStopDelta: number;
  oracleParallelism: number;
  oracleChunkSize: number;
  maxSampleResponseToDiscardRatio: number;
  maxResponseToDiscardRatio: number;
  discardSampleWeight: number;
  discardStageMinShare: number;
  discardOpeningWeight: number;
  discardMidgameWeight: number;
  openingHeuristicDisagreementWeight: number;
  midgameHeuristicDisagreementWeight: number;
  hardExampleWeight: number;
  minSamples: number;
  minWinRateDelta: number;
  minExpectedScoreDelta: number;
  minLearnedOracleMatchRate: number;
  minCategoryWinRateDelta: string;
  minActionFamilyOracleMatchRateDelta: string;
  artifactFile: string;
  datasetFile: string;
  reportFile: string;
  fixturesFile: string;
}

function getString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getPhase(value: unknown, fallback: 'discard' | 'response' | 'all'): 'discard' | 'response' | 'all' {
  return value === 'discard' || value === 'response' || value === 'all' ? value : fallback;
}

export function buildManagedTrainingConfig(rawArgs: Record<string, unknown> = {}): ManagedTrainingConfig {
  const outputDir = resolve(getString(rawArgs.outputDir, 'artifacts/learned-policy-winrate-v1'));
  const jobId = getString(rawArgs.jobId, createJobId());
  return {
    jobId,
    jobName: getString(rawArgs.jobName, 'learned-policy-winrate-v1'),
    outputDir,
    resume: rawArgs.resume === true,
    samplePhase: getPhase(rawArgs.samplePhase, 'all'),
    selfPlayGames: getNumber(rawArgs.selfPlayGames, 160),
    maxSamples: getNumber(rawArgs.maxSamples, 2200),
    maxTurnsPerGame: getNumber(rawArgs.maxTurnsPerGame, 28),
    rolloutCountPerAction: getNumber(rawArgs.rolloutCountPerAction, 16),
    maxRolloutSteps: getNumber(rawArgs.maxRolloutSteps, 120),
    oracleTopK: getNumber(rawArgs.oracleTopK, 6),
    earlyStopDelta: getNumber(rawArgs.earlyStopDelta, 0.25),
    oracleParallelism: getNumber(rawArgs.oracleParallelism, 6),
    oracleChunkSize: getNumber(rawArgs.oracleChunkSize, 16),
    maxSampleResponseToDiscardRatio: getNumber(rawArgs.maxSampleResponseToDiscardRatio, 0.6),
    maxResponseToDiscardRatio: getNumber(rawArgs.maxResponseToDiscardRatio, 0.75),
    discardSampleWeight: getNumber(rawArgs.discardSampleWeight, 1.5),
    discardStageMinShare: getNumber(rawArgs.discardStageMinShare, 0.25),
    discardOpeningWeight: getNumber(rawArgs.discardOpeningWeight, 1.6),
    discardMidgameWeight: getNumber(rawArgs.discardMidgameWeight, 1.4),
    openingHeuristicDisagreementWeight: getNumber(rawArgs.openingHeuristicDisagreementWeight, 3),
    midgameHeuristicDisagreementWeight: getNumber(rawArgs.midgameHeuristicDisagreementWeight, 1.8),
    hardExampleWeight: getNumber(rawArgs.hardExampleWeight, 2.2),
    minSamples: getNumber(rawArgs.minSamples, 300),
    minWinRateDelta: getNumber(rawArgs.minWinRateDelta, 0.005),
    minExpectedScoreDelta: getNumber(rawArgs.minExpectedScoreDelta, -0.05),
    minLearnedOracleMatchRate: getNumber(rawArgs.minLearnedOracleMatchRate, 0.18),
    minCategoryWinRateDelta: getString(rawArgs.minCategoryWinRateDelta, 'opening:0,midgame:-0.05'),
    minActionFamilyOracleMatchRateDelta: getString(
      rawArgs.minActionFamilyOracleMatchRateDelta,
      'discard:-0.03,response:-0.03',
    ),
    artifactFile: resolve(outputDir, 'policy-artifact.json'),
    datasetFile: resolve(outputDir, 'selfplay-dataset.json'),
    reportFile: resolve(outputDir, 'policy-evaluation.json'),
    fixturesFile: resolve(outputDir, 'benchmark-fixtures.json'),
  };
}

export function buildTrainingCommand(configFile: string): string[] {
  return [
    'pnpm',
    '--dir',
    'packages/core',
    'exec',
    'tsx',
    'scripts/rollout-train-learned-policy.ts',
    `--configFile=${resolve(configFile)}`,
    '--resume',
  ];
}

function writeCreatedStatus(config: ManagedTrainingConfig, configFile: string): TrainingJobStatus {
  const paths = getTrainingJobPaths(config.outputDir);
  const now = new Date().toISOString();
  const status: TrainingJobStatus = {
    jobId: config.jobId,
    name: config.jobName,
    state: 'created',
    phase: 'created',
    updatedAt: now,
    outputDir: config.outputDir,
    configFile,
    ...paths,
    lastMessage: 'job created; start or resume to run',
  };
  mkdirSync(dirname(paths.statusFile), { recursive: true });
  writeFileSync(paths.statusFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  return status;
}

function printStatus(outputDir: string): void {
  const status = readTrainingJobStatus(outputDir);
  console.log(`[train-job] ${status.name} ${status.state} phase=${status.phase}`);
  console.log(`[train-job] outputDir=${status.outputDir}`);
  if (status.pid) console.log(`[train-job] pid=${status.pid}`);
  if (status.lastMessage) console.log(`[train-job] message=${status.lastMessage}`);
  if (status.progress) console.log(`[train-job] progress=${JSON.stringify(status.progress)}`);
  if (status.gate) console.log(`[train-job] gate=${status.gate.passed ? 'PASS' : 'FAIL'}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const action = getString(args.action, 'status');
  const outputDir = resolve(getString(args.outputDir, 'artifacts/learned-policy-winrate-v1'));
  const configFile = resolve(getString(args.configFile, `${outputDir}/training-config.json`));

  if (action === 'status') {
    printStatus(outputDir);
    return;
  }

  if (action === 'cancel') {
    const cancelFile = requestTrainingJobCancel(outputDir, getString(args.reason, 'cancel requested by manager'));
    console.log(`[train-job] cancel requested: ${cancelFile}`);
    return;
  }

  const config = existsSync(configFile) && (action === 'resume' || action === 'start')
    ? {
      ...buildManagedTrainingConfig({ outputDir }),
      ...readJsonFile<ManagedTrainingConfig>(configFile),
      ...args,
      outputDir,
      resume: action === 'resume' || args.resume === true,
    } as ManagedTrainingConfig
    : buildManagedTrainingConfig({ ...args, outputDir, resume: action === 'resume' || args.resume === true });

  mkdirSync(outputDir, { recursive: true });
  writeJsonFile(configFile, config);
  const status = writeCreatedStatus(config, configFile);

  if (action === 'create') {
    console.log(`[train-job] created ${status.jobId}`);
    console.log(`[train-job] config=${configFile}`);
    console.log(`[train-job] status=${status.statusFile}`);
    return;
  }

  if (action !== 'start' && action !== 'resume') {
    throw new Error(`unknown training job action: ${action}`);
  }

  const paths = getTrainingJobPaths(outputDir);
  if (existsSync(paths.cancelFile)) unlinkSync(paths.cancelFile);
  const command = buildTrainingCommand(configFile);
  const logFile = resolve(outputDir, 'training-run.log');
  const out = openSync(logFile, 'a');
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', ...command], {
      cwd: resolve(__dirname, '../../..'),
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    })
    : spawn(command[0], command.slice(1), {
      cwd: resolve(__dirname, '../../..'),
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    });
  child.on('error', (error) => {
    console.error(`[train-job] failed to launch training process: ${error instanceof Error ? error.message : String(error)}`);
  });
  child.unref();

  console.log(`[train-job] ${action}ed ${config.jobId}`);
  console.log(`[train-job] pid=${child.pid}`);
  console.log(`[train-job] status=${paths.statusFile}`);
  console.log(`[train-job] events=${paths.eventsFile}`);
  console.log(`[train-job] log=${logFile}`);
}

if (process.env.VITEST !== 'true') {
  main().catch((error) => {
    console.error('[train-job] failed:', error);
    process.exitCode = 1;
  });
}
