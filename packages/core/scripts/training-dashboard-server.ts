import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from './_common';
import { buildTrainingDiagnostics, type TrainingDiagnostics } from './training-diagnostics';
import {
  getTrainingJobPaths,
  readTrainingJobStatus,
  requestTrainingJobCancel,
  type TrainingJobEvent,
  type TrainingJobStatus,
} from './training-job';

export interface TrainingDashboardSnapshot {
  outputDir: string;
  status?: TrainingJobStatus;
  events: TrainingJobEvent[];
  diagnostics: TrainingDiagnostics;
  files: {
    statusFile: string;
    eventsFile: string;
    cancelFile: string;
    logFile: string;
  };
}

const DEFAULT_OUTPUT_DIR = 'artifacts/learned-policy-winrate-v1';

function readJsonlEvents(eventsFile: string, limit = 80): TrainingJobEvent[] {
  if (!existsSync(eventsFile)) {
    return [];
  }
  const lines = readFileSync(eventsFile, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => JSON.parse(line) as TrainingJobEvent);
}

export function buildTrainingDashboardSnapshot(outputDir: string): TrainingDashboardSnapshot {
  const resolvedOutputDir = resolve(outputDir);
  const paths = getTrainingJobPaths(resolvedOutputDir);
  return {
    outputDir: resolvedOutputDir,
    status: existsSync(paths.statusFile) ? readTrainingJobStatus(paths.statusFile) : undefined,
    events: readJsonlEvents(paths.eventsFile),
    diagnostics: buildTrainingDiagnostics(resolvedOutputDir),
    files: {
      ...paths,
      logFile: resolve(resolvedOutputDir, 'training-run.log'),
    },
  };
}

export function renderTrainingDashboard(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>大贰 AI 训练控制台</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #eef2e6;
      --muted: #9aa38f;
      --panel: #151812;
      --panel-2: #20251b;
      --line: #3d4933;
      --accent: #d7fb55;
      --accent-2: #7cc7ff;
      --danger: #ff6b5f;
      --ok: #8bea8b;
      --warn: #ffd36d;
      --shadow: rgba(0, 0, 0, 0.34);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(135deg, rgba(215, 251, 85, 0.07), transparent 28%),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 7px),
        #0c0e0a;
      color: var(--ink);
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      letter-spacing: 0;
    }
    .shell { max-width: 1280px; margin: 0 auto; padding: 24px; }
    .topbar {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: end;
      border-bottom: 1px solid var(--line);
      padding-bottom: 18px;
    }
    h1 { margin: 0; font-size: 30px; font-weight: 800; }
    .sub { color: var(--muted); margin-top: 8px; font-size: 13px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    button {
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--ink);
      height: 36px;
      padding: 0 13px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 700;
    }
    button.primary { background: var(--accent); color: #12150d; border-color: var(--accent); }
    button.danger { color: #fff; border-color: rgba(255,107,95,.5); background: rgba(255,107,95,.16); }
    button:hover { transform: translateY(-1px); box-shadow: 0 10px 20px var(--shadow); }
    .grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 14px; margin-top: 18px; }
    .panel {
      background: linear-gradient(180deg, rgba(255,255,255,.035), transparent 85%), var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 18px 45px var(--shadow);
      padding: 16px;
      min-width: 0;
    }
    .panel h2 { font-size: 15px; margin: 0 0 14px; color: var(--accent); }
    .statusline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .badge { border: 1px solid var(--line); border-radius: 999px; padding: 5px 9px; font-size: 12px; color: var(--muted); }
    .badge.running { color: var(--accent); border-color: rgba(215,251,85,.5); }
    .badge.completed { color: var(--ok); border-color: rgba(139,234,139,.5); }
    .badge.failed, .badge.cancelled { color: var(--danger); border-color: rgba(255,107,95,.5); }
    .metricGrid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; margin-top: 16px; }
    .metric { border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); border-radius: 6px; padding: 12px; }
    .metric .label { color: var(--muted); font-size: 12px; }
    .metric .value { font-size: 22px; font-weight: 800; margin-top: 6px; overflow-wrap: anywhere; }
    .bar { height: 12px; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; background: #090b08; margin-top: 14px; }
    .bar > div { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width .35s ease; }
    .formrow { display: grid; grid-template-columns: 120px 1fr; gap: 8px; align-items: center; margin-bottom: 10px; }
    input {
      width: 100%;
      height: 36px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: #0b0d09;
      color: var(--ink);
      padding: 0 10px;
    }
    .files, .events { font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; color: #cbd6c1; }
    .files div { padding: 7px 0; border-bottom: 1px dashed rgba(255,255,255,.08); overflow-wrap: anywhere; }
    .events { max-height: 420px; overflow: auto; }
    .event { display: grid; grid-template-columns: 150px 92px 1fr; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
    .event .type { color: var(--accent-2); }
    .diagHeadline { font-weight: 800; margin-bottom: 10px; }
    .diagList { margin: 0; padding-left: 18px; color: #dbe7d2; }
    .diagList li { margin: 7px 0; }
    .diagFail { color: var(--danger); }
    .diagPass { color: var(--ok); }
    .empty { color: var(--muted); padding: 20px 0; }
    @media (max-width: 880px) {
      .topbar, .grid { grid-template-columns: 1fr; }
      .controls { justify-content: flex-start; }
      .metricGrid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .event { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="topbar">
      <div>
        <h1>大贰 AI 训练控制台</h1>
        <div class="sub">离线 learned policy 任务管理，状态落盘，断点继续，事件可追踪。</div>
      </div>
      <div class="controls">
        <button id="createBtn">创建</button>
        <button id="startBtn" class="primary">启动</button>
        <button id="resumeBtn">继续</button>
        <button id="cancelBtn" class="danger">取消</button>
      </div>
    </section>
    <section class="grid">
      <div class="panel">
        <h2>任务状态</h2>
        <div class="statusline">
          <span id="stateBadge" class="badge">unknown</span>
          <span id="phaseBadge" class="badge">phase: -</span>
          <span id="updatedBadge" class="badge">updated: -</span>
        </div>
        <div class="metricGrid">
          <div class="metric"><div class="label">样本</div><div id="sampled" class="value">0</div></div>
          <div class="metric"><div class="label">Oracle</div><div id="oracle" class="value">0/0</div></div>
          <div class="metric"><div class="label">保留</div><div id="retained" class="value">-</div></div>
          <div class="metric"><div class="label">Gate</div><div id="gate" class="value">-</div></div>
        </div>
        <div class="bar"><div id="progressBar"></div></div>
        <p id="message" class="sub"></p>
      </div>
      <div class="panel">
        <h2>配置</h2>
        <div class="formrow"><label>输出目录</label><input id="outputDir" /></div>
        <div class="formrow"><label>最大样本</label><input id="maxSamples" value="2200" /></div>
        <div class="formrow"><label>并行</label><input id="oracleParallelism" value="6" /></div>
        <div class="formrow"><label>自博弈</label><input id="selfPlayGames" value="160" /></div>
        <div class="formrow"><label>采样响应比</label><input id="maxSampleResponseToDiscardRatio" value="0.6" /></div>
        <div class="formrow"><label>训练响应比</label><input id="maxResponseToDiscardRatio" value="0.75" /></div>
        <div class="formrow"><label>出牌权重</label><input id="discardSampleWeight" value="1.5" /></div>
        <div class="formrow"><label>出牌分期</label><input id="discardStageMinShare" value="0.25" /></div>
        <div class="formrow"><label>开局权重</label><input id="discardOpeningWeight" value="1.6" /></div>
        <div class="formrow"><label>开局纠错</label><input id="openingHeuristicDisagreementWeight" value="3" /></div>
        <div class="formrow"><label>硬样本权重</label><input id="hardExampleWeight" value="2.2" /></div>
      </div>
      <div class="panel">
        <h2>产物与文件</h2>
        <div id="files" class="files"></div>
      </div>
      <div class="panel">
        <h2>诊断与建议</h2>
        <div id="diagnostics"></div>
      </div>
      <div class="panel">
        <h2>事件流</h2>
        <div id="events" class="events"></div>
      </div>
    </section>
  </main>
  <script>
    const outputDirInput = document.getElementById('outputDir');
    outputDirInput.value = new URLSearchParams(location.search).get('outputDir') || '${DEFAULT_OUTPUT_DIR}';
    const api = (path) => path + '?outputDir=' + encodeURIComponent(outputDirInput.value);
    function pct(done, total) { return total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0; }
    async function refresh() {
      const res = await fetch(api('/api/snapshot'));
      const data = await res.json();
      const s = data.status || {};
      const p = s.progress || {};
      const state = s.state || 'not-created';
      const badge = document.getElementById('stateBadge');
      badge.textContent = state;
      badge.className = 'badge ' + state;
      document.getElementById('phaseBadge').textContent = 'phase: ' + (s.phase || '-');
      document.getElementById('updatedBadge').textContent = 'updated: ' + (s.updatedAt || '-');
      document.getElementById('sampled').textContent = p.samplingTargetSamples
        ? (p.sampledDecisionCount || 0) + '/' + p.samplingTargetSamples
        : (p.sampledDecisionCount || 0);
      document.getElementById('oracle').textContent = (p.oracleCompletedSamples || 0) + '/' + (p.oracleTotalSamples || 0);
      document.getElementById('retained').textContent = p.retainedSampleCount ?? '-';
      document.getElementById('gate').textContent = s.gate ? (s.gate.passed ? 'PASS' : 'FAIL') : '-';
      const progressDone = p.oracleTotalSamples
        ? (p.oracleCompletedSamples || 0)
        : (p.sampledDecisionCount || 0);
      const progressTotal = p.oracleTotalSamples || p.samplingTargetSamples || 0;
      document.getElementById('progressBar').style.width = pct(progressDone, progressTotal) + '%';
      document.getElementById('message').textContent = s.lastMessage || '尚未创建训练任务';
      document.getElementById('files').innerHTML = Object.entries(data.files).map(([k,v]) => '<div><b>' + k + '</b><br>' + v + '</div>').join('');
      const d = data.diagnostics || {};
      const metricHtml = (d.metrics || []).map(m => '<li class="' + (m.passed ? 'diagPass' : 'diagFail') + '">' + m.message + '</li>').join('');
      const segmentHtml = (d.segments || []).map(seg => '<li class="diagFail">' + seg.scope + ':' + seg.name + ' samples=' + seg.sampleCount + ' win=' + seg.winRateDelta + ' matchDelta=' + seg.oracleMatchRateDelta + '</li>').join('');
      const nextHtml = (d.recommendations || []).map(item => '<li>' + item + '</li>').join('');
      document.getElementById('diagnostics').innerHTML =
        '<div class="diagHeadline">' + (d.headline || '暂无诊断') + '</div>'
        + '<ul class="diagList">' + metricHtml + segmentHtml + nextHtml + '</ul>';
      document.getElementById('events').innerHTML = data.events.length
        ? data.events.slice().reverse().map(e => '<div class="event"><span>' + e.at + '</span><span class="type">' + e.type + '</span><span>' + (e.message || e.phase || '') + '</span></div>').join('')
        : '<div class="empty">还没有事件。</div>';
    }
    async function action(name) {
      const body = {
        action: name,
        outputDir: outputDirInput.value,
        maxSamples: Number(document.getElementById('maxSamples').value),
        oracleParallelism: Number(document.getElementById('oracleParallelism').value),
        selfPlayGames: Number(document.getElementById('selfPlayGames').value),
        maxSampleResponseToDiscardRatio: Number(document.getElementById('maxSampleResponseToDiscardRatio').value),
        maxResponseToDiscardRatio: Number(document.getElementById('maxResponseToDiscardRatio').value),
        discardSampleWeight: Number(document.getElementById('discardSampleWeight').value),
        discardStageMinShare: Number(document.getElementById('discardStageMinShare').value),
        discardOpeningWeight: Number(document.getElementById('discardOpeningWeight').value),
        openingHeuristicDisagreementWeight: Number(document.getElementById('openingHeuristicDisagreementWeight').value),
        hardExampleWeight: Number(document.getElementById('hardExampleWeight').value)
      };
      await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      await refresh();
    }
    document.getElementById('createBtn').onclick = () => action('create');
    document.getElementById('startBtn').onclick = () => action('start');
    document.getElementById('resumeBtn').onclick = () => action('resume');
    document.getElementById('cancelBtn').onclick = () => action('cancel');
    outputDirInput.onchange = refresh;
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}

function sendJson(res: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) as Record<string, unknown> : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function launchManager(action: string, args: Record<string, unknown>): void {
  const outputDir = typeof args.outputDir === 'string' ? args.outputDir : DEFAULT_OUTPUT_DIR;
  const commandArgs = [
    '--dir',
    'packages/core',
    'exec',
    'tsx',
    'scripts/manage-training-job.ts',
    `--action=${action}`,
    `--outputDir=${outputDir}`,
  ];
  for (const key of [
    'maxSamples',
    'oracleParallelism',
    'selfPlayGames',
    'maxSampleResponseToDiscardRatio',
    'maxResponseToDiscardRatio',
    'discardSampleWeight',
    'discardStageMinShare',
    'discardOpeningWeight',
    'openingHeuristicDisagreementWeight',
    'hardExampleWeight',
  ]) {
    if (typeof args[key] === 'number') {
      commandArgs.push(`--${key}=${args[key]}`);
    }
  }
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', 'pnpm', ...commandArgs], {
      cwd: resolve(__dirname, '../../..'),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    : spawn('pnpm', commandArgs, {
    cwd: resolve(__dirname, '../../..'),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (error) => {
    console.error(`[train-dashboard] failed to launch manager action=${action}:`, error);
  });
  child.unref();
}

export function createTrainingDashboardServer(defaultOutputDir = DEFAULT_OUTPUT_DIR) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const outputDir = url.searchParams.get('outputDir') || defaultOutputDir;
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderTrainingDashboard());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        sendJson(res, buildTrainingDashboardSnapshot(outputDir));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const body = await readBody(req);
        const action = typeof body.action === 'string' ? body.action : '';
        if (action === 'cancel') {
          requestTrainingJobCancel(typeof body.outputDir === 'string' ? body.outputDir : outputDir);
          sendJson(res, { ok: true, action });
          return;
        }
        if (action === 'create' || action === 'start' || action === 'resume') {
          launchManager(action, body);
          sendJson(res, { ok: true, action });
          return;
        }
        sendJson(res, { ok: false, error: `unknown action: ${action}` }, 400);
        return;
      }
      sendJson(res, { ok: false, error: 'not found' }, 404);
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const port = typeof args.port === 'number' ? args.port : 4317;
  const outputDir = typeof args.outputDir === 'string' ? args.outputDir : DEFAULT_OUTPUT_DIR;
  const server = createTrainingDashboardServer(outputDir);
  server.listen(port, '127.0.0.1', () => {
    console.log(`[train-dashboard] http://127.0.0.1:${port}/?outputDir=${encodeURIComponent(outputDir)}`);
  });
}

if (process.env.VITEST !== 'true') {
  main().catch((error) => {
    console.error('[train-dashboard] failed:', error);
    process.exitCode = 1;
  });
}
