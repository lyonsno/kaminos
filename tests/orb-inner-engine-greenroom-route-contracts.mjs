import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeOrbInnerEngineConceptBundle } from '../orb-inner-engine-concept-loop.mjs';

const root = new URL('..', import.meta.url).pathname;
const greenroomPath = join(root, 'orb-inner-engine-greenroom-route.mjs');

assert.ok(existsSync(greenroomPath), 'orb-inner-engine-greenroom-route.mjs must define greenroom route custody');

const {
  ORB_INNER_ENGINE_GREENROOM_ROUTE_IDENTITY,
  runOrbInnerEngineGreenroomProviderRoute,
} = await import(`${greenroomPath}?contract=${Date.now()}`);

assert.equal(ORB_INNER_ENGINE_GREENROOM_ROUTE_IDENTITY, 'orb-inner-engine-greenroom-route-v0');

function writeExecutable(path, text) {
  writeFileSync(path, text, { mode: 0o755 });
}

function fixtureProviderScript() {
  return [
    "const fs = require('node:fs');",
    "const args = new Map();",
    "for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);",
    "const out = args.get('--output');",
    "const receipt = args.get('--receipt');",
    "if (!out) process.exit(13);",
    "fs.writeFileSync(out, Buffer.from('89504e470d0a1a0a66616b652d706e67', 'hex'));",
    "fs.writeFileSync(receipt, JSON.stringify({ ok: true, route: 'fixture-ideogram4', seed: args.get('--seed'), prompt: args.get('--prompt') }, null, 2));",
    "console.log(JSON.stringify({ ok: true, fixture: 'ideogram4', out }));",
    '',
  ].join('\n');
}

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-greenroom-route-'));
try {
  const queueDir = join(outDir, 'greenroom-state');
  const ideogramRoot = join(outDir, 'mlx-ideogram4');
  mkdirSync(ideogramRoot, { recursive: true });
  writeExecutable(join(ideogramRoot, 'generate.py'), fixtureProviderScript());

  const bundle = writeOrbInnerEngineConceptBundle({
    outDir: join(outDir, 'bundle-output'),
    coreSeed: 'molten-heartfucker-core-greenroom-contract',
    conceptSeed: 'greenroom-provider-route',
    conceptCount: 1,
  });

  const run = runOrbInnerEngineGreenroomProviderRoute({
    queueDir,
    jobId: 'greenroom-contract-job',
    bundleRoot: bundle.bundleRoot,
    providerId: 'local-image.ideogram4',
    ideogramRoot,
    providerPython: process.execPath,
    timeoutMs: 30000,
  });

  assert.equal(run.ok, true);
  assert.equal(run.status, 'complete');
  assert.equal(run.identity, 'orb-inner-engine-greenroom-route-v0');
  assert.equal(run.jobId, 'greenroom-contract-job');
  assert.equal(run.queueDir, queueDir);
  assert.match(run.finalJobDir, /\/done\/greenroom-contract-job$/);
  assert.ok(existsSync(run.finalJobDir), 'finished greenroom job directory must remain inspectable');

  const request = JSON.parse(readFileSync(join(run.finalJobDir, 'request.json'), 'utf8'));
  const status = JSON.parse(readFileSync(join(run.finalJobDir, 'status.json'), 'utf8'));
  const receipt = JSON.parse(readFileSync(join(run.finalJobDir, 'receipt.json'), 'utf8'));
  const stdout = readFileSync(join(run.finalJobDir, 'stdout.log'), 'utf8');
  const stderr = readFileSync(join(run.finalJobDir, 'stderr.log'), 'utf8');

  assert.equal(request.identity, 'orb-inner-engine-greenroom-route-request-v0');
  assert.equal(request.jobType, 'kaminos.orb-inner-engine.provider-route');
  assert.equal(request.providerId, 'local-image.ideogram4');
  assert.equal(request.bundleRoot, bundle.bundleRoot);
  assert.equal(request.queueDir, queueDir);
  assert.equal(request.lockPath, join(queueDir, 'gpu.lock'));
  assert.equal(request.greenroomCustody, 'gpu-greenroom-file-lock');
  assert.equal(request.directGpuRun, false);

  assert.equal(status.status, 'complete');
  assert.equal(status.jobId, 'greenroom-contract-job');
  assert.match(status.lockedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal(receipt.ok, true);
  assert.equal(receipt.identity, 'orb-inner-engine-greenroom-route-v0');
  assert.equal(receipt.jobType, 'kaminos.orb-inner-engine.provider-route');
  assert.equal(receipt.providerId, 'local-image.ideogram4');
  assert.equal(receipt.bundleRoot, bundle.bundleRoot);
  assert.equal(receipt.lockPath, join(queueDir, 'gpu.lock'));
  assert.equal(receipt.routeResult.status, 'complete');
  assert.ok(existsSync(receipt.routeResult.recordsPath), 'greenroom receipt points at provider route records');
  assert.match(receipt.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(receipt.endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(receipt.durationMs >= 0, 'greenroom receipt records wall-clock timing');
  assert.ok(stdout.includes('local-image.ideogram4'), 'greenroom stdout log preserves child route identity');
  assert.equal(stderr, '');

  const routeRecords = JSON.parse(readFileSync(receipt.routeResult.recordsPath, 'utf8'));
  assert.equal(routeRecords.providerId, 'local-image.ideogram4');
  assert.equal(routeRecords.provider.adapter, 'ideogram4');
  assert.equal(routeRecords.effectiveCommand.shell, false);
  assert.equal(routeRecords.records.length, 1);
  assert.equal(routeRecords.records[0].status, 'complete');
  assert.ok(routeRecords.records[0].liveGeneratorInvoked, 'provider route still records live invocation under greenroom');
  assert.ok(routeRecords.records[0].outputImagePath.startsWith(bundle.bundleRoot), 'outputs stay under caller-owned bundle root');
  assert.ok(existsSync(routeRecords.records[0].providerReceiptPath), 'native provider receipt is preserved');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
