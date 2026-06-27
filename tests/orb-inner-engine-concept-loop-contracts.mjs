import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const loopPath = join(root, 'orb-inner-engine-concept-loop.mjs');

assert.ok(existsSync(loopPath), 'orb-inner-engine-concept-loop.mjs must define the generated asset vocabulary loop');

const source = readFileSync(loopPath, 'utf8');
assert.match(source, /orb-inner-engine-concept-loop-v0/, 'concept loop names its stable identity');
assert.match(source, /createOrbInnerEngineConceptManifest/, 'concept loop exports deterministic manifest construction');
assert.match(source, /writeOrbInnerEngineConceptBundle/, 'concept loop exports caller-rooted bundle writing');
assert.match(source, /runOrbInnerEngineImageRoute/, 'concept loop exports image route execution');
assert.match(source, /openrouter-image\.flux2-klein-4b/, 'concept loop names the OpenRouter FLUX.2 Klein 4B scout route');
assert.match(source, /sharp\.splat/, 'concept loop names the SHARP splat route');
assert.match(source, /starcraft-view-bank/, 'concept loop names the 2.5D view-bank fakery affordance');
assert.match(source, /beaming\.volume-accent/, 'concept loop preserves Beaming volumetric accent as optional, not core');
assert.match(source, /shell-geometry-takeover/, 'concept loop protects Lamellar shell custody');
assert.doesNotMatch(source, /\/tmp\/kaminos-orb-inner-engine-concept-loop/, 'concept loop must not hardcode its output root');

const {
  ORB_INNER_ENGINE_CONCEPT_LOOP_IDENTITY,
  createOrbInnerEngineConceptManifest,
  runOrbInnerEngineImageRoute,
  writeOrbInnerEngineConceptBundle,
} = await import(`${loopPath}?contract=${Date.now()}`);

assert.equal(ORB_INNER_ENGINE_CONCEPT_LOOP_IDENTITY, 'orb-inner-engine-concept-loop-v0');

const manifest = createOrbInnerEngineConceptManifest({
  coreSeed: 'molten-heartfucker-core-contract',
  conceptSeed: 'view-bank-contract',
  target: 'evil-orb-inner-engine',
  conceptCount: 3,
});

assert.equal(manifest.identity, 'orb-inner-engine-concept-loop-v0');
assert.equal(manifest.coreIdentity, 'orb-inner-engine-witness-v0');
assert.equal(manifest.coreSeed, 'molten-heartfucker-core-contract');
assert.equal(manifest.conceptSeed, 'view-bank-contract');
assert.equal(manifest.target, 'evil-orb-inner-engine');
assert.equal(manifest.concepts.length, 3);
assert.ok(manifest.contract.nonGoals.includes('redesign-shell-geometry'), 'Lamellar shell geometry must stay out of scope');
assert.ok(manifest.contract.baseEffectMustWorkWithoutVolumetrics, 'base effect must survive without full volumetric fire');
assert.ok(manifest.contract.baseEffectMustWorkWithoutGeneratedAssets, 'base effect must survive without generated hero assets');
assert.ok(manifest.failureTaxonomy.includes('flat-glow'), 'flat glow failure must be called out');
assert.ok(manifest.failureTaxonomy.includes('lost-containment'), 'lost containment failure must be called out');
assert.ok(manifest.failureTaxonomy.includes('volume-dependency-too-high'), 'volume dependency failure must be called out');

const routes = new Map(manifest.routes.map(route => [route.id, route]));
assert.equal(routes.get('local-image.ideogram4').status, 'unconfigured');
assert.equal(routes.get('openrouter-image.flux2-klein-4b').status, 'planned');
assert.equal(routes.get('openrouter-image.flux2-klein-4b').role, 'cheap-api-image-scout');
assert.equal(routes.get('openrouter-image.flux2-klein-4b').requiredForBaseRead, false);
assert.equal(routes.get('local-video.cosmos3-mlx.t2v').status, 'planned');
assert.equal(routes.get('local-video.cosmos3-mlx.i2v').status, 'planned');
assert.equal(routes.get('local-image.diffusion-fallback').status, 'unconfigured');
assert.equal(routes.get('sharp.splat').status, 'planned');
assert.equal(routes.get('trellis2mlx.mesh-pbr').status, 'planned');
assert.equal(routes.get('pixal3d.mesh-pbr').status, 'planned');
assert.equal(routes.get('beaming.volume-accent').role, 'optional-accent');
assert.equal(routes.get('beaming.volume-accent').requiredForBaseRead, false);

for (const concept of manifest.concepts) {
  assert.match(concept.id, /^orb-inner-engine-concept-[0-9]{2}$/);
  assert.equal(concept.coreSocket.space, 'lamellar-core-socket-local');
  assert.ok(concept.prompt.positive.includes('contained radial molten engine core'));
  assert.ok(concept.prompt.positive.includes('nested rings'));
  assert.ok(concept.prompt.positive.includes('mechanical ribs'));
  assert.ok(concept.prompt.negative.includes('flat orange disk'));
  assert.ok(concept.prompt.negative.includes('generic fireball'));
  assert.ok(concept.prompt.negative.includes('new outer shell geometry'));
  assert.equal(concept.volumeAffordance.required, false);
  assert.ok(concept.volumeAffordance.requestLanguage.includes('accent'));
  assert.ok(concept.fallbacks.some(fallback => fallback.route === 'shader-baked-emissive-field'));

  const sharpCandidate = concept.assetCandidates.find(candidate => candidate.route === 'sharp.splat');
  assert.ok(sharpCandidate, 'each concept has a SHARP splat candidate');
  assert.equal(sharpCandidate.technique, 'starcraft-view-bank');
  assert.ok(sharpCandidate.viewConeDegrees >= 10);
  assert.ok(sharpCandidate.viewConeDegrees <= 45);
  assert.ok(sharpCandidate.splatCountBudget >= 1000000);
  assert.equal(sharpCandidate.relightingStatus, 'renderer-relight-pending');
  assert.equal(sharpCandidate.cameraSelectionPolicy, 'nearest-authored-view-with-shader-fallback');
  assert.ok(sharpCandidate.failureModes.includes('sharp-view-cone-limit'));
  assert.ok(sharpCandidate.failureModes.includes('lost-containment'));
}

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-orb-inner-engine-concept-loop-'));
try {
  const result = writeOrbInnerEngineConceptBundle({
    outDir,
    coreSeed: 'molten-heartfucker-core-contract',
    conceptSeed: 'view-bank-contract',
    conceptCount: 2,
  });

  assert.equal(result.ok, true);
  assert.ok(result.bundleRoot.startsWith(outDir), 'bundle writer must use the caller-provided output root');
  assert.ok(existsSync(result.manifestPath), 'bundle writer emits a manifest');
  assert.ok(existsSync(result.promptQueuePath), 'bundle writer emits a prompt queue');
  assert.ok(existsSync(result.routeRecordsPath), 'bundle writer emits route records');

  const writtenManifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
  const promptQueue = JSON.parse(readFileSync(result.promptQueuePath, 'utf8'));
  const routeRecords = JSON.parse(readFileSync(result.routeRecordsPath, 'utf8'));
  assert.equal(writtenManifest.identity, 'orb-inner-engine-concept-loop-v0');
  assert.equal(writtenManifest.concepts.length, 2);
  assert.equal(promptQueue.identity, 'orb-inner-engine-prompt-queue-v0');
  assert.equal(promptQueue.items.length, 2);
  assert.equal(promptQueue.items[0].generatorRoute, 'local-image.ideogram4');
  assert.equal(routeRecords.identity, 'orb-inner-engine-route-records-v0');
  assert.ok(routeRecords.records.some(record => record.route === 'sharp.splat'));
  assert.ok(routeRecords.records.every(record => ['planned', 'unconfigured'].includes(record.status)));

  const skippedImageRun = runOrbInnerEngineImageRoute({
    bundleRoot: result.bundleRoot,
  });
  assert.equal(skippedImageRun.ok, false);
  assert.equal(skippedImageRun.status, 'unconfigured');
  assert.ok(existsSync(skippedImageRun.imageRouteRecordsPath), 'unconfigured image route still writes route records');
  const skippedRecords = JSON.parse(readFileSync(skippedImageRun.imageRouteRecordsPath, 'utf8'));
  assert.equal(skippedRecords.identity, 'orb-inner-engine-image-route-records-v0');
  assert.equal(skippedRecords.route, 'local-image.ideogram4');
  assert.match(skippedRecords.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(skippedRecords.endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(skippedRecords.durationMs >= 0, 'unconfigured image route records envelope duration');
  assert.equal(skippedRecords.records.length, 2);
  assert.ok(skippedRecords.records.every(record => record.status === 'unconfigured'));
  assert.ok(skippedRecords.records.every(record => record.failurePhase === 'configuration'));
  assert.ok(skippedRecords.records.every(record => record.liveGeneratorInvoked === false));
  assert.ok(skippedRecords.records.every(record => record.durationMs >= 0));

  const fixtureCommand = join(outDir, 'fixture-image-generator.mjs');
  writeFileSync(fixtureCommand, [
    "import { writeFileSync } from 'node:fs';",
    "const args = new Map();",
    "for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);",
    "writeFileSync(args.get('--out'), Buffer.from('89504e470d0a1a0a66616b652d706e67', 'hex'));",
    "console.log(JSON.stringify({ ok: true, seed: args.get('--seed'), out: args.get('--out') }));",
    '',
  ].join('\n'));

  const imageRun = runOrbInnerEngineImageRoute({
    bundleRoot: result.bundleRoot,
    command: process.execPath,
    args: [
      fixtureCommand,
      '--prompt', '{prompt}',
      '--negative', '{negative}',
      '--seed', '{seed}',
      '--out', '{output}',
    ],
  });

  assert.equal(imageRun.ok, true);
  assert.equal(imageRun.status, 'complete');
  assert.ok(existsSync(imageRun.imageRouteRecordsPath), 'image route writes execution records');
  const imageRecords = JSON.parse(readFileSync(imageRun.imageRouteRecordsPath, 'utf8'));
  assert.equal(imageRecords.identity, 'orb-inner-engine-image-route-records-v0');
  assert.equal(imageRecords.route, 'local-image.ideogram4');
  assert.equal(imageRecords.effectiveCommand.command, process.execPath);
  assert.match(imageRecords.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(imageRecords.endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(imageRecords.durationMs >= 0, 'image route records envelope duration');
  assert.equal(imageRecords.records.length, 2);
  for (const record of imageRecords.records) {
    assert.equal(record.status, 'complete');
    assert.equal(record.failurePhase, null);
    assert.equal(record.liveGeneratorInvoked, true);
    assert.match(record.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(record.endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(record.durationMs >= 0, 'image route item records duration');
    assert.match(record.promptSha256, /^[0-9a-f]{64}$/);
    assert.match(record.outputImagePath, /orb-inner-engine-concept-[0-9]{2}\.png$/);
    assert.ok(existsSync(record.outputImagePath), 'successful image route produces an output image');
    assert.equal(readFileSync(record.outputImagePath).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(Array.isArray(record.argv));
    assert.ok(record.argv.includes(record.outputImagePath));
  }

  const failingRun = runOrbInnerEngineImageRoute({
    bundleRoot: result.bundleRoot,
    command: process.execPath,
    args: ['-e', 'process.exit(7)'],
  });
  assert.equal(failingRun.ok, false);
  assert.equal(failingRun.status, 'failed');
  const failureRecords = JSON.parse(readFileSync(failingRun.imageRouteRecordsPath, 'utf8'));
  assert.ok(failureRecords.records.some(record => record.status === 'failed'));
  assert.ok(failureRecords.records.some(record => record.failurePhase === 'command-exit'));
  assert.ok(failureRecords.records.every(record => record.durationMs >= 0), 'failed route items record duration');

  execFileSync('node', [
    loopPath,
    '--out-dir', outDir,
    '--core-seed', 'molten-heartfucker-core-contract',
    '--concept-seed', 'view-bank-contract',
    '--concept-count', '2',
  ], { cwd: root, stdio: 'pipe' });

  const receiptPath = join(outDir, 'orb-inner-engine-concept-loop-v0', 'receipt.json');
  assert.ok(existsSync(receiptPath), 'CLI writes a durable receipt');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.ok, true);
  assert.equal(receipt.identity, 'orb-inner-engine-concept-loop-v0');
  assert.equal(receipt.outputs.manifestPath, join(outDir, 'orb-inner-engine-concept-loop-v0', 'manifest.json'));
  assert.equal(receipt.honesty.liveGeneratorsInvoked, false);
  assert.equal(receipt.honesty.status, 'manifest-only-no-live-generation');

  execFileSync('node', [
    loopPath,
    '--out-dir', outDir,
    '--core-seed', 'molten-heartfucker-core-contract',
    '--concept-seed', 'view-bank-contract-cli-image',
    '--concept-count', '1',
    '--image-command', process.execPath,
    '--image-arg', fixtureCommand,
    '--image-arg', '--seed',
    '--image-arg', '{seed}',
    '--image-arg', '--out',
    '--image-arg', '{output}',
  ], { cwd: root, stdio: 'pipe' });
  const cliImageRecordsPath = join(outDir, 'orb-inner-engine-concept-loop-v0', 'image-route-records.json');
  const cliImageRecords = JSON.parse(readFileSync(cliImageRecordsPath, 'utf8'));
  assert.equal(cliImageRecords.records.length, 1);
  assert.equal(cliImageRecords.records[0].status, 'complete');
  assert.ok(cliImageRecords.durationMs >= 0, 'CLI image route records envelope duration');
  assert.ok(cliImageRecords.records[0].durationMs >= 0, 'CLI image route item records duration');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
