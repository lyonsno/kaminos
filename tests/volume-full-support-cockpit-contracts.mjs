#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const controllerUrl = new URL('../volume-full-support-cockpit.mjs', import.meta.url);
const sessionUrl = new URL('../volume-full-support-cockpit-session.mjs', import.meta.url);
const witnessUrl = new URL('../volume-full-support-cockpit-witness.mjs', import.meta.url);
assert.ok(existsSync(fileURLToPath(controllerUrl)), 'full-support cockpit authority controller must exist');
assert.ok(existsSync(fileURLToPath(sessionUrl)), 'full-support cockpit session launcher must exist');
assert.ok(existsSync(fileURLToPath(witnessUrl)), 'full-support cockpit must ship a state-aware browser witness');

const {
  FULL_SUPPORT_STAGE_A,
  admitFullSupportStageA,
  buildFullSupportAuthoredFork,
} = await import(controllerUrl);

assert.equal(FULL_SUPPORT_STAGE_A.population.rowCount, 1_899_742);
assert.equal(FULL_SUPPORT_STAGE_A.state.simStepCount, 120);
assert.equal(FULL_SUPPORT_STAGE_A.population.sampleCap, null);
assert.equal(FULL_SUPPORT_STAGE_A.population.droppedRowCount, 0);
assert.equal(FULL_SUPPORT_STAGE_A.deposition.identity, 'flow-tangent-five-tap-bilinear-v0');
assert.equal(FULL_SUPPORT_STAGE_A.transport.identity, 'per-splat-self-extinction-additive-rgb-v0');
assert.equal(FULL_SUPPORT_STAGE_A.transport.attenuatesBehindColor, false);
assert.equal(FULL_SUPPORT_STAGE_A.stageB.status, 'producer-evidence-unverified');
assert.deepEqual(Object.keys(FULL_SUPPORT_STAGE_A.sources), ['analytical-exact', 'learned-baseline', 'learned-flow']);
for (const source of Object.values(FULL_SUPPORT_STAGE_A.sources)) {
  assert.match(source.overlayIdentity, /^sha256:[a-f0-9]{64}$/, 'every Stage A arm is bound to one runtime manifest identity');
  assert.ok(source.sourceOverlayIdentity, 'every Stage A arm is bound to one underlying coefficient-source identity');
}

const completeInput = {
  requestedSource: 'learned-baseline',
  effectiveSource: 'learned-baseline',
  requestedDeposition: 'flow-tangent-five-tap-bilinear-v0',
  effectiveDeposition: 'flow-tangent-five-tap-bilinear-v0',
  requestedTransport: 'per-splat-self-extinction-additive-rgb-v0',
  effectiveTransport: 'per-splat-self-extinction-additive-rgb-v0',
  sourceAudit: {
    status: 'matched',
    routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    grid: 160,
    simStepCount: 120,
  },
  overlay: {
    status: 'effective',
    requestedOverlayIdentity: FULL_SUPPORT_STAGE_A.sources['learned-baseline'].overlayIdentity,
    effectiveOverlayIdentity: FULL_SUPPORT_STAGE_A.sources['learned-baseline'].overlayIdentity,
    sourceOverlayIdentity: FULL_SUPPORT_STAGE_A.sources['learned-baseline'].sourceOverlayIdentity,
    admittedRowCount: 1_899_742,
    lookupMissCount: 0,
    lookupExtraCount: 0,
    droppedRowCount: 0,
    sampleCap: null,
    fallbackReason: null,
  },
  population: {
    candidateCount: 1_899_742,
    instanceCount: 1_899_742,
    overflowCount: 0,
  },
};

const admitted = admitFullSupportStageA(completeInput);
assert.equal(admitted.status, 'effective');
assert.equal(admitted.fallbackUsed, false);
assert.deepEqual(admitted.failures, []);

for (const [label, mutate, failure] of [
  ['silent source substitution', input => { input.effectiveSource = 'analytical-exact'; }, 'source-substitution'],
  ['silent deposition substitution', input => { input.effectiveDeposition = 'kernel-moment-covariance-v0'; }, 'deposition-substitution'],
  ['transport authority inflation', input => { input.effectiveTransport = 'matched-optical-recurrence-v0'; }, 'transport-substitution'],
  ['partial population', input => { input.population.instanceCount -= 1; }, 'partial-population'],
  ['overflow', input => { input.population.overflowCount = 1; }, 'population-overflow'],
  ['lookup miss', input => { input.overlay.lookupMissCount = 1; }, 'overlay-lookup-miss'],
  ['underlying producer substitution', input => { input.overlay.sourceOverlayIdentity = 'sha256:wrong-producer'; }, 'overlay-source-substitution'],
  ['unverified frozen source', input => { input.sourceAudit.status = 'failed'; }, 'source-state-unverified'],
  ['route substitution', input => { input.sourceAudit.effectiveRoute = 'fallback-route'; }, 'source-route-substitution'],
  ['frozen source step substitution', input => { input.sourceAudit.simStepCount = 121; }, 'source-sim-step-substitution'],
  ['fallback that looks effective', input => { input.overlay.fallbackReason = 'nearby-default-overlay'; }, 'overlay-fallback'],
]) {
  const input = structuredClone(completeInput);
  mutate(input);
  const receipt = admitFullSupportStageA(input);
  assert.equal(receipt.status, 'failed', label);
  assert.ok(receipt.failures.includes(failure), `${label} must report ${failure}`);
}

const fork = buildFullSupportAuthoredFork({
  name: 'operator-stage-a-01',
  outputPath: '/tmp/operator-stage-a-01.json',
  sourceReceipt: admitted,
  controls: { exposure: 0.96 },
});
assert.equal(fork.schema, 'kaminos.pyro.full-support-authored-fork.v0');
assert.equal(fork.outputPath, '/tmp/operator-stage-a-01.json');
assert.equal(fork.sourceReceipt.status, 'effective');
assert.throws(
  () => buildFullSupportAuthoredFork({ name: 'missing-path', sourceReceipt: admitted, controls: {} }),
  /caller-provided output path is required/,
);

const [index, core, session, selectiveLive, witness] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../volume-core.js', import.meta.url), 'utf8'),
  readFile(sessionUrl, 'utf8'),
  readFile(new URL('../volume-selective-head-live.html', import.meta.url), 'utf8'),
  readFile(witnessUrl, 'utf8'),
]);
assert.match(index, /id="volume-full-support-source"/, 'cockpit exposes an explicit coefficient source selector');
assert.match(index, /id="volume-full-support-receipt"/, 'cockpit exposes a wrapping authority receipt');
assert.match(index, /Self-extinction \+ additive RGB/, 'operator sees the exact Stage A transport limitation');
assert.match(index, /Matched optical recurrence[\s\S]*stage-b-resources-missing/i, 'Stage B visibly names missing resources instead of presenting a generic evidence block');
assert.match(index, /full_support_source_field_manifest/, 'cockpit route names its frozen source manifest explicitly');
assert.match(
  index,
  /fullSupportManifestUrl[^]*new URL\([^]*window\.location\.href\)\.href/,
  'cockpit resolves routed relative overlay manifests before artifact-sidecar loading',
);
assert.match(index, /beginDebugFullFieldImport[\s\S]*finishDebugFullFieldImport/, 'cockpit imports the exact field state before source selection');
assert.match(index, /resumeDebugImportedFieldLive/, 'cockpit presents the imported field through the native renderer');
assert.match(index, /lookFreeze/, 'cockpit pins imported state while preserving camera-driven rendering');
assert.match(
  index,
  /renderFrozenScaleToCanvas[^]*auditBoundarySplatLiveUnionSourceHashes/,
  'cockpit materializes frozen derived buffers before source-hash admission',
);
assert.match(
  index,
  /setFullSupportDepositionMode\([^]*renderFrozenScaleToCanvas\([^]*fullSupportDepositionEffective/,
  'every requested deposition transition is materialized and checked against its effective renderer identity',
);
const applySourceBody = index.slice(
  index.indexOf('const applyFullSupportSource = async () => {'),
  index.indexOf('const fullSupportBytesToBase64', index.indexOf('const applyFullSupportSource = async () => {')),
);
assert.doesNotMatch(
  applySourceBody,
  /if \(!derivedState\.majorantBuilt \|\| !derivedState\.boundarySidecarBuilt\)/,
  'an already-materialized session must not skip deposition transition materialization',
);
assert.ok(
  index.indexOf('await volumePrototype.setActive(true);', index.indexOf("params.get('kaminos_volume_smoke') === '1'"))
    < index.indexOf('const fullSupportBootstrap = liveFullSupportOpticsRequested'),
  'routed WebGPU activation must complete before either live-state or checksum-state bootstrap begins',
);
assert.match(index, /fullSupportBootstrap\.then\(async stageAReceipt[\s\S]*return bootstrapStageBConsumer\(\)/, 'Stage B must wait for effective replay-backed Stage A state and overlays');
assert.match(core, /loadBoundarySplatLiveUnionCoefficientOverlay/, 'renderer exposes checksum-bound overlay loading');
assert.match(core, /auditBoundarySplatLiveUnionCoefficientOverlayPopulation/, 'renderer gates overlay effectiveness on exact population');
assert.match(core, /flow-tangent-five-tap-bilinear-v0/, 'renderer names the exact live deposition treatment');
assert.match(core, /per-splat-self-extinction-additive-rgb-v0/, 'renderer reports current transport without shared-transmittance inflation');
assert.match(core, /boundarySplatBilinearRenderPipeline[\s\S]*point-list/, 'each exact bilinear neighbor deposit uses one point instead of a six-vertex quad');
assert.match(core, /boundarySplatBilinearIndirectBuffer, 0, new Uint32Array\(\[1, 0, 0, 0\]\)/, 'bilinear indirect draw emits exactly one vertex per raster deposit');
assert.match(session, /--source-field-manifest/, 'session launcher receives the frozen source manifest from the caller');
assert.match(session, /full_support_exact_manifest/, 'session route mounts the analytical exact package');
assert.match(session, /full_support_baseline_manifest/, 'session route mounts the learned baseline package');
assert.match(session, /full_support_flow_manifest/, 'session route mounts the learned flow package');
assert.match(session, /serve\.py/, 'session launcher preserves the canonical Kaminos settings API server');
assert.match(selectiveLive, /key\.startsWith\('full_support_'\)/, 'selective-head wrapper forwards full-support cockpit custody parameters to the renderer');
assert.match(witness, /__kaminosFullSupportStageABootstrapReceipt/, 'witness waits for authoritative bootstrap completion');
assert.match(witness, /analytical-exact[^]*learned-baseline[^]*learned-flow/, 'witness exercises every authored Stage A source');
assert.match(witness, /simStepCount[^]*120/, 'witness rejects same-state drift');
assert.match(witness, /failurePhase[^]*lastTrustworthyEvidence/, 'witness preserves a phase receipt before primary output failure');
assert.match(witness, /Page\.captureScreenshot/, 'witness preserves an inspected operator-facing cockpit frame');
assert.match(witness, /browser-event-audit/, 'cockpit witness names browser event admission as an explicit failure phase');
assert.match(witness, /Runtime\.exceptionThrown/, 'cockpit witness rejects unhandled browser runtime exceptions');
assert.match(witness, /Log\.entryAdded[^]*level[^]*error/, 'cockpit witness rejects browser error log entries');
assert.ok(
  witness.indexOf("failurePhase = 'browser-event-audit'") < witness.indexOf("status: 'passed'"),
  'cockpit browser errors must be adjudicated before the witness can report success',
);

console.log('volume full-support cockpit contracts passed');
