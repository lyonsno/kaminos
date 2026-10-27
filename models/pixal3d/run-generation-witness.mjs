import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { validatePixal3dGenerationInputs } from './generation-inputs.js';
import {
  pixal3dGenerationFields,
  admitPixal3dGenerationGpuBudget,
  validatePixal3dGenerationResult,
  persistPixal3dGenerationPhase,
  persistPixal3dGenerationAsset,
} from './generation-witness-checks.js';
import {
  finalizeSparseWitness,
  persistSparseWitnessResult,
  admitSparseWitnessResult,
} from '../trellis2/sparse-witness-finalize.mjs';
import { startProcessMemory } from '../trellis2/process-memory.mjs';
import { memoryBudgetBytes } from '../trellis2/generation-memory-policy.js';
import { validateDecoderActivationStorage } from '../trellis2/slat-decoder-witness-checks.js';
import { gitSourceIdentity } from '../trellis2/source-attestation.mjs';

const { values } = parseArgs({
  options: {
    ...Object.fromEntries(
      [
        'repo-root',
        'fixture',
        'chrome',
        'report',
        'expected-commit',
        'receiver',
        'memory-python',
        'gpu-buffer-budget-mib',
        'process-memory-budget-mib',
        'decoder-activation-storage',
      ].map(name => [name, { type: 'string' }]),
    ),
    'fields-only': { type: 'boolean', default: false },
    'skip-clean-check': { type: 'boolean', default: false },
  },
});

if (!values.report) throw new Error('--report is required');

let root;
let fixture;
let generationManifest;
const output = path.resolve(values.report);
const evidenceRoot = path.join(path.dirname(output), 'raw');
const report = {
  schema: 'pixal3d.image-generation-browser.v0',
  status: 'failed',
  phase: 'argument-admission',
  receiver: values.receiver ?? null,
  terminalEvidence: output,
  requestedRepoRoot: values['repo-root'] ?? null,
  requestedFixtureRoot: values.fixture ?? null,
  command: process.argv,
  expectedCommit: values['expected-commit'] ?? null,
  servedSources: {},
};
const persist = async () => {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let server;
let child;
let cdp;
let profile;
let processMemory;
let gpuBufferBudgetBytes;
let processMemoryBudgetBytes;

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  let failure;
  const rejectWaiters = message => {
    failure ||= new Error(message);
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
    for (const entries of listeners.values()) {
      for (const entry of entries) entry.reject(failure);
    }
    listeners.clear();
  };
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('browser CDP connection error')), {
      once: true,
    });
    socket.addEventListener(
      'close',
      () => reject(new Error('browser CDP connection closed before open')),
      { once: true },
    );
  });
  socket.addEventListener('message', event => {
    const row = JSON.parse(event.data);
    if (row.id) {
      const entry = pending.get(row.id);
      pending.delete(row.id);
      if (row.error) entry?.reject(new Error(JSON.stringify(row.error)));
      else entry?.resolve(row.result);
    } else {
      const key = `${row.sessionId || ''}:${row.method}`;
      for (const entry of listeners.get(key) || []) entry.resolve(row.params);
      listeners.delete(key);
    }
  });
  socket.addEventListener('close', () => rejectWaiters('browser CDP connection closed'));
  socket.addEventListener('error', () => rejectWaiters('browser CDP connection error'));
  return {
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (failure || socket.readyState !== WebSocket.OPEN) {
          reject(failure || new Error('browser CDP connection closed'));
          return;
        }
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        try {
          socket.send(
            JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
          );
        } catch (error) {
          pending.delete(id);
          reject(error);
          rejectWaiters('browser CDP connection error');
        }
      });
    },
    once(method, sessionId) {
      return new Promise((resolve, reject) => {
        if (failure || socket.readyState !== WebSocket.OPEN) {
          reject(failure || new Error('browser CDP connection closed'));
          return;
        }
        const key = `${sessionId || ''}:${method}`;
        listeners.set(key, [...(listeners.get(key) || []), { resolve, reject }]);
      });
    },
    close() {
      socket.close();
    },
  };
}

try {
  await persist();
  for (const name of ['repo-root', 'fixture', 'chrome', 'expected-commit', 'receiver']) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  report.phase = 'repo-root-admission';
  root = await fs.realpath(values['repo-root']);
  report.repoRoot = root;
  report.phase = 'fixture-admission';
  fixture = await fs.realpath(values.fixture);
  report.fixtureRoot = fixture;
  if (values['decoder-activation-storage'] !== undefined) {
    if (!['f32', 'f16'].includes(values['decoder-activation-storage'])) {
      throw new Error('--decoder-activation-storage requires f32 or f16');
    }
    report.requestedDecoderActivationStorage = values['decoder-activation-storage'];
  }
  report.phase = 'source-identity';
  report.sourceAttestation = gitSourceIdentity(root);
  report.commit = report.sourceAttestation.commit;
  report.dirty = report.sourceAttestation.dirty;
  if (
    report.commit !== report.expectedCommit ||
    (report.dirty && !values['skip-clean-check'])
  ) {
    throw new Error('source revision must be the exact clean requested commit');
  }
  report.fixtureSha256 = digest(await fs.readFile(path.join(fixture, 'manifest.json')));
  report.phase = 'generation-input-admission';
  generationManifest = JSON.parse(
    await fs.readFile(path.join(fixture, 'manifest.json'), 'utf8'),
  );
  validatePixal3dGenerationInputs(generationManifest);
  report.phase = 'memory-budget-admission';
  gpuBufferBudgetBytes = memoryBudgetBytes(
    values['gpu-buffer-budget-mib'],
    '--gpu-buffer-budget-mib',
  );
  processMemoryBudgetBytes = memoryBudgetBytes(
    values['process-memory-budget-mib'],
    '--process-memory-budget-mib',
  );
  report.memoryPolicy = {
    gpuBufferBudgetBytes: gpuBufferBudgetBytes ?? null,
    processMemoryBudgetBytes: processMemoryBudgetBytes ?? null,
    selection: 'explicit caller limits; no precision/input/settings substitution',
  };
  report.memoryPolicy.checkpointAdmission = admitPixal3dGenerationGpuBudget(
    generationManifest,
    gpuBufferBudgetBytes,
  );
  report.phase = 'browser-admission';
  if (/\/Applications\/Google Chrome\.app\//.test(values.chrome)) {
    throw new Error('GUI Google Chrome is not an isolated headless executable');
  }
  report.chrome = await fs.realpath(values.chrome);
  if (/\/Applications\/Google Chrome\.app\//.test(report.chrome)) {
    throw new Error('GUI Google Chrome is not an isolated headless executable');
  }
  await fs.mkdir(evidenceRoot, { recursive: true });
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      if (req.method === 'POST' && pathname === '/phase') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const row = JSON.parse(Buffer.concat(chunks).toString());
        await persistPixal3dGenerationPhase({
          report,
          row,
          kernelLogPath: path.join(evidenceRoot, 'kernel-events.jsonl'),
          append: fs.appendFile,
          persist,
        });
        res.end('saved');
        return;
      }
      if (req.method === 'POST' && pathname === '/witness-result') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const receipt = await persistSparseWitnessResult({
          report,
          bytes: Buffer.concat(chunks),
          outputPath: path.join(path.dirname(output), 'browser-result.json'),
          write: fs.writeFile,
        });
        await persist();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(receipt));
        return;
      }
      if (req.method === 'POST' && pathname === '/asset-output') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const artifact = await persistPixal3dGenerationAsset({
          report,
          bytes,
          outputPath: path.join(path.dirname(output), 'asset.glb'),
          write: fs.writeFile,
          persist,
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(artifact));
        return;
      }
      if (req.method === 'POST' && /^\/output\/[\w.-]+$/.test(pathname)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const name = pathname.split('/').at(-1);
        const dtype = req.headers['x-tensor-dtype'] ?? 'f32';
        if (!['f32', 'i32', 'u32'].includes(dtype)) {
          throw new Error('unrecognized output dtype');
        }
        const target = path.join(evidenceRoot, `${name}.${dtype}`);
        await fs.writeFile(target, bytes);
        report.rawOutputs ||= {};
        report.rawOutputs[name] = {
          path: target,
          dtype,
          byteLength: bytes.length,
          sha256: digest(bytes),
        };
        res.end('saved');
        return;
      }
      if (pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>Pixal3D WebGPU generation witness</title>');
        return;
      }
      const isFixture = pathname.startsWith('/fixture/');
      const base = isFixture ? fixture : root;
      const file = path.resolve(base, `.${isFixture ? pathname.slice(8) : pathname}`);
      if (!file.startsWith(base + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const bytes = await fs.readFile(file);
      if (!isFixture && /\.m?js$/.test(file)) {
        const relative = path.relative(root, file);
        if (!values['skip-clean-check']) {
          const admitted = execFileSync('git', ['show', `${report.commit}:${relative}`], {
            cwd: root,
          });
          if (digest(bytes) !== digest(admitted)) {
            throw new Error(`served source mismatch: ${relative}`);
          }
        }
        report.servedSources[relative] = digest(bytes);
      }
      res.setHeader(
        'Content-Type',
        /\.m?js$/.test(file)
          ? 'text/javascript'
          : file.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream',
      );
      res.setHeader('Cache-Control', 'no-store');
      res.end(bytes);
    } catch (error) {
      report.serverErrors ||= [];
      report.serverErrors.push(error.message);
      res.writeHead(500).end(error.message);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;
  report.phase = 'browser-launch';
  await persist();

  const memoryScript = path.join(root, 'models/trellis2/process-memory.py');
  const python = values['memory-python'] ?? '/usr/bin/python3';
  report.memory = {
    requested: true,
    scope: 'owned runner/browser descendants plus unique device-buffer ledger',
    python,
    script: memoryScript,
    scriptSha256: digest(await fs.readFile(memoryScript)),
  };
  processMemory = await startProcessMemory({
    python,
    script: memoryScript,
    rawPath: path.join(evidenceRoot, 'process-memory.jsonl'),
    maxFootprintBytes: processMemoryBudgetBytes,
    async onUnsafe(safety) {
      report.status = 'failed';
      report.memorySafety = {
        ...safety,
        ownedBrowserPid: child?.pid ?? null,
        action: 'prevent-launch-or-stop-exact-owned-browser',
      };
      try {
        await persist();
      } catch (error) {
        report.memorySafety.reportError = error.message;
      }
      if (child && child.exitCode === null && child.signalCode === null) {
        if (!child.kill('SIGTERM')) {
          throw new Error('could not stop owned browser after memory refusal');
        }
        report.memorySafety.signalSent = 'SIGTERM';
        await persist();
      }
    },
  });
  await persist();

  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pixal3d-webgpu-chrome-'));
  report.profilePath = profile;
  child = spawn(
    report.chrome,
    [
      '--headless=new',
      '--enable-unsafe-webgpu',
      '--remote-debugging-port=0',
      '--use-mock-keychain',
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  report.ownedBrowserPid = child.pid;
  child.once('exit', (code, signal) => {
    report.ownedBrowserExit = { code, signal, observedAt: new Date().toISOString() };
  });
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', bytes => {
      stderr += bytes.toString();
      report.browserStderr = stderr;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      reject(new Error(`browser exited before CDP: ${code}/${signal}`)),
    );
  });
  cdp = await connect(wsUrl);
  report.browserVersion = await cdp.call('Browser.getVersion');
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  await cdp.call('Page.enable', {}, sessionId);
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  await cdp.call('Page.navigate', { url: report.requestedUrl }, sessionId);
  await loaded;
  report.phase = 'native-generation-execution';
  await persist();
  const result = await cdp.call(
    'Runtime.evaluate',
    {
      expression: `(async () => {
        const { runPixal3dGenerationWitness } = await import('/models/pixal3d/pixal3d-generation-witness.js');
        const result = await runPixal3dGenerationWitness(${JSON.stringify(report.fixtureSha256)}, ${JSON.stringify({
          memoryMonitor: true,
          assetMode: values['fields-only'] ? 'retained-fields-only' : 'raw-glb',
          gpuBufferBudgetBytes,
          decoderActivationStorage: values['decoder-activation-storage'],
        })});
        const saved = await fetch('/witness-result', { method: 'POST', body: JSON.stringify(result) });
        if (!saved.ok) throw new Error('browser result was not durably saved');
        return { url: location.href, receipt: await saved.json() };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description || result.exceptionDetails.text,
    );
  }
  const value = result.result.value;
  report.effectiveUrl = value.url;
  value.result = admitSparseWitnessResult(report, value.receipt);
  if (value.url !== report.requestedUrl) {
    throw new Error('effective browser URL differs from requested route');
  }
  if (value.result.status !== 'succeeded') {
    throw new Error(value.result.error?.message || 'browser witness failed');
  }
  if (values['decoder-activation-storage'] !== undefined) {
    validateDecoderActivationStorage(value.result, {
      shape: values['decoder-activation-storage'],
      texture: values['decoder-activation-storage'],
    });
  }
  if (report.serverErrors?.length) {
    throw new Error(report.serverErrors.join('\n'));
  }
  const requiredOutputs = [...pixal3dGenerationFields(generationManifest)];
  const observedOutputs = { ...value.result.outputs };
  if (
    value.result.assetMode !== (values['fields-only'] ? 'retained-fields-only' : 'raw-glb')
  ) {
    throw new Error('effective generation asset mode differs from requested mode');
  }
  validatePixal3dGenerationResult(value.result, generationManifest);
  for (const name of [
    'models/trellis2/dinov3-serving.js',
    'models/pixal3d/pixal3d-generation.js',
    'models/pixal3d/generation-inputs.js',
    'models/pixal3d/naf.js',
    'models/pixal3d/proj-grid.js',
    'models/pixal3d/pixal3d-block.js',
    'models/pixal3d/pixal3d-flow.js',
    'models/pixal3d/pixal3d-generation-witness.js',
    'models/trellis2/slat-decoder.js',
    'webgpu-inference-kit/src/inference-runtime.js',
  ]) {
    if (!report.servedSources[name]) {
      throw new Error('missing Pixal3D generation served-source attestation ' + name);
    }
  }
  for (const name of requiredOutputs) {
    if (
      report.rawOutputs?.[name]?.byteLength !== observedOutputs[name].byteLength ||
      report.rawOutputs[name].dtype !== observedOutputs[name].dtype ||
      report.rawOutputs[name].sha256 !== observedOutputs[name].sha256
    ) {
      throw new Error('complete raw Pixal3D generation evidence required ' + name);
    }
  }
  report.status = 'succeeded';
  report.phase = null;
} catch (error) {
  report.status = 'failed';
  report.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await finalizeSparseWitness({
    report,
    persist,
    cleanup: [
      [
        'cdp',
        async () => {
          if (cdp) {
            try {
              await cdp.call('Browser.close');
            } catch {}
            cdp.close();
          }
        },
      ],
      [
        'browser',
        async () => {
          if (!child) return;
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            await new Promise(resolve => child.once('exit', resolve));
          }
        },
      ],
      [
        'server',
        async () => {
          if (server) await new Promise(resolve => server.close(resolve));
        },
      ],
      [
        'process-memory',
        async () => {
          if (!processMemory) return;
          report.memory.process = await processMemory.stop();
          if (report.memory.process.status !== 'observed' || report.memorySafety) {
            throw new Error(
              report.memorySafety
                ? `process memory budget exceeded: ${report.memorySafety.maxObservedFootprintBytes} > ${report.memorySafety.maxFootprintBytes}`
                : 'process memory observation failed: ' +
                    (report.memory.process.error ?? report.memory.process.status),
            );
          }
        },
      ],
      [
        'profile',
        async () => {
          if (profile) await fs.rm(profile, { recursive: true, force: true });
        },
      ],
    ],
  });
}
