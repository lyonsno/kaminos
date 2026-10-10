// Run one SuperMat stage witness in an independent headless Chrome for Testing.
// Writes a terminal report on every path; served JS must match the exact
// requested clean commit; fixture and weight roots are digest-bound.
import fs from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { launchChrome, openPage } from './chrome-cdp.mjs';

const STAGES = ['vae-encoder', 'vae-decoder', 'unet', 'full', 'route', 'bench'];
const { values } = parseArgs({ options: Object.fromEntries(
  ['repo-root', 'expected-commit', 'fixture', 'weights', 'chrome', 'report', 'stage', 'receiver', 'image',
    'decoded-reference', 'options'].map(name => [name, { type: 'string' }])) });
const output = path.resolve(values.report ?? 'supermat-witness-report.json');
const rawRoot = path.join(path.dirname(output), 'raw');
const report = { schema: 'supermat.stage-witness.runner.v0', status: 'failed', phase: 'arguments',
  receiver: values.receiver ?? null, terminalEvidence: output, command: process.argv,
  requested: { repoRoot: values['repo-root'], fixture: values.fixture, weights: values.weights,
    stage: values.stage, expectedCommit: values['expected-commit'], chrome: values.chrome, image: values.image ?? null,
    decodedReference: values['decoded-reference'] ?? null, options: values.options ?? null },
  servedSources: {}, rawOutputs: {} };
const persist = async () => {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let server, browser;
// A crash outside the awaited chain (event handlers, the CDP socket) must still
// leave a report naming the phase it died in and the error.
const crashed = kind => error => {
  report.error = `${kind}: ${error?.stack ?? error}`;
  browser?.child?.kill();
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.error(report.error);
  process.exit(1);
};
process.on('uncaughtException', crashed('uncaughtException'));
process.on('unhandledRejection', crashed('unhandledRejection'));

try {
  await persist();
  for (const name of ['repo-root', 'expected-commit', 'fixture', 'weights', 'chrome', 'report', 'stage', 'receiver']) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  if (!STAGES.includes(values.stage)) throw new Error(`--stage must be one of ${STAGES.join(', ')}`);

  report.phase = 'source-identity';
  const root = await fs.realpath(values['repo-root']);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  report.repoRoot = root;
  report.commit = git(['rev-parse', 'HEAD']);
  report.dirty = git(['status', '--porcelain', '--', 'models/supermat', 'webgpu-inference-kit/src']);
  if (report.commit !== values['expected-commit'] || report.dirty) {
    throw new Error('served sources must come from the exact clean requested commit');
  }

  report.phase = 'fixture-admission';
  const fixture = await fs.realpath(values.fixture);
  const fixtureManifest = await fs.readFile(path.join(fixture, 'manifest.json'));
  report.fixture = { root: fixture, manifestSha256: digest(fixtureManifest) };
  if (JSON.parse(fixtureManifest).status !== 'succeeded') throw new Error('fixture manifest is not a succeeded reference');
  const weights = await fs.realpath(values.weights);
  const weightManifest = await fs.readFile(path.join(weights, 'package.json'));
  report.weights = { root: weights, packageSha256: digest(weightManifest) };
  if (JSON.parse(weightManifest).status !== 'succeeded') throw new Error('weight package is not a succeeded pack');

  let imagePath = null, decodedReferencePath = null;
  if (values.stage === 'route') {
    if (!values.image) throw new Error('--image is required for the route stage');
    imagePath = await fs.realpath(values.image);
    report.image = { path: imagePath, sha256: digest(await fs.readFile(imagePath)) };
    const referenceImage = JSON.parse(fixtureManifest).image?.sha256;
    if (referenceImage && referenceImage !== report.image.sha256) throw new Error('route image is not the fixture reference image');
    if (values['decoded-reference']) {
      decodedReferencePath = await fs.realpath(values['decoded-reference']);
      report.decodedReference = { path: decodedReferencePath, sha256: digest(await fs.readFile(decodedReferencePath)) };
    }
  }

  report.phase = 'browser-admission';
  report.chrome = await fs.realpath(values.chrome);
  if (/\/Applications\/Google Chrome\.app\//.test(report.chrome)) throw new Error('GUI Google Chrome is not an isolated headless executable');
  await fs.mkdir(rawRoot, { recursive: true });

  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (req.method === 'POST' && /^\/output\/[\w.#-]+$/.test(pathname)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks), name = pathname.slice('/output/'.length);
        const target = path.join(rawRoot, /\.png$/.test(name) ? name : `${name}.f32`);
        await fs.writeFile(target, bytes);
        report.rawOutputs[name] = { path: target, byteLength: bytes.length, sha256: digest(bytes) };
        res.end('saved');
        return;
      }
      if (pathname === '/image' || pathname === '/decoded-reference') {
        const file = pathname === '/image' ? imagePath : decodedReferencePath;
        if (!file) { res.writeHead(404).end(); return; }
        const type = /\.webp$/i.test(file) ? 'image/webp' : /\.png$/i.test(file) ? 'image/png'
          : /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'application/octet-stream';
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-store');
        res.end(await fs.readFile(file));
        return;
      }
      if (pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>SuperMat stage witness</title>');
        return;
      }
      const [base, relative] = pathname.startsWith('/fixture/') ? [fixture, pathname.slice(9)]
        : pathname.startsWith('/weights/') ? [weights, pathname.slice(9)] : [root, pathname.slice(1)];
      const file = path.resolve(base, relative);
      if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
      if (base === root) {
        if (!/\.m?js$/.test(file)) { res.writeHead(404).end(); return; }
        const repoRelative = path.relative(root, file);
        const admitted = execFileSync('git', ['show', `${report.commit}:${repoRelative}`], { cwd: root });
        const bytes = await fs.readFile(file);
        if (digest(bytes) !== digest(admitted)) throw new Error(`served source mismatch: ${repoRelative}`);
        report.servedSources[repoRelative] = digest(bytes);
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(bytes);
        return;
      }
      const stat = await fs.stat(file);
      res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'no-store');
      (await fs.open(file)).createReadStream().pipe(res);
    } catch (error) {
      report.serverErrors ??= [];
      report.serverErrors.push(error.message);
      res.writeHead(500).end(error.message);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;

  report.phase = 'browser-launch';
  await persist();
  browser = await launchChrome({ chrome: report.chrome, onExit: exit => { report.ownedBrowserExit = exit; } });
  const { cdp } = browser;
  report.ownedBrowserPid = browser.child.pid;
  report.browserVersion = browser.version;
  const sessionId = await openPage(cdp, report.requestedUrl);

  report.phase = `native-${values.stage}-witness`;
  await persist();
  const started = Date.now();
  const evaluation = await cdp.call('Runtime.evaluate', {
    expression: values.stage === 'bench'
      ? `import('/models/supermat/supermat-bench.js').then(m => m.runSuperMatBench())`
      : values.stage === 'route'
      ? `import('/models/supermat/supermat-route-witness.js').then(m => m.runSuperMatRouteWitness(${JSON.stringify({
        fixtureSha256: report.fixture.manifestSha256, weightsSha256: report.weights.packageSha256,
        adapterOptions: JSON.parse(values.options ?? '{}') })}))`
      : `import('/models/supermat/supermat-witness.js').then(m => m.runSuperMatWitness(${JSON.stringify({
        stage: values.stage, fixtureSha256: report.fixture.manifestSha256, weightsSha256: report.weights.packageSha256,
        opsOptions: JSON.parse(values.options ?? '{}') })}))`,
    awaitPromise: true, returnByValue: true,
  }, sessionId);
  report.wallMs = Date.now() - started;
  if (evaluation.exceptionDetails) throw new Error(`browser exception: ${JSON.stringify(evaluation.exceptionDetails)}`);
  report.browserResult = evaluation.result.value;
  report.effectiveRoute = { backend: 'webgpu-local', browser: report.browserVersion?.product,
    adapter: report.browserResult?.adapter ?? null };
  report.phase = 'complete';
  report.status = report.browserResult?.status === 'passed' ? 'passed' : (report.browserResult?.status ?? 'failed');
} catch (error) {
  report.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.close();
  await persist();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error ?? null, report: output }));
}
