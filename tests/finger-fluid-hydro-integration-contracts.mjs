import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as fingerFluidCore from '../finger-fluid-webgpu-core.js';

const root = new URL('..', import.meta.url).pathname;
const ledgerPath = join(root, 'docs', 'hydro-integration-compatibility-ledger.json');
const corePath = join(root, 'finger-fluid-webgpu-core.js');
const portableMacroRendererPath = join(root, 'finger-fluid-portable-macro-optical-renderer.js');
const portableMacroWitnessPath = join(root, 'finger-fluid-portable-macro-optical-witness.mjs');

assert.ok(
  existsSync(ledgerPath),
  'Hydro integration must publish one canonical compatibility ledger before claiming composition',
);

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const coreSource = readFileSync(corePath, 'utf8');
const portableMacroRendererSource = readFileSync(portableMacroRendererPath, 'utf8');
const portableMacroWitnessSource = readFileSync(portableMacroWitnessPath, 'utf8');

assert.equal(ledger.schema, 'kaminos.hydro-integration.compatibility-ledger.v0');
assert.equal(ledger.owner, 'hydro-integration');
assert.equal(ledger.namedConsumer.owner, 'fingerjuice-bootlegger');
assert.equal(ledger.namedConsumer.hostRoute, 'lerms/hill-of-hills/conservative-fluid-regime-v0');
assert.equal(ledger.namedConsumer.lermsCommit, 'aff2aec43dc00c5d1683588161751d3bd05becdc');
assert.equal(ledger.integrationBranch.repo, 'kaminos');
assert.equal(ledger.integrationBranch.branchLabel, 'hydro-integration-0725');
assert.equal(ledger.sources.bigPapaOwnership.commit, '4dad7121917839151843a00ca176e0d1deab133c');
assert.equal(ledger.sources.bigPapaOwnership.branch, 'cc/big-papa-analytic-jet-handoff-0724');
assert.equal(ledger.sources.bigPapaOwnership.descriptor, 'solver.getParticleOwnershipDescriptor()');
assert.equal(ledger.sources.bigPapaOwnership.contract, 'gpu-spatial-first-support-contact-ownership-v0');
assert.equal(ledger.sources.bigPapaOwnership.consumerVisibilityRule, 'pre_impact_hidden_post_impact_visible_v0');
assert.equal(ledger.sources.outfoxedOptics.commit, 'c7b3fdc1f761db3ab45eae5f25a72cb95f4c2d35');
assert.equal(ledger.sources.outfoxedOptics.branch, 'cc/big-papa-fluid-surface-renderer-0716');
assert.equal(ledger.sources.outfoxedOptics.route, 'kaminos/finger-fluid/portable-macro-screen-space-optics-v0');
assert.equal(ledger.sources.outfoxedOptics.shader, 'wgsl-portable-macro-fresnel-refraction-absorption-v0');
assert.equal(ledger.sources.hillSupport.branch, 'cc/hill-analytic-impact-support-0725');
assert.equal(ledger.sources.hillSupport.commitPrefix, '26b7956');
assert.equal(ledger.sources.hillSupport.package, '@lerms/hill-of-hills-support/hill-of-hills/analytic-impact-support');

assert.ok(
  ledger.pendingCapabilities?.macroShoreline,
  'Hydro ledger must track the published macro shoreline producer without claiming a renderer',
);
assert.deepEqual(ledger.pendingCapabilities.macroShoreline, {
  status: 'producer_published_renderer_pending',
  blocksPrimaryOwnershipMount: false,
  producer: {
    branch: 'cc/big-papa-macro-wet-boundary-0726',
    packageCommit: 'c6baafabd6ea7413d83abd10e68ac160c0d7f584',
    runtimeCommit: '4a863c6f9886fd113af9bc49a61b436f4dca571c',
    package: '@kaminos/fluid-webgpu@0.4.0',
    route: 'kaminos/fluid/macro-wet-boundary',
    fallbackAuthority: 'null_fallback_required',
  },
  renderer: null,
  requiredComparison: [
    'regular_grid_debug',
    'subcell_clipped_shoreline',
  ],
  consumable: false,
});

assert.deepEqual(ledger.materialOwnershipSequence, [
  'analytic_carrier_free_flight',
  'corrected_first_support_contact',
  'source_authoritative_post_impact_particles',
  'portable_macro_wet_body_inventory_transport',
]);
assert.deepEqual(ledger.requiredComparisonModes, ['particle_only', 'hybrid_analytic_carrier']);

for (const gate of [
  'stale_or_default_source_revision',
  'wrong_gpu_device_or_ownership_buffer',
  'host_readback_visibility_substitution',
  'duplicate_analytic_particle_material_ownership',
  'skipped_ownership_state',
  'mismatched_camera_or_attachment_epoch',
  'fallback_backend_or_renderer',
  'partial_blank_or_cached_output',
  'pre_primary_failure_without_durable_report',
]) {
  assert.ok(ledger.falseClosureGates.includes(gate), `ledger must reject ${gate}`);
}

assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_CONTRACT,
  ledger.sources.bigPapaOwnership.contract,
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_PARTICLE_OWNERSHIP_PACKING,
  'material-tracer-vec4-index-4-phase-source-generation-transition-frame-support-contact-v0',
);
assert.equal(
  typeof fingerFluidCore.createFingerFluidInitialParticleOwnershipState,
  'function',
  'source-owned frame-zero ownership initializer must be exported',
);
assert.equal(
  typeof fingerFluidCore.advanceFingerFluidParticleOwnershipState,
  'function',
  'source-owned spatial support transition oracle must be exported',
);
assert.equal(
  typeof fingerFluidCore.mergeFingerFluidParticleOwnershipStates,
  'function',
  'adaptive ownership merge oracle must be exported',
);
assert.equal(
  typeof fingerFluidCore.classifyFingerFluidParticleOwnershipRecord,
  'function',
  'ownership diagnostics must expose a record classifier',
);

assert.match(coreSource, /function getParticleOwnershipDescriptor\(\)/);
assert.match(coreSource, /getParticleOwnershipDescriptor,/);
assert.match(coreSource, /ownershipOffsetBytes:\s*16 \* Float32Array\.BYTES_PER_ELEMENT/);
assert.match(coreSource, /ownershipTransitionState:\s*vec4<f32>/);
assert.match(coreSource, /reset_particle_ownership_for_release\(index,\s*liveInletScene\)/);
assert.match(coreSource, /transition_particle_ownership_on_support_contact\(index,\s*supportContact\)/);
assert.doesNotMatch(
  coreSource.match(/fn transition_particle_ownership_on_support_contact\([\s\S]*?\n\}/)?.[0] ?? '',
  /liveInletAgeState|liveAge/,
  'ownership transition must not regress to residence-age visibility',
);

assert.match(portableMacroRendererSource, /KAMINOS_PORTABLE_MACRO_OPTICAL_RENDERER_ROUTE/);
assert.match(portableMacroRendererSource, /wgsl-portable-macro-fresnel-refraction-absorption-v0/);
assert.match(portableMacroRendererSource, /createFingerFluidPortableMacroOpticalRenderPlan/);
assert.match(portableMacroRendererSource, /validateFingerFluidPortableMacroOpticalRenderAttachments/);
assert.match(portableMacroRendererSource, /fallback:\s*null/);
assert.match(portableMacroWitnessSource, /primary_output_written/);
assert.match(portableMacroWitnessSource, /lastTrustworthyEvidence/);

console.log('finger fluid Hydro integration contracts passed');
