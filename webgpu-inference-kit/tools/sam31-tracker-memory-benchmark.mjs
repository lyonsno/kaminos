#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { endianness } from 'node:os';
import { basename, dirname, extname, isAbsolute, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readCompleteChunkedJsonEvidence } from '../src/chunked-json-evidence.js';

const KIT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT_NAMES = ['conditionedFeatures', 'selectedMasks', 'objectScores', 'objectPointers'];
const SCHEMA = 'kaminos.sam31-tracker-memory-benchmark.v0';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const contained = (root, path) => path === root || path.startsWith(`${root}${sep}`);

export function validateBenchmarkPlan(plan, baseDir = process.cwd()) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('benchmark plan must be an object');
  const path = (value, name) => {
    if (typeof value !== 'string' || !value) throw new Error(`${name} must be a filesystem path`);
    return resolve(baseDir, value);
  };
  if (!Array.isArray(plan.sourceImages) || plan.sourceImages.length !== 2) throw new Error('sourceImages must contain two file paths');
  if (typeof plan.commit !== 'string' || !/^[a-f0-9]{40}$/.test(plan.commit)) throw new Error('commit must be the full browser-kit source commit');
  const geometry = plan.expectedGeometry;
  for (const name of ['imageHeight', 'imageWidth', 'queryHeight', 'queryWidth', 'queryTokens', 'memoryTokens', 'maskHeight', 'maskWidth', 'channels', 'multiplexCount']) {
    if (!Number.isSafeInteger(geometry?.[name]) || geometry[name] <= 0) throw new Error(`expectedGeometry.${name} must be a positive safe integer`);
  }
  if (geometry.imageHeight !== geometry.queryHeight * 14 || geometry.imageWidth !== geometry.queryWidth * 14
    || geometry.queryTokens !== geometry.queryHeight * geometry.queryWidth || geometry.memoryTokens !== geometry.queryTokens + geometry.multiplexCount
    || geometry.maskHeight !== geometry.queryHeight * 4 || geometry.maskWidth !== geometry.queryWidth * 4
    || geometry.channels !== 256 || geometry.multiplexCount !== 16) throw new Error('expectedGeometry must describe the existing SAM3.1 two-frame/one-conditioning-bank route');
  const maskShape = [geometry.multiplexCount, 1, geometry.queryHeight * 16, geometry.queryWidth * 16];
  if (!same(plan.initialMask?.shape, maskShape)) throw new Error(`initialMask.shape must preserve the source mask geometry ${JSON.stringify(maskShape)}`);
  if (!Array.isArray(plan.runs) || plan.runs.length === 0) throw new Error('runs must be a nonempty ordered list');
  for (const run of plan.runs) {
    if (!run || !['flash', 'online'].includes(run.mode)) throw new Error('every run.mode must be flash or online');
    if (typeof run.warmup !== 'boolean') throw new Error('every run.warmup must be a boolean');
  }
  for (const mode of ['flash', 'online']) if (!plan.runs.some(run => run.mode === mode && run.warmup === false)) throw new Error(`runs must include a measured ${mode} invocation`);
  return {
    ...plan,
    modelPackageRoot: path(plan.modelPackageRoot, 'modelPackageRoot'),
    sourceImages: plan.sourceImages.map((value, index) => path(value, `sourceImages[${index}]`)),
    initialMask: { ...plan.initialMask, file: path(plan.initialMask.file, 'initialMask.file'), shape: maskShape },
    outputDir: path(plan.outputDir, 'outputDir'),
    runs: plan.runs.map(run => ({ ...run })), expectedGeometry: { ...geometry },
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function contentType(path) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' })[extname(path)] || 'application/octet-stream';
}

export async function startBenchmarkServer({ mounts, browserPlan, inputs, snapshots = {}, onOutput }) {
  const roots = Object.fromEntries(await Promise.all(Object.entries(mounts).map(async ([route, root]) => [route, await realpath(root)])));
  const headers = { 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' };
  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => { response.writeHead(status, { ...headers, 'content-type': type }); response.end(body); };
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/api/benchmark-plan' && request.method === 'GET') { send(200, JSON.stringify(browserPlan)); return; }
      const output = pathname.match(/^\/api\/output\/(\d+)\/(conditionedFeatures|selectedMasks|objectScores|objectPointers)$/);
      if (output && request.method === 'POST') { send(200, JSON.stringify(await onOutput(Number(output[1]), output[2], request))); return; }
      if (request.method !== 'GET') { send(405, JSON.stringify({ error: 'method not allowed' })); return; }
      if (Object.hasOwn(inputs, pathname)) { send(200, inputs[pathname], 'application/octet-stream'); return; }
      if (Object.hasOwn(snapshots, pathname)) { send(200, snapshots[pathname], contentType(pathname)); return; }
      const route = Object.keys(roots).sort((a, b) => b.length - a.length).find(prefix => pathname.startsWith(prefix));
      if (!route) { send(404, JSON.stringify({ error: 'unmounted path' })); return; }
      const root = roots[route];
      const file = resolve(root, pathname.slice(route.length));
      if (!contained(root, file)) { send(403, JSON.stringify({ error: 'outside mount' })); return; }
      let effective;
      try { effective = await realpath(file); } catch { send(404, JSON.stringify({ error: 'missing file' })); return; }
      if (!contained(root, effective)) { send(403, JSON.stringify({ error: 'symlink outside mount' })); return; }
      if (!(await stat(effective)).isFile()) { send(404, JSON.stringify({ error: 'not a file' })); return; }
      response.writeHead(200, { ...headers, 'content-type': contentType(effective) });
      await pipeline(createReadStream(effective), response);
    } catch (error) {
      // Refusals can happen before a large upload is consumed. Drain it and
      // close this connection so the browser cannot wait on an unread body.
      if (request.method === 'POST') { request.resume(); response.setHeader('connection', 'close'); }
      if (!response.headersSent) send(500, JSON.stringify({ error: String(error.message || error) }));
      else response.destroy(error);
    }
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 0;
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() { server.closeAllConnections(); await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())); },
  };
}

async function sourceSnapshot() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: KIT_ROOT, encoding: 'utf8' }).trim();
  const gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: KIT_ROOT, encoding: 'utf8' });
  const files = {};
  const snapshots = {};
  async function walk(relative) {
    for (const entry of await readdir(resolve(KIT_ROOT, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.js')) {
        const bytes = await readFile(resolve(KIT_ROOT, path));
        snapshots[`/${path}`] = bytes; files[path] = hash(bytes);
      }
    }
  }
  await walk('src');
  for (const relative of ['smokes/sam31-tracker-memory-benchmark.html', 'tools/sam31-tracker-memory-benchmark.mjs', 'tools/sam31-tracker-memory-benchmark-evidence.mjs']) {
    const bytes = await readFile(resolve(KIT_ROOT, relative));
    files[relative] = hash(bytes);
    if (relative.endsWith('.html')) snapshots[`/${relative}`] = bytes;
  }
  return { source: { kitRoot: KIT_ROOT, commit, gitStatus, files, serving: 'snapshotted-source-modules' }, snapshots };
}

async function prepareInputs(plan, runDir) {
  const location = await realpath(plan.modelPackageRoot);
  const rootFile = (await stat(location)).isDirectory() ? resolve(location, 'tracker-model-root.json') : location;
  const packageDir = dirname(rootFile);
  const rootBytes = await readFile(rootFile);
  const root = JSON.parse(rootBytes);
  if (!root.modelPackage?.file || isAbsolute(root.modelPackage.file)) throw new Error('model root must reference a package-relative model manifest');
  const modelFile = await realpath(resolve(packageDir, root.modelPackage.file));
  if (!contained(packageDir, modelFile)) throw new Error('model manifest escapes the package mount');
  const modelBytes = await readFile(modelFile);
  if (hash(modelBytes) !== root.modelPackage.sha256) throw new Error('model manifest hash differs from model root');
  const model = JSON.parse(modelBytes);
  if (typeof model.packageId !== 'string' || !model.packageId) throw new Error('model package identity is missing');
  const maskGeometry = model.geometry?.episode;
  if (maskGeometry?.sourceMaskHeight !== plan.initialMask.shape[2] || maskGeometry?.sourceMaskWidth !== plan.initialMask.shape[3] || maskGeometry?.multiplexCount !== plan.initialMask.shape[0]) throw new Error('model package source-mask geometry differs from the plan');
  const sourceImages = [];
  const inputs = {};
  const identities = { sourceImages: [], initialMask: null };
  const inputDir = resolve(runDir, 'inputs');
  await mkdir(inputDir, { recursive: true });
  for (let index = 0; index < 2; index += 1) {
    const bytes = await readFile(plan.sourceImages[index]);
    if (!bytes.length) throw new Error(`source image ${index} is empty`);
    const file = resolve(inputDir, `frame-${index}.encoded`);
    await writeFile(file, bytes, { flag: 'wx' });
    inputs[`/caller/frame-${index}`] = bytes; sourceImages.push(`/caller/frame-${index}`);
    identities.sourceImages.push({ requestedFile: plan.sourceImages[index], file, sha256: hash(bytes), byteLength: bytes.length });
  }
  if (identities.sourceImages[0].sha256 === identities.sourceImages[1].sha256) throw new Error('source images must be distinct');
  const mask = await readFile(plan.initialMask.file);
  const expectedBytes = plan.initialMask.shape.reduce((product, dimension) => product * dimension, 4);
  if (mask.length !== expectedBytes) throw new Error(`initial mask byte length ${mask.length} != ${expectedBytes}`);
  const maskFile = resolve(inputDir, 'initial-mask.f32');
  await writeFile(maskFile, mask, { flag: 'wx' });
  inputs['/caller/mask'] = mask;
  identities.initialMask = { requestedFile: plan.initialMask.file, file: maskFile, sha256: hash(mask), byteLength: mask.length, shape: plan.initialMask.shape, dtype: 'float32-le' };
  await writeFile(resolve(inputDir, 'tracker-model-root.json'), rootBytes, { flag: 'wx' });
  await writeFile(resolve(inputDir, 'sam31-model-package.json'), modelBytes, { flag: 'wx' });
  return {
    inputs, identities,
    package: { rootFile, rootSha256: hash(rootBytes), modelFile, modelSha256: hash(modelBytes), packageId: model.packageId, source: model.source, model: model.model, geometry: model.geometry },
    packageDir,
    snapshots: { [`/package/${basename(rootFile)}`]: rootBytes, [`/package/${root.modelPackage.file}`]: modelBytes },
    browserPlan: { modelPackageRoot: `/package/${basename(rootFile)}`, sourceImages, initialMask: { file: '/caller/mask', shape: plan.initialMask.shape }, commit: plan.commit, modelPackageId: model.packageId, expectedGeometry: plan.expectedGeometry },
  };
}

async function independentBrowser(path) {
  if (!path) throw new Error('CHROME_PATH must identify an independent Chrome for Testing or Chromium executable');
  const executable = await realpath(path);
  if (executable.includes('/Google Chrome.app/') || !['Google Chrome for Testing', 'chromium', 'chrome', 'chrome-headless-shell'].includes(basename(executable))) throw new Error(`CHROME_PATH is not an independent test browser: ${executable}`);
  if (!(await stat(executable)).isFile()) throw new Error('CHROME_PATH must identify a file');
  return executable;
}

export async function runBenchmark({ planPath, reportPath, playwrightModule = process.env.PLAYWRIGHT_MODULE, chromePath = process.env.CHROME_PATH }) {
  if (!planPath || !reportPath) throw new Error('--plan and --report are required');
  reportPath = resolve(reportPath);
  const report = {
    schema: SCHEMA, runId: randomUUID(), status: 'running', startedAt: new Date().toISOString(), planPath: resolve(planPath), reportPath,
    primary_output_written: false, timeoutMs: 0, phase: 'read-plan', runs: [], browserEvents: [],
    scope: { episode: 'two-image-first-propagation', conditioningFrames: 1, streamingFPS: false, timing: 'host-wall-including-compile-upload-execution-readback', attributedFrame1: 'frame1-backbone+temporal-bank+memory-attention+decoder; both backbones precomputed' },
    lastTrustworthyEvidence: { phase: 'command-start', acceptedRuns: 0 },
  };
  let browser;
  let page;
  let server;
  let activeRun = null;
  let runDir;
  let failed = null;
  let interrupted = null;
  const checkpoint = async phase => { if (interrupted) throw interrupted; report.phase = phase; await writeJson(reportPath, report); };
  const onSignal = signal => {
    interrupted = new Error(`benchmark interrupted by ${signal}`);
    report.interruption = { signal, phase: report.phase, receivedAt: new Date().toISOString() };
    if (browser) browser.close().catch(error => report.browserEvents.push({ type: 'signal-close-error', message: String(error) }));
  };
  const sigint = () => onSignal('SIGINT');
  const sigterm = () => onSignal('SIGTERM');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  await writeJson(reportPath, report);
  try {
    if (endianness() !== 'LE') throw new Error('benchmark f32 transport requires a little-endian host');
    const bytes = await readFile(planPath);
    const requestedPlan = JSON.parse(bytes);
    report.requestedPlan = requestedPlan; report.planSha256 = hash(bytes);
    const plan = validateBenchmarkPlan(requestedPlan, dirname(resolve(planPath)));
    report.plan = plan;
    runDir = resolve(plan.outputDir, report.runId);
    report.runDir = runDir;
    await mkdir(runDir, { recursive: true });
    await checkpoint('source-preflight');
    const source = await sourceSnapshot();
    report.source = source.source;
    if (source.source.commit !== plan.commit) throw new Error(`requested commit ${plan.commit} differs from mounted source ${source.source.commit}`);
    await checkpoint('input-preflight');
    const prepared = await prepareInputs(plan, runDir);
    report.package = prepared.package; report.inputs = prepared.identities;
    report.lastTrustworthyEvidence = { phase: 'input-preflight', source: report.source, package: report.package, inputs: report.inputs, acceptedRuns: 0 };
    await checkpoint('evidence-preflight');
    const { validateSam31TrackerMemoryBenchmarkRun, compareSam31TrackerMemoryOutputs } = await import('./sam31-tracker-memory-benchmark-evidence.mjs');
    await checkpoint('browser-preflight');
    const executablePath = await independentBrowser(chromePath);
    if (!playwrightModule) throw new Error('PLAYWRIGHT_MODULE must identify the Playwright module');
    const modulePath = await realpath(playwrightModule);
    report.browser = { executablePath, executableSha256: hash(await readFile(executablePath)), playwrightModule: modulePath, playwrightModuleSha256: hash(await readFile(modulePath)), headless: true, timeoutMs: 0 };
    const { chromium } = await import(pathToFileURL(modulePath).href);
    await checkpoint('server-start');
    const uploaded = new Map();
    server = await startBenchmarkServer({
      mounts: { '/package/': prepared.packageDir, '/': KIT_ROOT }, inputs: prepared.inputs,
      snapshots: { ...source.snapshots, ...prepared.snapshots }, browserPlan: { ...prepared.browserPlan, runId: report.runId, runs: plan.runs, staticBacking: 'opfs' },
      async onOutput(index, name, request) {
        if (index !== activeRun) throw new Error('output upload does not belong to the active invocation');
        const file = resolve(runDir, `run-${index}`, `${name}.f32`);
        await mkdir(dirname(file), { recursive: true });
        const digest = createHash('sha256');
        let byteLength = 0;
        const observe = new Transform({ transform(chunk, _encoding, done) { digest.update(chunk); byteLength += chunk.length; done(null, chunk); } });
        await pipeline(request, observe, createWriteStream(file, { flags: 'wx' }));
        const evidence = { file, byteLength, sha256: `sha256:${digest.digest('hex')}`, dtype: 'float32-le' };
        uploaded.set(`${index}:${name}`, evidence);
        return evidence;
      },
    });
    const url = `${server.url}/smokes/sam31-tracker-memory-benchmark.html`;
    report.server = { url, registrationState: 'mounted', requestedRoute: '/smokes/sam31-tracker-memory-benchmark.html', effectiveUrl: url, mounts: { kit: KIT_ROOT, package: prepared.packageDir, caller: 'immutable-input-snapshots' } };
    await checkpoint('browser-launch');
    browser = await chromium.launch({ executablePath, headless: true, timeout: 0, args: ['--enable-unsafe-webgpu', '--no-first-run', '--no-default-browser-check'] });
    report.browser.version = browser.version();
    page = await browser.newPage();
    page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
    page.on('console', message => report.browserEvents.push({ type: message.type(), message: message.text() }));
    page.on('pageerror', error => report.browserEvents.push({ type: 'pageerror', message: String(error.stack || error) }));
    await checkpoint('page-load');
    await page.goto(url, { waitUntil: 'load', timeout: 0 });
    await checkpoint('resident-setup');
    const setup = await page.evaluate(() => window.sam31TrackerMemoryBenchmark.setup());
    report.residentSetup = setup;
    if (setup.packageId !== prepared.package.packageId) throw new Error('resident setup model identity differs from mounted package');
    let residentIdentity = null;
    const invocationIds = new Set();
    for (const [index, run] of plan.runs.entries()) {
      if (interrupted) throw interrupted;
      const sessionId = `sam31-memory-benchmark:${report.runId}:${index}`;
      activeRun = index; report.activeRun = { index, ...run, sessionId };
      await checkpoint('execute-run');
      await page.evaluate(input => window.sam31TrackerMemoryBenchmark.run(input), { index, ...run, sessionId });
      await checkpoint('read-run-evidence');
      const transportId = `${report.runId}:${index}`;
      const metadata = await page.evaluate(id => window.sam31TrackerMemoryBenchmark.metadata(id), transportId);
      const transported = await readCompleteChunkedJsonEvidence({
        metadata, chunkCharacters: 262144,
        readChunk: range => page.evaluate(input => window.sam31TrackerMemoryBenchmark.chunk(input), range),
      });
      const row = transported.value;
      const result = row.result;
      const metadataFile = resolve(runDir, `run-${index}`, 'metadata.json');
      await writeJson(metadataFile, { schema: 'kaminos.sam31-tracker-memory-benchmark-run.v0', status: 'unverified', ...row, transport: transported.transport });
      report.lastTrustworthyEvidence = { phase: 'browser-return-unverified', acceptedRuns: report.runs.length, browserMetadataFile: metadataFile, browserMetadataSha256: hash(await readFile(metadataFile)), transport: transported.transport, outputDir: dirname(metadataFile), inputs: report.inputs };
      await checkpoint('admit-run');
      if (row.index !== index || row.mode !== run.mode || row.warmup !== run.warmup || row.sessionId !== sessionId) throw new Error('browser run identity differs from requested invocation');
      const arrays = {};
      const outputFiles = {};
      const g = plan.expectedGeometry;
      const expectedShapes = { conditionedFeatures: [1, g.queryTokens, g.channels], selectedMasks: [g.multiplexCount, 1, g.maskHeight, g.maskWidth], objectScores: [g.multiplexCount, 1], objectPointers: [g.multiplexCount, g.channels] };
      for (const name of OUTPUT_NAMES) {
        const output = uploaded.get(`${index}:${name}`);
        const declared = row.outputs?.[name];
        if (!output || !declared || output.byteLength === 0 || output.byteLength % 4 !== 0 || output.sha256 !== declared.sha256 || output.byteLength !== declared.byteLength) throw new Error(`${name} raw output is missing, partial or differs from browser readback`);
        if (!same(declared.shape, expectedShapes[name])) throw new Error(`${name} captured output geometry differs from requested geometry`);
        const raw = await readFile(output.file);
        if (hash(raw) !== output.sha256) throw new Error(`${name} persisted output hash changed`);
        arrays[name] = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
        outputFiles[name] = { ...output, shape: declared.shape, elementCount: raw.byteLength / 4 };
      }
      const admission = validateSam31TrackerMemoryBenchmarkRun(result, arrays, { mode: run.mode, commit: plan.commit, modelPackageId: prepared.package.packageId, ...plan.expectedGeometry });
      if (result.packageRuntime.cacheEvidence?.backingStore?.kind !== 'browser-opfs') throw new Error('effective invocation static backing is not browser-opfs');
      if (!same(result.packageRuntime.encodedSourceImageSha256, prepared.identities.sourceImages.map(input => input.sha256)) || result.packageRuntime.initialMaskSha256 !== prepared.identities.initialMask.sha256) throw new Error('runtime input identities differ from fixed caller snapshots');
      if (result.packageRuntime.session?.sessionId !== sessionId || invocationIds.has(result.packageRuntime.invocationId)) throw new Error('runtime invocation/session identity is missing or reused');
      invocationIds.add(result.packageRuntime.invocationId);
      const identity = { residentSessionId: result.residentRuntime.residentSessionId, liveBufferIds: result.residentRuntime.liveBufferIds, adapterInfo: result.adapterInfo };
      if (residentIdentity && !same(identity, residentIdentity)) throw new Error('resident device/session/model buffer identity changed between A/B runs');
      residentIdentity = identity;
      const attention = result.receipts.find(receipt => receipt.effectiveRouteId === 'sam3.1.memory-attention.phase-program.webgpu-local.v0');
      const attentionCalls = Array.from({ length: 4 }, (_, layer) => ['Self', 'Cross'].map(kind => {
        const kernelName = `layer${layer}${kind}Attention${run.mode === 'flash' ? 'Flash0' : ''}`;
        return { layer, kind, ...attention.timings.stages.find(stage => stage.metadata?.kernelName === kernelName) };
      })).flat();
      await writeJson(metadataFile, { schema: 'kaminos.sam31-tracker-memory-benchmark-run.v0', status: 'admitted', index, ...run, sessionId, expected: { mode: run.mode, commit: plan.commit, modelPackageId: prepared.package.packageId, ...plan.expectedGeometry }, result, outputs: outputFiles, admission, attentionCalls, transport: transported.transport });
      report.runs.push({ index, ...run, sessionId, invocationId: result.packageRuntime.invocationId, residentSessionId: result.residentRuntime.residentSessionId, metadataFile, metadataSha256: hash(await readFile(metadataFile)), outputs: outputFiles, timing: result.timing, admission, attentionCalls });
      report.lastTrustworthyEvidence = { phase: 'admitted-run', acceptedRuns: report.runs.length, run: report.runs.at(-1), source: report.source, package: report.package, inputs: report.inputs };
      await checkpoint('run-complete');
    }
    const measured = report.runs.filter(run => !run.warmup);
    report.measuredRunIndices = measured.map(run => run.index);
    const reference = measured.find(run => run.mode === 'flash');
    report.comparisons = measured.filter(run => run !== reference).map(run => ({ referenceRunIndex: reference.index, actualRunIndex: run.index, referenceMode: reference.mode, actualMode: run.mode, outputs: {} }));
    await checkpoint('compare-outputs');
    for (const name of OUTPUT_NAMES) {
      const referenceBytes = await readFile(reference.outputs[name].file);
      if (hash(referenceBytes) !== reference.outputs[name].sha256) throw new Error(`${name} reference output changed before comparison`);
      const referenceValues = new Float32Array(referenceBytes.buffer.slice(referenceBytes.byteOffset, referenceBytes.byteOffset + referenceBytes.byteLength));
      for (const comparison of report.comparisons) {
        const output = report.runs[comparison.actualRunIndex].outputs[name];
        const actualBytes = await readFile(output.file);
        if (hash(actualBytes) !== output.sha256) throw new Error(`${name} actual output changed before comparison`);
        const actualValues = new Float32Array(actualBytes.buffer.slice(actualBytes.byteOffset, actualBytes.byteOffset + actualBytes.byteLength));
        comparison.outputs[name] = compareSam31TrackerMemoryOutputs(referenceValues, actualValues);
      }
    }
  } catch (error) {
    failed = interrupted || error;
    report.failure_phase = report.phase;
    report.error = String(failed.stack || failed);
  } finally {
    report.cleanup = { sessionClosed: false, browserClosed: false, serverClosed: false, errors: [] };
    if (page && !failed && !interrupted && browser?.isConnected?.() !== false) {
      try { report.closeEvidence = await page.evaluate(() => window.sam31TrackerMemoryBenchmark?.close()); report.cleanup.sessionClosed = report.closeEvidence?.sessionClosed === true; }
      catch (error) { report.cleanup.errors.push({ phase: 'session-close', error: String(error.stack || error) }); }
    } else if (page) report.cleanup.sessionCloseSkipped = 'failed-or-disconnected';
    if (browser) {
      try { await browser.close(); report.cleanup.browserClosed = true; } catch (error) { report.cleanup.errors.push({ phase: 'browser-close', error: String(error.stack || error) }); }
    }
    if (server) {
      try { await server.close(); report.cleanup.serverClosed = true; } catch (error) { report.cleanup.errors.push({ phase: 'server-close', error: String(error.stack || error) }); }
    }
    process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
    if (!failed && (interrupted || report.cleanup.errors.length > 0 || !report.cleanup.sessionClosed)) {
      failed = interrupted || new Error('benchmark cleanup did not complete'); report.failure_phase = 'cleanup'; report.error = String(failed.stack || failed);
    }
    report.status = failed ? 'failed' : 'passed';
    report.primary_output_written = !failed;
    report.finishedAt = new Date().toISOString();
    report.phase = 'terminal';
    await writeJson(reportPath, report);
  }
  if (failed) throw Object.assign(failed, { reportPath });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, report: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) {
    console.log('node tools/sam31-tracker-memory-benchmark.mjs --plan PLAN.json --report REPORT.json\nRequires PLAYWRIGHT_MODULE and independent CHROME_PATH. All waits are unlimited; every caller run and complete output is retained.');
  } else {
    try { const report = await runBenchmark({ planPath: values.plan, reportPath: values.report }); console.log(JSON.stringify({ status: report.status, report: report.reportPath, runDir: report.runDir, completedRuns: report.runs.length })); }
    catch (error) { console.error(String(error.stack || error)); if (error.reportPath) console.error(`Terminal report: ${error.reportPath}`); process.exitCode = 1; }
  }
}
