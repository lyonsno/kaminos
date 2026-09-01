#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    values.set(key, next && !next.startsWith('--') ? next : true);
    if (next && !next.startsWith('--')) index += 1;
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
const route = String(args.get('--url') || '');
const reportPath = String(args.get('--report') || '');
const expectedCommit = String(args.get('--expected-commit') || '');
const deadlineMs = Number(args.get('--deadline-ms'));
const allowDirty = args.has('--allow-dirty');
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

assert.ok(route.startsWith('http://127.0.0.1:'), '--url must be an explicit local Kaminos route');
assert.ok(reportPath, '--report is required');
assert.match(expectedCommit, /^[0-9a-f]{40}$/, '--expected-commit must be exact');
assert.ok(Number.isFinite(deadlineMs) && deadlineMs > 0, '--deadline-ms must be explicit and positive');

const routeUrl = new URL(route);
const expectedPresetId = routeUrl.searchParams.get('settings_preset');
const expectedPlateUrl = `/api/read?root=${encodeURIComponent(routeUrl.searchParams.get('kiln_plate_root'))}&path=${encodeURIComponent(routeUrl.searchParams.get('kiln_plate_path'))}`;
const expectedNormalUrl = `/api/read?root=${encodeURIComponent(routeUrl.searchParams.get('kiln_normal_root'))}&path=${encodeURIComponent(routeUrl.searchParams.get('kiln_normal_path'))}`;
const expectedUniformData = Array.from(new Float32Array([
  Number(routeUrl.searchParams.get('kiln_fire_x')),
  Number(routeUrl.searchParams.get('kiln_fire_y')),
  Number(routeUrl.searchParams.get('kiln_fire_scale_x')),
  Number(routeUrl.searchParams.get('kiln_fire_scale_y')),
  Number(routeUrl.searchParams.get('kiln_fire_x')),
  Number(routeUrl.searchParams.get('kiln_fire_y')),
  Number(routeUrl.searchParams.get('kiln_light_radius')),
  Number(routeUrl.searchParams.get('kiln_light_intensity')),
  Number(routeUrl.searchParams.get('kiln_plate_ambient')),
  Number(routeUrl.searchParams.get('kiln_normal_y_sign')),
  1.5,
  0.28,
  1.0,
  0.255,
  0.045,
  0,
]));

const report = {
  schema: 'kaminos.kiln-fixed-camera-browser-alias-witness.v0',
  status: 'failed',
  phase: 'preflight',
  requestedRoute: route,
  expectedCommit,
  deadlineMs,
  allowDirty,
  browserErrors: [],
};
let browser = null;
let ws = null;

function writeReport() {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(predicate, description) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < deadlineMs) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`caller deadline elapsed waiting for ${description}`);
}

async function waitForCdp() {
  return waitUntil(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  }, 'Chrome DevTools endpoint');
}

function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') {
      report.browserErrors.push({ method: message.method, detail: message.params?.exceptionDetails?.text || 'runtime exception' });
    }
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      report.browserErrors.push({ method: message.method, detail: message.params.entry.text });
    }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return {
    socket,
    opened,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { method, resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

const injectedProbe = String.raw`
(() => {
  const clone = value => value == null ? value : structuredClone(value);
  const poison = value => {
    if (!value || typeof value !== 'object') return value;
    if (value.kilnFixedCameraComposition) poison(value.kilnFixedCameraComposition);
    if (value.preset) { value.preset.id = 'poison-preset'; value.preset.authority = 'poison-authority'; }
    for (const key of ['plate', 'normal']) {
      if (!value[key]) continue;
      value[key].root = 'poison-root';
      value[key].path = 'poison-path';
      value[key].sha256 = '0'.repeat(64);
      value[key].url = '/poison';
      value[key].expectedDimensions = [1, 1];
    }
    if (value.fire) { value.fire.center = [0, 0]; value.fire.scale = [2, 2]; }
    if (value.light) { value.light.radius = 2; value.light.intensity = 16; value.light.ambient = 1; value.light.normalYSign = 1; }
    if (value.assets) {
      for (const asset of Object.values(value.assets)) {
        asset.effectiveRoot = 'poison-root';
        asset.effectivePath = 'poison-path';
        asset.effectiveSha256 = 'f'.repeat(64);
        asset.width = 1;
        asset.height = 1;
      }
    }
    if (value.uniformUpload?.values) value.uniformUpload.values.fill(99);
    return value;
  };
  const probe = window.__kilnAliasProbe = {
    kilnAssignments: [],
    statusAssignments: [],
    fetches: [],
    fetchReleased: false,
    poison,
  };
  for (const [property, collection] of [
    ['__kaminosKilnFixedCameraCompositionReceipt', probe.kilnAssignments],
    ['__kaminosVolumeStatusReceipt', probe.statusAssignments],
  ]) {
    let current = null;
    Object.defineProperty(window, property, {
      configurable: false,
      get: () => current,
      set: value => {
        const before = clone(value);
        poison(value);
        current = value;
        collection.push({ before, after: clone(value) });
      },
    });
  }
  const nativeFetch = window.fetch.bind(window);
  let releaseFetches;
  const fetchGate = new Promise(resolve => { releaseFetches = resolve; });
  probe.releaseFetches = () => { probe.fetchReleased = true; releaseFetches(); };
  window.fetch = async (...fetchArgs) => {
    const requested = String(fetchArgs[0]?.url || fetchArgs[0]);
    if (requested.includes('/api/read?root=')) {
      probe.fetches.push(requested);
      await fetchGate;
    }
    return nativeFetch(...fetchArgs);
  };
})();
`;

async function evaluate(call, expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  return result.result.value;
}

try {
  const runtimeResponse = await fetch(`${routeUrl.origin}/api/runtime-config`);
  assert.equal(runtimeResponse.ok, true, 'runtime config route failed');
  report.runtime = await runtimeResponse.json();
  assert.equal(report.runtime.source?.commit, expectedCommit, 'runtime source commit drifted');
  if (!allowDirty) assert.equal(report.runtime.source?.dirty, false, 'runtime source is dirty');

  report.phase = 'browser-launch';
  const userDataDir = mkdtempSync('/tmp/kaminos-kiln-alias-witness-');
  browser = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1536,1024',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForCdp();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Chrome page target missing');
  const cdp = connectCdp(page.webSocketDebuggerUrl);
  ws = cdp.socket;
  await cdp.opened;
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Log.enable');
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: injectedProbe });

  report.phase = 'initialization-suspended';
  await cdp.call('Page.navigate', { url: route });
  const suspended = await waitUntil(async () => evaluate(cdp.call, `(() => {
    const probe = window.__kilnAliasProbe;
    const state = window.__kaminosVolumePrototype?.debugState?.();
    if (!probe || probe.fetches.length < 1 || !state?.kilnFixedCameraComposition) return null;
    probe.poison(state.kilnFixedCameraComposition);
    return {
      fetches: [...probe.fetches],
      kilnAssignments: structuredClone(probe.kilnAssignments),
      statusAssignments: structuredClone(probe.statusAssignments),
      poisonedDebugProjection: state.kilnFixedCameraComposition,
    };
  })()`), 'suspended kiln asset initialization');
  report.suspended = suspended;
  assert.deepEqual(
    suspended.kilnAssignments.slice(0, 2).map(entry => entry.before?.status),
    ['requested', 'route-admitted'],
    'requested and route-admitted window projections were not trapped',
  );
  assert.ok(
    suspended.kilnAssignments.some(entry => entry.before?.status === 'initializing'),
    'initializing callback projection was not trapped',
  );

  report.phase = 'asset-release';
  await evaluate(cdp.call, 'window.__kilnAliasProbe.releaseFetches()');
  const terminal = await waitUntil(async () => evaluate(cdp.call, `(() => {
    const probe = window.__kilnAliasProbe;
    const fresh = window.__kaminosVolumePrototype?.debugState?.().kilnFixedCameraComposition;
    const firstFrame = [...(probe?.kilnAssignments || [])].reverse().find(entry => entry.before?.firstFrame)?.before;
    if (!fresh || fresh.status !== 'effective' || !fresh.firstFrame || !firstFrame) return null;
    return {
      fetches: [...probe.fetches],
      kilnAssignments: structuredClone(probe.kilnAssignments),
      statusAssignments: structuredClone(probe.statusAssignments),
      freshDebugProjection: fresh,
      firstFrame,
    };
  })()`), 'effective detached kiln receipt');
  report.terminal = terminal;

  const effective = terminal.freshDebugProjection;
  assert.equal(effective.preset.id, expectedPresetId, 'private preset identity was mutated through a public receipt');
  assert.equal(effective.assets.plate.effectiveSha256, routeUrl.searchParams.get('kiln_plate_sha256'));
  assert.equal(effective.assets.normal.effectiveSha256, routeUrl.searchParams.get('kiln_normal_sha256'));
  assert.ok(terminal.fetches.some(value => value.endsWith(expectedPlateUrl)), 'canonical plate URL was not fetched');
  assert.ok(terminal.fetches.some(value => value.endsWith(expectedNormalUrl)), 'canonical normal URL was not fetched');
  assert.deepEqual(effective.uniformUpload?.values, expectedUniformData, 'uploaded kiln uniforms did not retain private route values');
  assert.equal(effective.uniformUpload?.byteLength, expectedUniformData.length * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(effective.renderer?.flameCount, 1);
  assert.equal(effective.failurePhase, null);
  assert.equal(effective.firstFrame?.simStepCount > 0, true);
  const statusPhases = terminal.statusAssignments
    .map(entry => entry.before?.kilnFixedCameraComposition?.status)
    .filter(Boolean);
  assert.ok(statusPhases.includes('initializing'), 'detached initializing status projection was not observed');
  assert.ok(statusPhases.includes('effective'), 'detached effective status projection was not observed');
  assert.equal(report.browserErrors.length, 0, 'browser emitted an exception or error log');

  report.phase = 'complete';
  report.status = 'passed';
  report.reportSha256BeforeWrite = null;
  writeReport();
  report.reportSha256BeforeWrite = createHash('sha256').update(readFileSync(reportPath)).digest('hex');
  writeReport();
  console.log(`kiln fixed-camera browser alias witness passed: ${reportPath}`);
} catch (error) {
  report.error = error?.stack || error?.message || String(error);
  writeReport();
  console.error(report.error);
  process.exitCode = 1;
} finally {
  ws?.close();
  browser?.kill('SIGTERM');
}
