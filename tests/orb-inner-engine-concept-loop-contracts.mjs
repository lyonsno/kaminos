import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const loopPath = join(root, 'orb-inner-engine-concept-loop.mjs');

assert.ok(existsSync(loopPath), 'orb-inner-engine-concept-loop.mjs must define the generated asset vocabulary loop');

const source = readFileSync(loopPath, 'utf8');
assert.match(source, /orb-inner-engine-concept-loop-v0/, 'concept loop names its stable identity');
assert.match(source, /createOrbInnerEngineConceptManifest/, 'concept loop exports deterministic manifest construction');
assert.match(source, /writeOrbInnerEngineConceptBundle/, 'concept loop exports caller-rooted bundle writing');
assert.match(source, /sharp\.splat/, 'concept loop names the SHARP splat route');
assert.match(source, /starcraft-view-bank/, 'concept loop names the 2.5D view-bank fakery affordance');
assert.match(source, /beaming\.volume-accent/, 'concept loop preserves Beaming volumetric accent as optional, not core');
assert.match(source, /shell-geometry-takeover/, 'concept loop protects Lamellar shell custody');
assert.doesNotMatch(source, /\/tmp\/kaminos-orb-inner-engine-concept-loop/, 'concept loop must not hardcode its output root');

const {
  ORB_INNER_ENGINE_CONCEPT_LOOP_IDENTITY,
  createOrbInnerEngineConceptManifest,
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
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
