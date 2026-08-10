/**
 * ═══════════════════════════════════════════════════════════════════
 * Testing-UI — Electron Main Process
 * ═══════════════════════════════════════════════════════════════════
 *
 * This file is the Node.js backend of the Electron app. It runs in the
 * main process and is responsible for:
 *
 *   1. Creating the BrowserWindow and loading the React frontend
 *   2. Handling all IPC (Inter-Process Communication) from the renderer
 *   3. Spawning child processes (cucumber-js, fix-sender, fix-bulk)
 *   4. Parsing Gherkin .feature files for the UI
 *   5. Managing a JSON-based persistent config store
 *
 * ══ IPC patterns used in this file ══
 *
 *   Request-Response (async):
 *     ipcMain.handle('channel', async (event, ...args) => { ... })
 *     → Renderer calls: api.method(...) which maps to ipcRenderer.invoke('channel', ...)
 *     Used for: read-env-qa, write-env-qa, list-feature-files, get/set-mock-dir,
 *               pick-mock-dir, run-fix-bulk, stop-cucumber
 *
 *   Streaming (fire-and-forget + push):
 *     ipcMain.on('channel', (event, ...args) => {
 *       event.sender.send('channel-message', data);
 *       event.sender.send('channel-done');
 *       event.sender.send('channel-error', msg);
 *     })
 *     → Renderer subscribes with onXxxStream() before calling runXxx()
 *     Used for: run-cucumber, run-fix-sender
 *
 * ══ Child process spawning ══
 *
 *   We use child_process.spawn() without `shell: true` to avoid Windows
 *   cmd.exe character escaping issues (especially the ^ in cucumber --name regex).
 *   Node is invoked directly with the script path as an argument.
 *
 * ══ Security ══
 *
 *   - contextIsolation: true  — renderer cannot access Node.js APIs directly
 *   - nodeIntegration: false  — no `require` in renderer
 *   - All IPC goes through the contextBridge (preload.cjs) whitelist
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'node:fs/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// ESM doesn't have __dirname — construct it manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

/* ──────────── helpers ──────────── */

/**
 * Built-in testCases directory (inside the app).
 * Dev: <repo>/Testing-UI/testCases
 * Packaged: resources/app.asar.unpacked/testCases
 */
function getTestCasesDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'testCases');
  }
  return path.join(__dirname, '..', 'testCases');
}

/** App-root node_modules (deps hoisted from testCases into Testing-UI). */
function getAppNodeModules() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', 'node_modules');
  }
  return path.join(__dirname, '..', 'node_modules');
}

/**
 * Path inside the built-in testCases directory.
 * Example: mockPath('send-fix.js') → …/testCases/send-fix.js
 */
function mockPath(...segments) {
  return path.join(getTestCasesDir(), ...segments);
}

/**
 * Run a .js script with Electron's embedded Node (no system `node` required).
 * NODE_PATH points at the app's node_modules so scripts in unpacked testCases
 * can resolve hoisted packages (asar.unpacked cannot see asar/node_modules by walking up).
 */
function spawnNodeScript(scriptArgs, options = {}) {
  const { env: extraEnv, ...rest } = options;
  const nodePathParts = [getAppNodeModules(), process.env.NODE_PATH].filter(Boolean);
  return spawn(process.execPath, scriptArgs, {
    ...rest,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: nodePathParts.join(path.delimiter),
      ...extraEnv,
    },
  });
}

/* ──────────── cucumber process tracking ──────────── */

/**
 * Module-level reference to the currently running cucumber-js process.
 * Only one test run can be active at a time — this enforces mutual exclusion.
 * Set to null when no run is in progress.
 */
let runningCucumberProc = null;

/* ──────────── Gherkin parser ──────────── */

/**
 * Parses a Gherkin .feature file content into a structured object.
 *
 * This is a SIMPLE line-by-line parser — it does NOT use the full Gherkin
 * AST. It handles only the constructs we care about for the UI:
 *   - Feature: name + top-level @tags
 *   - Scenario: / Scenario Outline: / Scenario Template: / Example: names + @tags
 *   - Background: (recognized but ignored)
 *   - Examples: blocks (recognized but data rows are ignored — we only support
 *     simple scenarios, not Scenario Outlines with Examples tables)
 *
 * Tag inheritance:
 *   - Tags before the Feature: line are "feature-level" — they apply to every scenario
 *   - Tags between the Feature: line and the next Scenario: line are "scenario-level"
 *   - Scenario tags = feature-level tags + scenario-level tags
 *
 * @param {string} content  raw .feature file content (UTF-8 text)
 * @returns {{ featureName: string, scenarios: Array<{name: string, line: number, tags: string[]}> }}
 */
function parseFeatureFile(content) {
  const lines = content.split('\n');
  let featureName = '';
  const featureTags = []; // tags before Feature: — inherited by all scenarios
  const scenarios = [];
  const currentTags = []; // tags accumulated before a scenario
  let inFeature = false;     // true once we've seen the Feature: line
  let inBackground = false;  // true while inside a Background: block (ignored)
  let inExamples = false;    // true while inside an Examples: table (ignored)
  let currentScenario = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Collect @tags — they can appear before Feature or Scenario
    if (line.startsWith('@')) {
      const tags = line.split(/\s+/).filter((t) => t.startsWith('@'));
      if (!inFeature) {
        // Feature-level tags — inherit to all scenarios
        featureTags.push(...tags);
      } else if (!inBackground && !inExamples) {
        // Scenario-level tags
        currentTags.push(...tags);
      }
      continue;
    }

    if (line.startsWith('Feature:')) {
      featureName = line.replace(/^Feature:\s*/, '').trim();
      inFeature = true;
      continue;
    }

    if (line.startsWith('Background:')) {
      inBackground = true;
      continue;
    }

    // Handle all Gherkin scenario-like keywords
    if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:') || line.startsWith('Scenario Template:') || line.startsWith('Example:')) {
      inBackground = false;
      inExamples = false;
      const name = line.replace(/^(Scenario|Scenario Outline|Scenario Template|Example):\s*/, '').trim();
      // Each scenario inherits feature-level tags + its own scenario-level tags
      currentScenario = { name, line: i + 1, tags: [...featureTags, ...currentTags] };
      scenarios.push(currentScenario);
      currentTags.length = 0;
      continue;
    }

    if (line.startsWith('Examples:')) {
      inExamples = true;
      continue;
    }

    // Ignore Examples data rows — we only handle simple scenarios
    if (inExamples) continue;
  }

  return { featureName, scenarios };
}

/* ──────────── IPC: read .env.qa ──────────── */

/**
 * Reads the .env.qa file from the mock-testcases directory and parses it
 * into a key-value object.
 *
 * Invoked by SettingsPage on mount to pre-populate FIX connection settings
 * from the FIX_POINT environment variable.
 *
 * Format: KEY=VALUE pairs, one per line. # comments and blank lines skipped.
 *
 * @returns {{ ok: boolean, data?: Record<string,string>, error?: string }}
 */
ipcMain.handle('read-env-qa', async () => {
  try {
    const envPath = mockPath('.env.qa');
    const raw = await fs.readFile(envPath, 'utf-8');
    const entries = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      entries[key] = value;
    }
    return { ok: true, data: entries };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── IPC: write a single key in .env.qa ──────────── */
ipcMain.handle('write-env-qa', async (_event, key, value) => {
  try {
    const envPath = mockPath('.env.qa');
    const raw = await fs.readFile(envPath, 'utf-8');
    const lines = raw.split('\n');
    let found = false;
    const updated = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return line;
      const lineKey = trimmed.slice(0, idx).trim();
      if (lineKey === key) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) {
      updated.push(`${key}=${value}`);
    }
    await fs.writeFile(envPath, updated.join('\n') + '\n', 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── IPC: list .env.* files ──────────── */
ipcMain.handle('list-env-files', async () => {
  try {
    const dir = getTestCasesDir();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const envFiles = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith('.env.')) {
        envFiles.push(entry.name);
      }
    }
    return { ok: true, data: envFiles };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── IPC: read a single env file ──────────── */
ipcMain.handle('read-env-file', async (_event, filename) => {
  try {
    const filePath = mockPath(filename);
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      data[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── IPC: built-in testCases path (read-only) ──────────── */
ipcMain.handle('get-mock-dir', () => {
  return { ok: true, path: getTestCasesDir() };
});

ipcMain.handle('set-mock-dir', async () => {
  return {
    ok: false,
    error: 'testCases is bundled with the app; external path override is disabled.',
  };
});

ipcMain.handle('pick-mock-dir', async () => {
  return {
    ok: false,
    error: 'testCases is bundled with the app; external path override is disabled.',
  };
});

/* ──────────── helpers: send-fix.js ──────────── */

function extractFixTag(fixStr, tag) {
  const m = String(fixStr ?? '').match(new RegExp(`(?:^|\\|)${tag}=([^|]*)`));
  return m ? m[1] : '';
}

async function readEnvQaMap() {
  try {
    const envPath = mockPath('.env.qa');
    const raw = await fs.readFile(envPath, 'utf-8');
    const entries = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      entries[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return entries;
  } catch {
    return {};
  }
}

/** Spawn one send-fix.js; stream each stdout line to renderer. */
function runOneSendFix(scriptPath, targetCompId, body, fixEndpoint, sender) {
  return new Promise((resolve, reject) => {
    const args = [scriptPath, targetCompId, body];
    if (fixEndpoint) args.push(fixEndpoint);

    const proc = spawnNodeScript(args, {
      cwd: getTestCasesDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) sender.send('fix-sender-message', trimmed);
      }
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (buf.trim()) sender.send('fix-sender-message', buf.trim());
      if (code !== 0) reject(new Error(stderr || `send-fix.js exited with code ${code}`));
      else resolve();
    });

    proc.on('error', reject);
  });
}

/* ──────────── IPC: run send-fix.js per queue message (streaming) ──────────── */
ipcMain.on('run-fix-sender', async (event, payload) => {
  const sender = event.sender;
  try {
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const scriptPath = mockPath('send-fix.js');

    if (messages.length === 0) {
      sender.send('fix-sender-error', 'No messages to send');
      return;
    }

    const env = await readEnvQaMap();
    const fixEndpoint = env.FIX_POINT || '';
    const defaultTarget = env.TARGET_ID || 'TARGET';

    for (const raw of messages) {
      const targetCompId = extractFixTag(raw, '56') || defaultTarget;
      await runOneSendFix(scriptPath, targetCompId, raw, fixEndpoint, sender);
    }
    sender.send('fix-sender-done');
  } catch (err) {
    sender.send('fix-sender-error', err.message || String(err));
  }
});

/* ──────────── IPC: run fix-bulk script ──────────── */
ipcMain.handle('run-fix-bulk', async (_event, mode, ...args) => {
  try {
    const scriptPath = mockPath('fix-bulk.js');
    const procArgs = [scriptPath, String(mode), ...args.map(String)];

    return new Promise((resolve) => {
      const proc = spawnNodeScript(procArgs, {
        cwd: getTestCasesDir(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ ok: false, error: stderr || `Process exited with code ${code}` });
        } else {
          try {
            const data = JSON.parse(stdout.trim());
            resolve({ ok: true, data });
          } catch {
            resolve({ ok: false, error: `Invalid JSON output: ${stdout}` });
          }
        }
      });

      proc.on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── IPC: run performance_test.js ────────────
 *
 *   start:  runId: 'uuid'
 *   status: status { runId: '...', state: 1, sent: 100, ... }  (非严格 JSON，可有颜色码)
 *   stop:   空
 */

/** 去掉终端颜色控制符 */
function stripAnsi(s) {
  return String(s).replace(/\u001b\[[0-9;]*m/g, '');
}

const PERF_FIELDS = [
  'runId', 'state', 'sent', 'sendOrders', 'sendErrors', 'lastError',
  'startAt', 'endsAt', 'targetCompId', 'targetRatePerSec', 'actualRatePerSec',
];

/** 读单个字段 — 每种类型单独匹配，只用 m[1]，避免多捕获组抄错 */
function readPerfField(text, key) {
  const prefix = key + '\\s*:\\s*';

  let m = text.match(new RegExp(prefix + "'([^']*)'", 'i'));
  if (m) return m[1];

  m = text.match(new RegExp(prefix + '"([^"]*)"', 'i'));
  if (m) return m[1];

  m = text.match(new RegExp(prefix + 'null', 'i'));
  if (m) return null;

  m = text.match(new RegExp(prefix + '(\\d+(?:\\.\\d+)?)', 'i'));
  if (m) return Number(m[1]);

  return undefined;
}

function scanFields(text) {
  const obj = {};
  for (const key of PERF_FIELDS) {
    const val = readPerfField(text, key);
    if (val !== undefined) obj[key] = val;
  }
  // 不要用字段名 status 去填 state：真实输出是 `status { state: 1, ... }`，
  // 误读会把脏值写进 state → 前端徽章显示 Error。
  return obj;
}

/**
 * 从杂讯 stdout 里抠 runId（真实脚本常带 banner / 颜色 / 多行）。
 * 例：
 *   use performance_test
 *   runId: 550e8400-e29b-41d4-a716-446655440000
 */
function extractRunIdFromOutput(raw) {
  const text = stripAnsi(raw || '').trim();
  if (!text) return '';

  // JSON 整段或夹在其它行里
  try {
    if (text.startsWith('{')) {
      const parsed = JSON.parse(text);
      if (parsed?.runId) return String(parsed.runId).trim();
    }
  } catch { /* continue */ }

  const brace = text.indexOf('{');
  if (brace !== -1) {
    try {
      const parsed = JSON.parse(text.slice(brace));
      if (parsed?.runId) return String(parsed.runId).trim();
    } catch { /* continue */ }
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m =
      line.match(/^runId\s*[:=]\s*['"]?([^\s'"]+)['"]?/i)
      || line.match(/runId\s*[:=]\s*['"]?([0-9a-f-]{36})['"]?/i);
    if (m) return m[1].replace(/,$/, '').trim();
  }

  // 整段就是 UUID，或某一行是 UUID
  if (/^[0-9a-f-]{36}$/i.test(text)) return text;
  for (const line of lines) {
    if (/^[0-9a-f-]{36}$/i.test(line)) return line;
  }

  // 全文兜底：任意位置的 UUID
  const uuid = text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  if (uuid) return uuid[1];

  return '';
}

function parsePerformanceTestOutput(command, stdout) {
  const text = stripAnsi(stdout).trim();
  if (!text) return {};

  if (command === 'start') {
    const runId = extractRunIdFromOutput(text);
    return runId ? { runId } : {};
  }

  if (command === 'status') {
    const obj = scanFields(text);
    if (obj.sent == null && obj.sendOrders != null) obj.sent = obj.sendOrders;
    if (Object.keys(obj).length > 0) return obj;

    // mock 脚本 JSON 兜底
    try {
      const i = text.indexOf('{');
      if (i !== -1) {
        const parsed = JSON.parse(text.slice(i));
        if (parsed && typeof parsed === 'object') {
          if (parsed.sent == null && parsed.sendOrders != null) {
            parsed.sent = parsed.sendOrders;
          }
          return parsed;
        }
      }
    } catch { /* ignore */ }
  }

  return {};
}

ipcMain.handle('run-performance-test', async (_event, command, ...args) => {
  try {
    const scriptPath = mockPath('performance_test.js');
    const procArgs = [scriptPath, command, ...args.map(String)];

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const proc = spawnNodeScript(procArgs, {
        cwd: getTestCasesDir(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { NO_COLOR: '1', FORCE_COLOR: '0' },
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        try {
          const errText = stripAnsi(stderr.trim() || '');
          const outText = stripAnsi(stdout.trim() || '');

          if (code !== 0) {
            // start：脚本常已打出 runId 却以非 0 退出（警告打在 stderr）。
            // 能抠到 runId 就当成功，否则 Query 才“莫名好了”的体验会一直出现。
            if (command === 'start') {
              const runId = extractRunIdFromOutput(stdout) || extractRunIdFromOutput(stderr);
              if (runId) {
                finish({
                  ok: true,
                  data: { runId },
                  warning: errText || outText || `Process exited with code ${code}`,
                });
                return;
              }
            }

            finish({
              ok: false,
              error: errText || outText || `Process exited with code ${code}`,
            });
            return;
          }

          const data = parsePerformanceTestOutput(command, stdout);

          // start 再兜一层：exit 0 但 stdout 只有 banner + runId
          if (command === 'start' && !data?.runId) {
            const runId = extractRunIdFromOutput(stdout) || extractRunIdFromOutput(stderr);
            if (runId) {
              finish({ ok: true, data: { runId } });
              return;
            }
          }

          // status 解析出空对象时，若有错误文本（如收盘）按失败返回，避免前端把 progress 刷成 0
          if (
            command === 'status'
            && data
            && typeof data === 'object'
            && Object.keys(data).length === 0
          ) {
            if (errText || outText) {
              finish({ ok: false, error: errText || outText });
              return;
            }
          }

          finish({ ok: true, data });
        } catch (err) {
          finish({ ok: false, error: err.message });
        }
      });

      proc.on('error', (err) => {
        finish({ ok: false, error: err.message });
      });
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── IPC: list feature files ──────────── */
ipcMain.handle('list-feature-files', async () => {
  try {
    const dir = getTestCasesDir();
    const featuresDir = path.join(dir, 'features');
    let entries;
    try {
      entries = await fs.readdir(featuresDir, { withFileTypes: true });
    } catch {
      return { ok: true, data: [] }; // no features/ dir → empty list
    }

    const files = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.feature')) {
        const content = await fs.readFile(path.join(featuresDir, entry.name), 'utf-8');
        const parsed = parseFeatureFile(content);
        files.push({
          fileName: entry.name,
          featureName: parsed.featureName || entry.name,
          scenarios: parsed.scenarios.map((s) => ({
            name: s.name,
            line: s.line,
            tags: s.tags,
          })),
        });
      }
    }
    return { ok: true, data: files };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── IPC: run cucumber (streaming) ──────────── */

/**
 * Starts a cucumber-js test run with NDJSON streaming output.
 *
 * This is a STREAMING IPC handler — the renderer subscribes to three push
 * channels BEFORE calling runCucumber(), then this handler spawns cucumber-js
 * and pushes events line-by-line as they arrive.
 *
 * ══ Streaming protocol ══
 *
 *   Renderer calls:  api.runCucumber(params)        // ipcRenderer.send('run-cucumber', params)
 *   Main pushes:     'cucumber-stream-line'  — one NDJSON line at a time
 *                    'cucumber-stream-done'  — process exited cleanly (code 0 or 1)
 *                    'cucumber-stream-error' — process crashed or config error
 *
 * ══ Mutual exclusion ══
 *
 *   Only one cucumber process can run at a time. The module-level
 *   `runningCucumberProc` variable enforces this. If a second run is
 *   attempted, it's rejected with an error message.
 *
 * ══ NDJSON format ══
 *
 *   cucumber-js --format message outputs one JSON object per line (NDJSON).
 *   Each line is an "envelope" with a single key identifying the message type:
 *
 *     {"testRunStarted": {...}}
 *     {"testCaseStarted": {"testCase": {"name": "Add two numbers"}, ...}}
 *     {"testStepFinished": {"testResult": {"status": "PASSED"}, ...}}
 *     {"testCaseFinished": {"testResult": {"status": "PASSED"}, ...}}
 *     {"testRunFinished": {"success": true, ...}}
 *
 *   The rendering side (RegressionRunContext) parses and interprets these.
 *
 * ══ --name regex filtering ══
 *
 *   When scenarioNames is provided (Run by Cases mode), we build a regex
 *   pattern that matches any of the selected scenario names:
 *
 *     --name "^(Add two numbers|Subtract two numbers)$"
 *
 *   Special regex characters in scenario names are escaped with backslashes.
 *   We use spawn() WITHOUT shell:true to prevent cmd.exe from consuming the ^.
 *
 * ══ Exit codes ══
 *
 *   0 = all scenarios passed
 *   1 = one or more scenarios failed (still normal — NDJSON output is valid)
 *   other = process error (cucumber-js not found, syntax error, etc.)
 *
 * @param {IpcMainEvent} event
 * @param {{ featureFile?: string, tags?: string, scenarioNames?: string[] }} params
 */
ipcMain.on('run-cucumber', (event, params) => {
  const sender = event.sender;
  try {
    const dir = getTestCasesDir();

    if (runningCucumberProc) {
      sender.send('cucumber-stream-error', 'A test run is already in progress');
      return;
    }

    // cucumber-js from app-root node_modules (deps hoisted out of testCases)
    const cucumberBin = path.join(
      getAppNodeModules(),
      '@cucumber',
      'cucumber',
      'bin',
      'cucumber-js',
    );

    // --format message = NDJSON output, one JSON envelope per line
    const cucumberArgs = ['--format', 'message'];

    // Build target args based on mode
    //   feature mode:  run a specific .feature file
    //   tag / cases:   run all features/ (filtered by --tags or --name)
    if (params.featureFile) {
      cucumberArgs.push(path.posix.join('features', params.featureFile));
    } else {
      cucumberArgs.push('features/');
    }

    if (params.tags) {
      cucumberArgs.push('--tags', params.tags);
    }

    if (params.scenarioNames && params.scenarioNames.length > 0) {
      // Build a regex pattern matching selected scenario names
      // Escape regex meta-characters in scenario names, then join with |
      const pattern = params.scenarioNames
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      cucumberArgs.push('--name', `^(${pattern})$`);
    }

    // ELECTRON_RUN_AS_NODE — same as fix-sender; no shell:true (cmd.exe would eat ^)
    const proc = spawnNodeScript([cucumberBin, ...cucumberArgs], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    runningCucumberProc = proc;

    // ── stdout: line-buffered NDJSON streaming ──
    // Data arrives in chunks; we split on newlines and emit each complete
    // line immediately so the UI updates in real-time.
    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete trailing part for next chunk
      for (const line of lines) {
        if (line.trim()) sender.send('cucumber-stream-line', line.trim());
      }
    });

    // ── stderr: collected for error reporting ──
    // cucumber-js sends warnings and progress-bar info to stderr,
    // not actual errors. We collect it but only use it when the
    // exit code indicates a real error.
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    // ── close: process exited ──
    proc.on('close', (code) => {
      runningCucumberProc = null;
      // Flush any remaining buffer content
      if (buf.trim()) sender.send('cucumber-stream-line', buf.trim());
      // Code 0 = all passed, Code 1 = some failed (still normal)
      if (code === 0 || code === 1) {
        sender.send('cucumber-stream-done', { exitCode: code });
      } else {
        sender.send('cucumber-stream-error', stderr || `Process exited with code ${code}`);
      }
    });

    proc.on('error', (err) => {
      runningCucumberProc = null;
      sender.send('cucumber-stream-error', err.message);
    });
  } catch (err) {
    sender.send('cucumber-stream-error', err.message);
  }
});

/* ──────────── IPC: stop cucumber ──────────── */
ipcMain.handle('stop-cucumber', async () => {
  if (!runningCucumberProc) {
    return { ok: false, error: 'No running cucumber process' };
  }
  try {
    runningCucumberProc.kill('SIGTERM');
    // Force kill after 2s if still alive
    const proc = runningCucumberProc;
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }, 2000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── Windows Task Scheduler (Register-SchedularTask.ps1) ──────────── */

/**
 * Dev: <repo>/mock-testcases (sibling of Testing-UI).
 * Packaged path: TBD (not in this phase).
 */
function getSchedulerScriptDir() {
  return path.join(__dirname, '..', '..', 'mock-testcases');
}

function getSchedulerScriptPath() {
  return path.join(getSchedulerScriptDir(), 'Register-SchedularTask.ps1');
}

/**
 * Spawn powershell -File Register-SchedularTask.ps1 … ; parse last JSON object from stdout.
 * @param {string[]} psArgs  e.g. ['-mode', 'list-win']
 * @param {{ timeoutMs?: number }} [opts]
 */
function runSchedulerPs1(psArgs, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const scriptPath = getSchedulerScriptPath();
  const cwd = getSchedulerScriptDir();

  return new Promise((resolve) => {
    fs.access(scriptPath)
      .then(() => {
        const proc = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            ...psArgs.map(String),
          ],
          {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );

        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };

        const timer = setTimeout(() => {
          try { proc.kill(); } catch { /* */ }
          finish({ ok: false, error: `Timed out after ${timeoutMs / 1000}s` });
        }, timeoutMs);

        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('close', (code) => {
          const errText = (stderr || '').trim();
          const outText = (stdout || '').trim();

          if (code !== 0) {
            finish({
              ok: false,
              error: errText || outText || `Process exited with code ${code}`,
              data: { stdout: outText, stderr: errText, exitCode: code },
            });
            return;
          }

          // Prefer last JSON object line (ignore Write-Host noise)
          let parsed = null;
          const lines = outText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              parsed = JSON.parse(lines[i]);
              break;
            } catch { /* try previous */ }
          }
          if (!parsed && outText) {
            try { parsed = JSON.parse(outText); } catch { /* */ }
          }

          if (!parsed || typeof parsed !== 'object') {
            finish({
              ok: false,
              error: errText || `Invalid JSON output: ${outText.slice(0, 200)}`,
              data: { stdout: outText, stderr: errText, exitCode: code },
            });
            return;
          }

          finish({
            ok: parsed.ok !== false,
            data: parsed,
            error: parsed.ok === false ? (parsed.error || 'Script returned ok:false') : undefined,
          });
        });

        proc.on('error', (err) => {
          finish({ ok: false, error: err.message });
        });
      })
      .catch(() => {
        resolve({
          ok: false,
          error: `Scheduler script not found: ${scriptPath}`,
        });
      });
  });
}

/** List $schTaskMap catalog (for Setup / Will Register) */
ipcMain.handle('list-scheduler-tasks', async () => {
  try {
    const res = await runSchedulerPs1(['-mode', 'list'], { timeoutMs: 30_000 });
    if (!res.ok) return res;
    const raw = Array.isArray(res.data?.tasks) ? res.data.tasks : [];
    const tasks = raw.map((t) => ({
      categoryTag: String(t.categoryTag ?? ''),
      tag: String(t.tag ?? ''),
      registerTime: String(t.registerTime ?? ''),
      exchanges: Array.isArray(t.exchanges) ? t.exchanges.map(String) : [],
      parallel: t.parallel == null || t.parallel === '' ? null : String(t.parallel),
    })).filter((t) => t.categoryTag && t.tag);
    return { ok: true, data: { tasks } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/** List TestPlatform_* tasks from Windows Task Scheduler */
ipcMain.handle('list-win-scheduler-tasks', async () => {
  try {
    const res = await runSchedulerPs1(['-mode', 'list-win'], { timeoutMs: 30_000 });
    if (!res.ok) return res;
    const tasks = Array.isArray(res.data?.tasks) ? res.data.tasks : [];
    return { ok: true, data: { tasks } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/**
 * Register tasks via Register-SchedularTask.ps1 -mode pre-defined.
 * @param {{ mode?: string, env: string, categoryTag: string, scope?: string }} payload
 */
ipcMain.handle('register-scheduler-task', async (_event, payload = {}) => {
  try {
    const mode = String(payload.mode || 'pre-defined').trim() || 'pre-defined';
    const env = String(payload.env || '').trim();
    const categoryTag = String(payload.categoryTag || '').trim();
    const scope = String(payload.scope || '').trim();

    if (!env) return { ok: false, error: 'env is required' };
    if (!categoryTag) return { ok: false, error: 'categoryTag is required' };

    const psArgs = [
      '-mode', mode,
      '-env', env,
      '-categoryTag', categoryTag,
    ];
    if (scope) {
      psArgs.push('-scope', scope);
    }

    const res = await runSchedulerPs1(psArgs, { timeoutMs: 120_000 });
    if (!res.ok) return res;

    return {
      ok: true,
      data: {
        ...res.data,
        count: res.data?.count ?? (Array.isArray(res.data?.tasks) ? res.data.tasks.length : 0),
        scriptPath: getSchedulerScriptPath(),
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* ──────────── window ──────────── */

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.on('before-quit', () => {
  if (runningCucumberProc) {
    try { runningCucumberProc.kill('SIGKILL'); } catch { /* */ }
    runningCucumberProc = null;
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
