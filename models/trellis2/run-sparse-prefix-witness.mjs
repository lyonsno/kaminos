import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { validateBlockFixture, validateBlockChainFixture, BLOCK_OBSERVATIONS } from './sparse-block-witness-checks.js';
import { finalizeSparseWitness, persistSparseWitnessResult, admitSparseWitnessResult } from './sparse-witness-finalize.mjs';
import { validateFlowFixture, validateSLatFlowFixture } from './sparse-flow-witness-checks.js';
import { validateSamplerFixture, validateSamplerTrajectoryFixture, SAMPLER_OBSERVATIONS } from './sparse-sampler-witness-checks.js';
import { validateDecoderFixture, decoderObservationShapes } from './sparse-decoder-witness-checks.js';
import { validateOccupancyCoordinateFixture } from './occupancy-coordinate-witness-checks.js';
import { validateSLatDecoderFixture, slatDecoderObservationShapes, validateSLatProjectionFixture, validateSLatProjectionResult, validateSLatConvolutionFixture, validateSLatConvolutionResult } from './slat-decoder-witness-checks.js';
import {validateGenerationInputs} from './generation-inputs.js';
import {generationFields,validateGenerationResult,persistGenerationPhase,persistGenerationAsset} from './sparse-generation-witness-checks.js';

const { values } = parseArgs({ options: { ...Object.fromEntries(
  ['repo-root', 'fixture', 'chrome', 'report', 'expected-commit', 'receiver', 'witness', 'prefix-fixture', 'next-block-fixture', 'sampler-fixture', 'trajectory-fixture'].map(name => [name, { type: 'string' }])),
  'mesh-output': { type: 'boolean', default: false } } });
for (const name of ['repo-root', 'fixture', 'chrome', 'report', 'expected-commit', 'receiver']) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
let root, fixture, prefixFixture, nextBlockFixture, samplerFixture, trajectoryFixture, trajectoryPlan, decoderPlan, coordinatePlan, slatPlan, slatDecoderPlan, slatDecoderManifest, projectionPlan, convolutionPlan,generationManifest;
const witness = values.witness || 'prefix';
const isSampler = witness === 'sampler' || witness === 'sampler-full';
const output = path.resolve(values.report);
const evidenceRoot = path.join(path.dirname(output), 'raw');
const report = { schema: 'trellis2.sparse-prefix-browser.v0', status: 'failed', phase: 'repo-root-admission',
  receiver: values.receiver, terminalEvidence: output,
  requestedRepoRoot: values['repo-root'], requestedFixtureRoot: values.fixture,
  command: process.argv, expectedCommit: values['expected-commit'], servedSources: {} };
const persist = async () => { await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
let server, child, cdp, profile;

// Built-in CDP client: no dependency on an operator Chrome profile or GUI app.
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), listeners = new Map();
  let nextId = 0, failure;
  const rejectWaiters = message => {
    failure ||= new Error(message);
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
    for (const entries of listeners.values()) for (const entry of entries) entry.reject(failure);
    listeners.clear();
  };
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('browser CDP connection error')), { once: true });
    socket.addEventListener('close', () => reject(new Error('browser CDP connection closed before open')), { once: true }); });
  socket.addEventListener('message', event => {
    const row = JSON.parse(event.data);
    if (row.id) {
      const entry = pending.get(row.id); pending.delete(row.id);
      if (row.error) entry?.reject(new Error(JSON.stringify(row.error))); else entry?.resolve(row.result);
    } else {
      const key = `${row.sessionId || ''}:${row.method}`;
      for (const entry of listeners.get(key) || []) entry.resolve(row.params);
      listeners.delete(key);
    }
  });
  socket.addEventListener('close', () => rejectWaiters('browser CDP connection closed'));
  socket.addEventListener('error', () => rejectWaiters('browser CDP connection error'));
  return {
    call(method, params = {}, sessionId) { return new Promise((resolve, reject) => {
      if (failure || socket.readyState !== WebSocket.OPEN) { reject(failure || new Error('browser CDP connection closed')); return; }
      const id = ++nextId; pending.set(id, { resolve, reject });
      try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { pending.delete(id); reject(error); rejectWaiters('browser CDP connection error'); }
    }); },
    once(method, sessionId) { return new Promise((resolve, reject) => {
      if (failure || socket.readyState !== WebSocket.OPEN) { reject(failure || new Error('browser CDP connection closed')); return; }
      const key = `${sessionId || ''}:${method}`;
      listeners.set(key, [...(listeners.get(key) || []), { resolve, reject }]);
    }); },
    close() { socket.close(); },
  };
}

try {
  await persist();
  root = await fs.realpath(values['repo-root']); report.repoRoot = root;
  report.phase = 'fixture-admission';
  fixture = await fs.realpath(values.fixture); report.fixtureRoot = fixture;
  report.phase = 'witness-admission'; report.witness = witness;
  if (!['prefix', 'block', 'flow', 'sampler', 'sampler-full', 'decoder', 'coordinates', 'slat', 'slat-decoder', 'slat-projection', 'slat-convolution','generation'].includes(witness)) throw new Error('--witness must be prefix, block, flow, sampler, sampler-full, decoder, coordinates, slat, slat-decoder, slat-projection, slat-convolution or generation');
  if (values['sampler-fixture'] && !isSampler) throw new Error('--sampler-fixture requires sampler witness');
  if (values['trajectory-fixture'] && witness !== 'sampler-full') throw new Error('--trajectory-fixture requires sampler-full witness');
  if (values['mesh-output'] && witness !== 'slat-decoder') throw Error('--mesh-output requires the learned shape decoder');
  if (isSampler) {
    if (!values['sampler-fixture']) throw new Error('--sampler-fixture is required for sampler witness');
    samplerFixture=await fs.realpath(values['sampler-fixture']); report.samplerFixtureRoot=samplerFixture;
    report.samplerFixtureSha256=digest(await fs.readFile(path.join(samplerFixture,'manifest.json')));
  }
  if (witness === 'sampler-full') {
    if (!values['trajectory-fixture']) throw new Error('--trajectory-fixture is required for complete schedule witness');
    trajectoryFixture=await fs.realpath(values['trajectory-fixture']); report.trajectoryFixtureRoot=trajectoryFixture;
    report.trajectoryFixtureSha256=digest(await fs.readFile(path.join(trajectoryFixture,'manifest.json')));
  }
  if (values['next-block-fixture'] && witness !== 'block') throw new Error('--next-block-fixture requires block witness');
  if (witness === 'block') {
    if (!values['prefix-fixture']) throw new Error('--prefix-fixture is required for a block witness');
    prefixFixture = await fs.realpath(values['prefix-fixture']);
    report.prefixFixtureRoot = prefixFixture;
    report.prefixFixtureSha256 = digest(await fs.readFile(path.join(prefixFixture, 'manifest.json')));
    if (values['next-block-fixture']) {
      nextBlockFixture = await fs.realpath(values['next-block-fixture']); report.nextBlockFixtureRoot = nextBlockFixture;
      report.nextBlockFixtureSha256 = digest(await fs.readFile(path.join(nextBlockFixture, 'manifest.json')));
    }
  }
  report.phase = 'source-identity';
  report.commit = git(['rev-parse', 'HEAD']);
  report.dirty = git(['status', '--porcelain']);
  if (report.commit !== report.expectedCommit || report.dirty) throw new Error('source revision must be the exact clean requested commit');
  if (witness === 'flow') { report.phase = 'flow-reference-admission'; report.schema = 'trellis2.sparse-flow-browser.v0'; }
  if (isSampler) { report.phase = 'sampler-reference-admission'; report.schema = witness === 'sampler-full' ? 'trellis2.sparse-sampler-trajectory-browser.v0' : 'trellis2.sparse-sampler-browser.v0'; }
  report.fixtureSha256 = digest(await fs.readFile(path.join(fixture, 'manifest.json')));
  if(witness==='generation'){
    report.phase='generation-input-admission';report.schema='trellis2.image-generation-browser.v0';
    generationManifest=JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8'));validateGenerationInputs(generationManifest);
  }
  if(witness==='slat-convolution'){
    report.phase='convolution-reference-admission';report.schema='trellis2.slat-convolution-browser.v0';
    const m=JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8')),parents={};
    for(const name of ['parentReference','projectionReference']){
      if(!/^[\w.-]+$/.test(m[name]?.file??''))throw Error('safe convolution reference path required');
      const bytes=await fs.readFile(path.join(fixture,m[name].file));
      if(digest(bytes)!==m[name].sha256)throw Error('exact convolution reference required '+name);
      parents[name]=JSON.parse(bytes);
    }
    convolutionPlan=validateSLatConvolutionFixture(m,parents.parentReference,parents.projectionReference);
  }
  if(witness==='slat-projection'){
    report.phase='projection-reference-admission';report.schema='trellis2.slat-projection-browser.v0';
    const m=JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8'));
    if(!/^[\w.-]+$/.test(m.parentReference?.file??''))throw Error('safe projection parent path required');
    const parentBytes=await fs.readFile(path.join(fixture,m.parentReference.file));
    if(digest(parentBytes)!==m.parentReference.sha256)throw Error('exact projection parent reference required');
    projectionPlan=validateSLatProjectionFixture(m,JSON.parse(parentBytes));
  }
  if (witness === 'slat-decoder') {
    report.phase='learned-decoder-reference-admission';report.schema='trellis2.slat-decoder-browser.v0';
    slatDecoderManifest=JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8'));
    slatDecoderPlan=validateSLatDecoderFixture(slatDecoderManifest);
    if (values['mesh-output'] && slatDecoderPlan.mode !== 'shape') throw Error('--mesh-output requires seven learned geometry channels');
  }
  if (witness === 'slat') {
    report.phase='SLat-reference-admission';report.schema='trellis2.slat-flow-browser.v0';
    slatPlan=validateSLatFlowFixture(JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8')));
  }
  if (witness === 'coordinates') {
    report.phase = 'coordinate-reference-admission'; report.schema = 'trellis2.occupancy-coordinate-browser.v0';
    coordinatePlan = validateOccupancyCoordinateFixture(JSON.parse(await fs.readFile(path.join(fixture, 'manifest.json'), 'utf8')));
  }
  if (witness === 'decoder') {
    report.phase='decoder-reference-admission'; report.schema='trellis2.sparse-decoder-browser.v0';
    decoderPlan=validateDecoderFixture(JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8')));
  }
  if (witness === 'flow' || isSampler) validateFlowFixture(JSON.parse(await fs.readFile(path.join(fixture, 'manifest.json'), 'utf8')));
  if (isSampler) validateSamplerFixture(JSON.parse(await fs.readFile(path.join(samplerFixture,'manifest.json'),'utf8')),
    JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8')),report.fixtureSha256);
  if (trajectoryFixture) trajectoryPlan=validateSamplerTrajectoryFixture(JSON.parse(await fs.readFile(path.join(trajectoryFixture,'manifest.json'),'utf8')),
    JSON.parse(await fs.readFile(path.join(samplerFixture,'manifest.json'),'utf8')),JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8')),
    report.fixtureSha256,report.samplerFixtureSha256);
  if (witness === 'block') {
    report.phase = 'block-reference-admission';
    validateBlockFixture(JSON.parse(await fs.readFile(path.join(fixture, 'manifest.json'), 'utf8')),
      JSON.parse(await fs.readFile(path.join(prefixFixture, 'manifest.json'), 'utf8')), report.prefixFixtureSha256);
    if (nextBlockFixture) validateBlockChainFixture(JSON.parse(await fs.readFile(path.join(nextBlockFixture, 'manifest.json'), 'utf8')),
      JSON.parse(await fs.readFile(path.join(fixture, 'manifest.json'), 'utf8')),
      JSON.parse(await fs.readFile(path.join(prefixFixture, 'manifest.json'), 'utf8')), report.prefixFixtureSha256, report.fixtureSha256);
  }
  report.chrome = await fs.realpath(values.chrome);
  if (/\/Applications\/Google Chrome\.app\//.test(report.chrome)) throw new Error('GUI Google Chrome is not an isolated headless executable');
  await fs.mkdir(evidenceRoot, { recursive: true });
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      if(req.method==='POST'&&pathname==='/phase'){
        if(witness!=='generation')throw Error('generation phase route was not requested');
        const chunks=[];for await(const c of req)chunks.push(c);const row=JSON.parse(Buffer.concat(chunks).toString());
        await persistGenerationPhase({report,row,kernelLogPath:path.join(evidenceRoot,'kernel-events.jsonl'),append:fs.appendFile,persist});
        res.end('saved');return;
      }
      if (req.method === 'POST' && pathname === '/witness-result') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const receipt = await persistSparseWitnessResult({ report, bytes: Buffer.concat(chunks),
          outputPath: path.join(path.dirname(output), 'browser-result.json'), write: fs.writeFile });
        await persist();
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(receipt)); return;
      }
      if (req.method === 'POST' && pathname === '/mesh-output') {
        if (!values['mesh-output']) throw Error('mesh output was not requested');
        const chunks=[];for await (const chunk of req) chunks.push(chunk);const bytes=Buffer.concat(chunks);
        if (bytes.length < 28 || bytes.toString('ascii',0,4)!=='glTF' || bytes.readUInt32LE(4)!==2 || bytes.readUInt32LE(8)!==bytes.length)
          throw Error('complete GLB2 mesh output required');
        const target=path.join(path.dirname(output),'geometry.glb');await fs.writeFile(target,bytes);
        report.meshArtifact={path:target,byteLength:bytes.length,sha256:digest(bytes),class:'learned-geometry-only/neutral-diagnostic-material'};
        await persist();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(report.meshArtifact));return;
      }
      if(req.method==='POST'&&pathname==='/asset-output'){
        if(witness!=='generation')throw Error('learned asset route was not requested');
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
        const artifact=await persistGenerationAsset({report,bytes,outputPath:path.join(path.dirname(output),'asset.glb'),write:fs.writeFile,persist});
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(artifact));return;
      }
      if (req.method === 'POST' && /^\/output\/[\w.-]+$/.test(pathname)) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks), name = pathname.split('/').at(-1);
        const dtype = req.headers['x-tensor-dtype'] ?? 'f32';
        if (!['f32', 'i32', 'u32'].includes(dtype)) throw new Error('unrecognized output dtype');
        const target = path.join(evidenceRoot, `${name}.${dtype}`);
        await fs.writeFile(target, bytes);
        report.rawOutputs ||= {}; report.rawOutputs[name] = { path: target, dtype, byteLength: bytes.length, sha256: digest(bytes) };
        res.end('saved'); return;
      }
      if (pathname === '/') { res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>TRELLIS sparse prefix numerical witness</title>'); return; }
      const isPrefixFixture = pathname.startsWith('/prefix-fixture/');
      const isNextFixture = pathname.startsWith('/next-block-fixture/');
      const isSamplerFixture = pathname.startsWith('/sampler-fixture/');
      const isTrajectoryFixture = pathname.startsWith('/trajectory-fixture/');
      const isFixture = isPrefixFixture || isNextFixture || isSamplerFixture || isTrajectoryFixture || pathname.startsWith('/fixture/');
      const base = isPrefixFixture ? prefixFixture : isNextFixture ? nextBlockFixture : isSamplerFixture ? samplerFixture : isTrajectoryFixture ? trajectoryFixture : isFixture ? fixture : root;
      if (!base) { res.writeHead(404).end(); return; }
      const file = path.resolve(base, `.${isPrefixFixture ? pathname.slice(15) : isNextFixture ? pathname.slice(19) : isSamplerFixture ? pathname.slice(16) : isTrajectoryFixture ? pathname.slice(19) : isFixture ? pathname.slice(8) : pathname}`);
      if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
      const bytes = await fs.readFile(file);
      if (!isFixture && /\.m?js$/.test(file)) {
        const relative = path.relative(root, file);
        const admitted = execFileSync('git', ['show', `${report.commit}:${relative}`], { cwd: root });
        if (digest(bytes) !== digest(admitted)) throw new Error(`served source mismatch: ${relative}`);
        report.servedSources[relative] = digest(bytes);
      }
      res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' :
        file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store'); res.end(bytes);
    } catch (error) { report.serverErrors ||= []; report.serverErrors.push(error.message); res.writeHead(500).end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;
  report.phase = 'browser-launch'; await persist();
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-sparse-chrome-'));
  report.profilePath = profile;
  child = spawn(report.chrome, ['--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0',
    '--use-mock-keychain', '--password-store=basic', '--no-first-run',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  report.ownedBrowserPid = child.pid;
  child.once('exit',(code,signal)=>{report.ownedBrowserExit={code,signal,observedAt:new Date().toISOString()};});
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes.toString(); report.browserStderr = stderr;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`browser exited before CDP: ${code}/${signal}`)));
  });
  cdp = await connect(wsUrl);
  report.browserVersion = await cdp.call('Browser.getVersion');
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  await cdp.call('Page.enable', {}, sessionId);
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  await cdp.call('Page.navigate', { url: report.requestedUrl }, sessionId);
  await loaded;
  report.phase = `native-${witness}-execution`; await persist();
  const result = await cdp.call('Runtime.evaluate', { expression: `(async () => {
    const { ${witness==='generation' ? 'runGenerationWitness' : isSampler ? 'runSparseSamplerWitness' : witness === 'slat-convolution' ? 'runSLatConvolutionWitness' : witness === 'slat-projection' ? 'runSLatProjectionWitness' : witness === 'slat-decoder' ? 'runSLatDecoderWitness' : witness === 'slat' ? 'runSparseSLatWitness' : witness === 'coordinates' ? 'runSparseCoordinatesWitness' : witness === 'decoder' ? 'runSparseDecoderWitness' : witness === 'flow' ? 'runSparseFlowWitness' : witness === 'block' ? 'runSparseBlockWitness' : 'runSparsePrefixWitness'} } = await import('/models/trellis2/sparse-${isSampler?'sampler':witness}-witness.js');
    const result = await ${witness==='generation' ? 'runGenerationWitness' : isSampler ? 'runSparseSamplerWitness' : witness === 'slat-convolution' ? 'runSLatConvolutionWitness' : witness === 'slat-projection' ? 'runSLatProjectionWitness' : witness === 'slat-decoder' ? 'runSLatDecoderWitness' : witness === 'slat' ? 'runSparseSLatWitness' : witness === 'coordinates' ? 'runSparseCoordinatesWitness' : witness === 'decoder' ? 'runSparseDecoderWitness' : witness === 'flow' ? 'runSparseFlowWitness' : witness === 'block' ? 'runSparseBlockWitness' : 'runSparsePrefixWitness'}(${JSON.stringify(report.fixtureSha256)}${isSampler ? `, ${JSON.stringify(report.samplerFixtureSha256)}, ${JSON.stringify(report.trajectoryFixtureSha256)}` : witness === 'block' ? `, ${JSON.stringify(report.prefixFixtureSha256)}, ${JSON.stringify(report.nextBlockFixtureSha256)}` : witness === 'slat-decoder' ? `, {meshOutput:${JSON.stringify(values['mesh-output'])}}` : ''});
    const saved = await fetch('/witness-result', { method: 'POST', body: JSON.stringify(result) });
    if (!saved.ok) throw new Error('browser result was not durably saved');
    return { url: location.href, receipt: await saved.json() };
  })()`, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  const value = result.result.value;
  report.effectiveUrl = value.url;
  value.result = admitSparseWitnessResult(report, value.receipt);
  if (value.url !== report.requestedUrl) throw new Error('effective browser URL differs from requested route');
  if (value.result.status !== 'succeeded') throw new Error(value.result.error?.message || 'browser witness failed');
  if (report.serverErrors?.length) throw new Error(report.serverErrors.join('\n'));
  const requiredOutputs = generationManifest ? [...generationFields(generationManifest)] : convolutionPlan ? ['neighbors','convolution'] : projectionPlan ? ['f32','f16'] : slatDecoderPlan ? Object.keys(slatDecoderObservationShapes(slatDecoderManifest)) : coordinatePlan ? ['coordinates'] : isSampler ? [...SAMPLER_OBSERVATIONS] : decoderPlan ? Object.keys(decoderObservationShapes(decoderPlan)) : ['projected', 'modulation'];
  const observedOutputs={...value.result.outputs};
  if(generationManifest){
    validateGenerationResult(value.result,generationManifest);
    for(const name of ['models/trellis2/dinov3-serving.js','models/trellis2/trellis-generation.js','models/trellis2/generation-inputs.js',
      'models/trellis2/sparse-generation-witness.js','models/trellis2/sparse-flow.js','models/trellis2/slat-flow.js',
      'models/trellis2/slat-decoder.js','webgpu-inference-kit/src/inference-runtime.js'])
      if(!report.servedSources[name])throw Error('missing generation served-source attestation '+name);
    for(const name of requiredOutputs)if(report.rawOutputs?.[name]?.byteLength!==observedOutputs[name].byteLength||
      report.rawOutputs[name].dtype!==observedOutputs[name].dtype)throw Error('complete raw generation evidence required '+name);
  }
  if(convolutionPlan){
    validateSLatConvolutionResult(value.result,convolutionPlan);
    for(const name of ['models/trellis2/slat-decoder-ops.js','models/trellis2/slat-decoder-witness-checks.js',
      'models/trellis2/sparse-slat-convolution-witness.js','webgpu-inference-kit/src/inference-runtime.js'])
      if(!report.servedSources[name])throw Error('missing production convolution served-source attestation '+name);
    for(const name of requiredOutputs){
      const row=report.rawOutputs?.[name],columns=name==='neighbors'?27:convolutionPlan.co,dtype=name==='neighbors'?'i32':'f32';
      if(row?.byteLength!==convolutionPlan.rows*columns*4||row.dtype!==dtype)throw Error('complete raw convolution output required '+name);
    }
  }
  if(projectionPlan){
    validateSLatProjectionResult(value.result,projectionPlan);
    for(const name of ['models/trellis2/slat-decoder-ops.js','models/trellis2/slat-decoder-witness-checks.js',
      'models/trellis2/sparse-slat-projection-witness.js','webgpu-inference-kit/src/inference-runtime.js'])
      if(!report.servedSources[name])throw Error('missing production projection served-source attestation '+name);
    for(const name of requiredOutputs)if(report.rawOutputs?.[name]?.byteLength!==projectionPlan.rows*projectionPlan.co*4)
      throw Error('complete raw projection output required '+name);
  }
  if (slatDecoderPlan) {
    if(values['mesh-output'] && (value.result.mesh?.artifact?.sha256!==report.meshArtifact?.sha256 ||
      !(value.result.mesh?.vertexCount>0) || !(value.result.mesh?.triangleCount>0) ||
      !report.servedSources['models/trellis2/trellis-mesh.js'])) throw Error('complete native learned-mesh consumer evidence required');
    const c=value.result.composition;
    if(value.result.effectiveRoute!=='trellis2.slat-decoder.webgpu.v0'||value.result.numericalStatus!=='passed'||value.result.profileStatus!=='passed'||
      c?.outputRows!==slatDecoderManifest.outputRows||c.outputResolution!==slatDecoderPlan.outputResolution||
      c.convolutionsExecuted!==slatDecoderManifest.convolutionsExecuted||c.convNeXtBlocksExecuted!==slatDecoderPlan.numBlocks.reduce((a,b)=>a+b,0)||
      c.exactBorrowedInputIdentity!==true||c.featureBytesToCPUDuringServing!==0||c.coordinateBytesToCPUDuringServing!==0||c.sameSession!==true)
      throw Error('complete resident learned-decoder conformance required');
    for(const name of ['models/trellis2/slat-decoder.js','models/trellis2/slat-decoder-ops.js','models/trellis2/slat-decoder-witness-checks.js',
      'models/trellis2/sparse-slat-decoder-witness.js','webgpu-inference-kit/src/inference-runtime.js'])
      if(!report.servedSources[name])throw Error('missing learned decoder served-source attestation '+name);
  }
  if (slatPlan) {
    requiredOutputs.push('hidden','normalized','prediction','phases','coordinates');
    const c=value.result.composition;
    if(value.result.effectiveRoute!=='trellis2.slat-flow.webgpu.v0'||value.result.numericalStatus!=='passed'||value.result.profileStatus!=='passed'||
      c?.executedBlocks!==30||c.coordinateRows!==slatPlan.tokenRows||c.exactBorrowedCoordinateIdentity!==true||c.metadataBytesToCPU!==4||
      c.coordinateBytesToCPUDuringServing!==0||c.readbackBetweenBlocks!==false||c.sameSession!==true)throw Error('complete resident-coordinate SLat evidence required');
    for(const name of ['models/trellis2/slat-flow.js','models/trellis2/occupancy-coordinates.js','models/trellis2/sparse-slat-witness.js',
      'models/trellis2/sparse-flow.js','models/trellis2/sparse-prefix.js','models/trellis2/sparse-block.js','webgpu-inference-kit/src/inference-runtime.js'])
      if(!report.servedSources[name])throw Error('missing SLat served-source attestation '+name);
  }
  if (coordinatePlan) {
    if (value.result.numericalStatus !== 'passed' || value.result.profileStatus !== 'passed' || value.result.composition?.metadataBytesToCPU !== 4) throw new Error('complete native coordinate conformance required');
    for (const name of ['models/trellis2/occupancy-coordinates.js', 'models/trellis2/sparse-coordinates-witness.js', 'models/trellis2/occupancy-coordinate-witness-checks.js', 'webgpu-inference-kit/src/inference-runtime.js']) {
      if (!report.servedSources[name]) throw new Error('missing coordinate served-source attestation:' + name);
    }
  }
  if (decoderPlan) {
    if(value.result.composition?.convolutionsExecuted!==decoderPlan.convolutions||value.result.numericalStatus!=='passed'||value.result.profileStatus!=='passed')
      throw new Error('complete native decoder graph/observation required');
    for(const name of ['models/trellis2/sparse-decoder.js','models/trellis2/sparse-decoder-witness.js','models/trellis2/sparse-decoder-witness-checks.js','webgpu-inference-kit/src/inference-runtime.js'])
      if(!report.servedSources[name])throw new Error('missing decoder served-source attestation:'+name);
  }
  if (trajectoryPlan) {
    const expectedCalls=trajectoryPlan.steps.reduce((n,step)=>n+(step.guided?2:1),0);
    if (value.result.composition?.stepsExecuted!==trajectoryPlan.steps.length||value.result.composition?.modelCalls!==expectedCalls||
        value.result.trajectory?.steps?.length!==trajectoryPlan.steps.length||value.result.trajectoryStatus!=='passed') throw new Error('incomplete native sampler schedule evidence');
    for (const row of value.result.trajectory.steps) { const name=`step${row.index}.sample`; requiredOutputs.push(name); observedOutputs[name]=row; }
  }
  if (isSampler) {
    for (const name of ['models/trellis2/sparse-sampler.js','models/trellis2/sparse-sampler-witness.js','models/trellis2/sparse-sampler-witness-checks.js',
      'models/trellis2/sparse-flow.js','models/trellis2/sparse-prefix.js','models/trellis2/sparse-block.js','webgpu-inference-kit/src/inference-runtime.js']) {
      if (!report.servedSources[name]) throw new Error(`missing sampler served-source attestation:${name}`);
    }
  }
  if (witness === 'flow') {
    requiredOutputs.push('hidden', 'normalized', 'prediction');
    for (const name of ['models/trellis2/sparse-flow.js', 'models/trellis2/sparse-flow-witness.js', 'models/trellis2/sparse-flow-witness-checks.js',
      'models/trellis2/sparse-prefix.js', 'models/trellis2/sparse-block.js', 'webgpu-inference-kit/src/inference-runtime.js']) {
      if (!report.servedSources[name]) throw new Error(`missing full flow served-source attestation:${name}`);
    }
  }
  if (witness === 'block') requiredOutputs.push(...BLOCK_OBSERVATIONS);
  if (nextBlockFixture && (!report.rawOutputs?.['block1.input'] ||
      report.rawOutputs['block1.input'].sha256 !== value.result.inputs?.['block1.input']?.sha256)) {
    throw new Error('missing or mismatched incoming block1 input evidence');
  }
  for (const name of requiredOutputs) {
    if (!report.rawOutputs?.[name] || report.rawOutputs[name].sha256 !== observedOutputs[name]?.sha256) {
      throw new Error(`missing or mismatched raw evidence: ${name}`);
    }
  }
  report.status = 'succeeded'; report.phase = null;
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  if(child)report.ownedBrowserAtFailure={pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode,
    meaning:'child-process observation before cleanup; null exit fields alone do not prove liveness'};
  process.exitCode = 1;
}
finally {
  await finalizeSparseWitness({ report, persist, cleanup: [
    ['browser', async () => { if (cdp) { try { await cdp.call('Browser.close'); } catch {} cdp.close(); } }],
    ['child', async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); child.kill('SIGTERM'); });
      }
    }],
    ['server', async () => { if (server) await new Promise(resolve => server.close(resolve)); }],
    // Only ephemeral state from the exact owned browser profile is removed.
    ['profile', async () => { if (profile) await fs.rm(profile, { recursive: true, force: true }); }],
  ] });
  if (report.status !== 'succeeded') process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, phase: report.phase, report: output,
    comparisons: Object.fromEntries(Object.entries(report.result?.outputs || {}).map(([name, row]) => [name, row.comparison])),
    error: report.error?.message }));
}
