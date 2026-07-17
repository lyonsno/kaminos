#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildFirstPyroControlPathLedgerSlice,
  enumeratePyroControlSchema,
  PYRO_CONTROL_PATH_PARITY_LEDGER_SCHEMA,
} from '../pyro-control-path-parity-audit.mjs';

const controls = await enumeratePyroControlSchema();
const byRouteKey = new Map(controls.map(control => [control.routeKey, control]));

assert.ok(controls.length >= 90, 'audit enumerates the uncapped volume control surface from the actual page schema');
assert.ok(byRouteKey.has('volume_boundary_splat_radius'), 'splat radius route key is discovered from the actual schema');
assert.ok(byRouteKey.has('volume_boundary_sidecar_view'), 'boundary sidecar view route key is discovered from the actual schema');
assert.ok(byRouteKey.has('volume_pyro_radiance'), 'fire appearance route key is discovered from the actual schema');
assert.ok(byRouteKey.has('volume_fire_licks'), 'nonlinear fire-lick control is discovered from the actual schema');

const radius = byRouteKey.get('volume_boundary_splat_radius');
for (const stage of ['geometry', 'presentation', 'splat-admission']) {
  assert.ok(radius.downstreamStages.includes(stage), `splat radius reaches ${stage}`);
}
assert.equal(radius.ownerStage, 'splat-geometry');
assert.equal(radius.source.routeHydrated, true, 'splat radius is hydrated through the dynamic extractor field table');
assert.equal(radius.source.listenedBySyncControls, true, 'splat radius is listened through the dynamic extractor field table');
assert.match(radius.sourceFieldHash, /^[a-f0-9]{64}$/);

const sidecarBlur = byRouteKey.get('volume_boundary_sidecar_blur');
assert.equal(sidecarBlur.source.routeHydrated, true, 'sidecar blur is hydrated through the dynamic extractor field table');
assert.equal(sidecarBlur.source.listenedBySyncControls, true, 'sidecar blur is listened through the dynamic extractor field table');

const sidecarView = byRouteKey.get('volume_boundary_sidecar_view');
assert.ok(sidecarView.downstreamStages.includes('presentation'), 'sidecar view is explicitly classified as a presentation/debug route');
assert.equal(sidecarView.classificationHint, 'intentional-route-specific');

const ledger = await buildFirstPyroControlPathLedgerSlice();
assert.equal(ledger.schema, PYRO_CONTROL_PATH_PARITY_LEDGER_SCHEMA);
assert.equal(ledger.requestedScope, 'first-executable-vertical-slice');
assert.equal(ledger.enumeration.count, controls.length);
assert.equal(ledger.enumeration.uncapped, true);
assert.match(ledger.source.indexHtml.sha256, /^[a-f0-9]{64}$/);
assert.match(ledger.source.volumeCore.sha256, /^[a-f0-9]{64}$/);
assert.ok(ledger.controls.some(control => control.routeKey === 'volume_boundary_splat_radius'));
assert.ok(ledger.controls.some(control => control.routeKey === 'volume_fire_licks'));

const positive = ledger.perturbations.find(item => item.id === 'positive-boundary-splat-radius-geometry');
assert.ok(positive, 'ledger includes a proved positive splat coupling');
assert.equal(positive.classification, 'parity-coupled');
assert.equal(positive.requested.effectiveEqualsRequested, true);
assert.ok(positive.deltas.geometry.radiusMeanAbs > 0, 'positive fixture records geometry delta');
assert.ok(positive.deltas.pixel.meanAbs > 0, 'positive fixture records pixel delta');
assert.ok(positive.appliedPasses.splatApplied, 'positive fixture proves splat pass application');
assert.equal(positive.runtimeEvidence.sourceBound, true, 'positive fixture is source-bound to production runtime evidence');
assert.equal(positive.runtimeEvidence.bindingComplete, true, 'positive fixture fails if production source binding disappears');
assert.deepEqual(positive.runtimeEvidence.missing, []);
for (const key of ['uiField', 'routeHydration', 'syncListener', 'readControls', 'stateNormalization', 'gpuUniformWrite', 'vertexFootprint', 'fragmentKernel']) {
  assert.ok(positive.runtimeEvidence[key]?.line > 0, `positive fixture records ${key} source line`);
  assert.match(positive.runtimeEvidence[key].excerptHash, /^[a-f0-9]{64}$/);
}
assert.match(positive.sourceFieldHash, /^[a-f0-9]{64}$/);

const intentional = ledger.perturbations.find(item => item.id === 'intentional-smoke-hybrid-raymarch-fire-authority');
assert.ok(intentional, 'ledger includes a proved intentional route-specific control');
assert.equal(intentional.classification, 'intentional-route-specific');
assert.equal(intentional.appliedPasses.raymarchApplied, true);
assert.equal(intentional.appliedPasses.splatApplied, true);
assert.equal(intentional.deltas.splatAdmission.candidateCount, 0);
assert.ok(intentional.deltas.raymarch.fireAuthority > 0);

const negative = ledger.perturbations.find(item => item.id === 'negative-requested-effective-dead-parameter-fixture');
assert.ok(negative, 'ledger includes a negative fixture');
assert.equal(negative.classification, 'normalized-no-op');
assert.equal(negative.catches, 'requested-effective-match-with-zero-downstream-delta');
assert.equal(negative.requested.effectiveEqualsRequested, true);
assert.equal(negative.falsifier.tripped, true);
assert.deepEqual(negative.deltas, {
  sourceFields: { changed: false, hashesDiffer: false },
  splatAdmission: { candidateCount: 0, layerCount: 0 },
  coefficient: { colorOpacityMeanAbs: 0 },
  geometry: { radiusMeanAbs: 0, positionMeanAbs: 0 },
  optics: { opacityMeanAbs: 0 },
  presentation: { lumaMeanAbs: 0 },
  pixel: { meanAbs: 0, maxAbs: 0 },
});

for (const item of ledger.perturbations) {
  assert.ok(item.baselines.length >= 2, `${item.id} records at least two lawful baselines`);
  assert.ok(item.requestedIdentity);
  assert.ok(item.effectiveIdentity);
  assert.equal(item.fallback, null);
  assert.equal(item.postLoadMutation, null);
  assert.match(item.sourceFieldHash, /^[a-f0-9]{64}$/);
}

console.log('pyro control-path parity audit contracts passed');
