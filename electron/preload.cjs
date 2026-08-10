/**
 * ═══════════════════════════════════════════════════════════════════
 * Preload Script — Security Bridge
 * ═══════════════════════════════════════════════════════════════════
 *
 * This script runs in a privileged context BEFORE the renderer process
 * loads. It uses Electron's `contextBridge` to expose a SAFE, curated
 * API (`window.electronAPI`) to the React frontend.
 *
 * ══ Security model ══
 *
 *   Main Process (Node.js)          Renderer Process (React/Chromium)
 *   ┌─────────────────────┐         ┌──────────────────────────────┐
 *   │ ipcMain.handle()    │◄────────│ ipcRenderer.invoke()         │
 *   │ ipcMain.on()        │◄────────│ ipcRenderer.send()           │
 *   │ event.sender.send() │────────►│ ipcRenderer.on()             │
 *   └─────────────────────┘         │                              │
 *                                   │ window.electronAPI.xxx()     │
 *                                   └──────────────────────────────┘
 *
 *   The renderer CANNOT access Node.js APIs (fs, child_process, etc.)
 *   directly. All privileged operations must go through the IPC bridge.
 *
 * ══ API design patterns ══
 *
 *   Request-Response (Promise-based):
 *     Main:   ipcMain.handle('channel', async (event, ...args) => { ... })
 *     Bridge: channel: (...args) => ipcRenderer.invoke('channel', ...args)
 *     Usage:  const result = await api.channel(arg)
 *
 *   Streaming (subscription-based):
 *     Main:   ipcMain.on('start', (event) => {
 *               event.sender.send('msg', data)
 *               event.sender.send('done')
 *             })
 *     Bridge: onStream(onMessage, onDone, onError) => {
 *               // register listeners, return cleanup function
 *             }
 *     Usage:  const unsub = api.onStream(handleMsg, handleDone, handleError)
 *             api.startStream()  // must subscribe BEFORE starting!
 *
 *   The streaming pattern requires subscribing BEFORE triggering the
 *   action, otherwise events may be missed. This is enforced by the
 *   API design: onXxxStream() returns a cleanup function, and runXxx()
 *   is a separate call.
 *
 * ══ Channel naming convention ══
 *
 *   Invoke channels:   kebab-case noun (e.g. 'get-mock-dir', 'list-feature-files')
 *   Send channels:     verb-noun (e.g. 'run-cucumber', 'run-fix-sender')
 *   Push channels:     <send-channel>-<event> (e.g. 'cucumber-stream-line')
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** The OS platform string: 'win32', 'darwin', 'linux', etc. */
  platform: process.platform,

  /* ─── Built-in testCases path ─── */

  /** Absolute path of the bundled testCases directory */
  getMockDir: () => ipcRenderer.invoke('get-mock-dir'),

  /** Disabled — testCases is bundled (kept for API compatibility) */
  setMockDir: (dir) => ipcRenderer.invoke('set-mock-dir', dir),

  /** Disabled — testCases is bundled (kept for API compatibility) */
  pickMockDir: () => ipcRenderer.invoke('pick-mock-dir'),

  /* ─── .env.qa ─── */

  /**
   * Read the .env.qa file from the mock directory.
   * Returns parsed key-value pairs.
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  readEnvQA: () => ipcRenderer.invoke('read-env-qa'),

  /**
   * Write or update a single key in the .env.qa file.
   * Creates the key if it doesn't exist; updates in-place if it does.
   * @param {string} key
   * @param {string} value
   */
  writeEnvQA: (key, value) => ipcRenderer.invoke('write-env-qa', key, value),

  /**
   * Scan all .env* files in the mock directory.
   * Returns every URL-type entry across all env files.
   * @returns {Promise<{ok: boolean, data?: Array<{fileName, key, url, hostname, port}>, error?: string}>}
   */
  listEnvFiles: () => ipcRenderer.invoke('list-env-files'),
  readEnvFile: (filename) => ipcRenderer.invoke('read-env-file', filename),

  /* ─── Fix-Bulk (Stress Test) ─── */

  /**
   * Run the fix-bulk.js script.
   * @param {number} mode  1=start send, 2=check status, 3=force stop
   * @param  {...any} args mode-specific arguments
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  runFixBulk: (mode, ...args) => ipcRenderer.invoke('run-fix-bulk', mode, ...args),

  /* ─── Performance Test (Stress Test) ─── */

  /**
   * Run the performance_test.js script.
   * @param {string} command  'start', 'status', or 'stop'
   * @param  {...any} args    command-specific arguments
   *    start: targetCompId, msgPerSecond, durationSecond, contractNo, price, exchange
   *    status / stop: runId
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  runPerformanceTest: (command, ...args) =>
    ipcRenderer.invoke('run-performance-test', command, ...args),

  /* ─── Fix-Sender (Streaming) ─── */

  /**
   * Start send-fix.js for each queued message (streaming stdout to UI).
   * MUST call onFixSenderStream() FIRST to subscribe, then call this.
   * @param {{ messages: string[], suffix?: string }} payload
   */
  runFixSender: (payload) => ipcRenderer.send('run-fix-sender', payload),

  /**
   * Subscribe to streaming output from send-fix.js.
   *
   * MUST be called BEFORE runFixSender() to avoid missing events.
   *
   * @param {function(string): void} onMessage  called with each output line
   * @param {function(): void}        onDone     called when the process exits successfully
   * @param {function(string): void}  onError    called on process error
   * @returns {function(): void} cleanup — call to unsubscribe (removes all listeners)
   */
  onFixSenderStream: (onMessage, onDone, onError) => {
    const msgHandler = (_event, line) => onMessage(line);
    const doneHandler = () => { cleanup(); onDone(); };
    const errHandler = (_event, msg) => { cleanup(); onError(msg); };
    function cleanup() {
      ipcRenderer.removeListener('fix-sender-message', msgHandler);
      ipcRenderer.removeListener('fix-sender-done', doneHandler);
      ipcRenderer.removeListener('fix-sender-error', errHandler);
    }
    ipcRenderer.on('fix-sender-message', msgHandler);
    ipcRenderer.once('fix-sender-done', doneHandler);
    ipcRenderer.once('fix-sender-error', errHandler);
    return cleanup;
  },

  /* ─── Feature Files ─── */

  /**
   * List all .feature files in the bundled testCases/features/ directory.
   * Each file is parsed for its Feature name and Scenario list.
   * @returns {Promise<{ok: boolean, data?: Array<{fileName, featureName, scenarios}>, error?: string}>}
   */
  listFeatureFiles: () => ipcRenderer.invoke('list-feature-files'),

  /* ─── Cucumber (Streaming) ─── */

  /**
   * Start a cucumber-js test run (streaming NDJSON output).
   * MUST call onCucumberStream() FIRST to subscribe, then call this.
   *
   * @param {object} params
   * @param {string} [params.featureFile]   specific .feature file name
   * @param {string} [params.tags]          cucumber tag expression (e.g. "@smoke or @math")
   * @param {string[]} [params.scenarioNames]  specific scenario names to run (--name regex)
   */
  runCucumber: (params) => ipcRenderer.send('run-cucumber', params),

  /**
   * Subscribe to the cucumber-js NDJSON test output stream.
   *
   * MUST be called BEFORE runCucumber() to avoid missing events.
   *
   * ══ NDJSON envelope types emitted ══
   *
   *   Each 'cucumber-stream-line' carries one JSON line (an "envelope").
   *   The rendering side (RegressionRunContext) parses these to update
   *   the console output, progress bar, and stats counters:
   *
   *     testRunStarted       — marks the beginning of the test run
   *     testCaseStarted      — a scenario is starting (▶)
   *     testStepFinished     — a step completed (✓ / ✗ / ?)
   *     testCaseFinished     — a scenario completed (PASSED / FAILED / SKIPPED)
   *     testRunFinished      — all scenarios done
   *     meta, gherkinDocument, pickle, source, ... — ignored for console display
   *
   * @param {function(string): void} onLine   called with each NDJSON line
   * @param {function({exitCode: number}): void} onDone  called when the test run finishes
   * @param {function(string): void} onError  called on process/config error
   * @returns {function(): void} cleanup — call to unsubscribe
   */
  onCucumberStream: (onLine, onDone, onError) => {
    const lineHandler = (_event, line) => onLine(line);
    const doneHandler = (_event, info) => { cleanup(); onDone(info); };
    const errHandler = (_event, msg) => { cleanup(); onError(msg); };
    function cleanup() {
      ipcRenderer.removeListener('cucumber-stream-line', lineHandler);
      ipcRenderer.removeListener('cucumber-stream-done', doneHandler);
      ipcRenderer.removeListener('cucumber-stream-error', errHandler);
    }
    ipcRenderer.on('cucumber-stream-line', lineHandler);
    ipcRenderer.once('cucumber-stream-done', doneHandler);
    ipcRenderer.once('cucumber-stream-error', errHandler);
    return cleanup;
  },

  /* ─── Cucumber Control ─── */

  /**
   * Stop the currently running cucumber-js test process.
   * Sends SIGTERM first, then SIGKILL after 2 seconds if still running.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  stopCucumber: () => ipcRenderer.invoke('stop-cucumber'),

  /* ─── Windows Task Scheduler ─── */

  /**
   * List catalog from Register-SchedularTask.ps1 -mode list ($schTaskMap).
   * @returns {Promise<{ok: boolean, data?: { tasks: Array }, error?: string}>}
   */
  listSchedulerTasks: () => ipcRenderer.invoke('list-scheduler-tasks'),

  /**
   * List TestPlatform_* tasks from Windows Task Scheduler
   * (Register-SchedularTask.ps1 -mode list-win).
   * @returns {Promise<{ok: boolean, data?: { tasks: Array }, error?: string}>}
   */
  listWinSchedulerTasks: () => ipcRenderer.invoke('list-win-scheduler-tasks'),

  /**
   * Register Windows scheduled tasks
   * (Register-SchedularTask.ps1 -mode pre-defined …).
   * @param {{ mode?: string, env: string, categoryTag: string, scope?: string }} payload
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  registerSchedulerTask: (payload) =>
    ipcRenderer.invoke('register-scheduler-task', payload),
});
