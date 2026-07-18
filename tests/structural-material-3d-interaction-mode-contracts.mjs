import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildLayeredStructuralWitnessScenario } from '../structural-material-3d-core.js';

const root = new URL('..', import.meta.url).pathname;
const pageSource = readFileSync(join(root, 'structural-material-3d.html'), 'utf8');
const hotSidecarSource = readFileSync(join(root, 'structural-material-3d-webgpu-hot-sidecar.js'), 'utf8');
const witnessSource = readFileSync(join(root, 'structural-material-3d-webgpu-hot-sidecar-witness.mjs'), 'utf8');
const greenroomSource = readFileSync(join(root, 'structural-material-3d-interaction-mode-greenroom-launch.mjs'), 'utf8');
const liveDrag = await import('../structural-material-3d-live-drag.js');

assert.equal(
  typeof liveDrag.createStructuralInteractionModeController,
  'function',
  'Shear and Bind need an explicit operation-mode contract instead of command-like buttons',
);
assert.equal(
  typeof liveDrag.buildLayeredStructuralPickedBinding,
  'function',
  'Bind gestures need a pure picked-contact command rather than crack-midpoint fallback',
);
assert.equal(
  typeof liveDrag.buildLayeredStructuralBindContactPreview,
  'function',
  'Bind needs an immediate visual contact response independent of GPU repair cadence',
);

const modes = liveDrag.createStructuralInteractionModeController();
assert.deepEqual(modes.snapshot(), {
  route: 'kaminos.structural-material.interaction-mode.v0',
  mode: 'shear',
  revision: 0,
});
assert.deepEqual(modes.select('bind'), {
  changed: true,
  route: 'kaminos.structural-material.interaction-mode.v0',
  mode: 'bind',
  previousMode: 'shear',
  revision: 1,
});
assert.deepEqual(modes.select('bind'), {
  changed: false,
  route: 'kaminos.structural-material.interaction-mode.v0',
  mode: 'bind',
  previousMode: 'bind',
  revision: 1,
}, 'reselecting an active mode is idempotent');
assert.throws(() => modes.select('smash'), /unsupported structural interaction mode/i);

const pickedBinding = liveDrag.buildLayeredStructuralPickedBinding({
  gestureId: 'picked-drag-17',
  operationMode: 'bind',
  point: { x: 0.173, y: 0.612, z: 0.81 },
  radius: 0.27,
  inputLoad: 0.75,
  contactIdentity: {
    authority: 'stable-rest-material-contact-v0',
    kind: 'node',
    id: 'n54',
    segmentT: null,
  },
});
assert.deepEqual(pickedBinding.point, { x: 0.173, y: 0.612, z: 0.81 });
assert.equal(pickedBinding.radius, 0.27);
assert.equal(pickedBinding.strength, 1.45);
assert.equal(pickedBinding.gestureId, 'picked-drag-17');
assert.equal(pickedBinding.contactIdentity.id, 'n54');
assert.notEqual(pickedBinding.contactIdentity, null);
assert.throws(
  () => liveDrag.buildLayeredStructuralPickedBinding({ operationMode: 'shear' }),
  /requires a bind-mode picked interaction/i,
);

const cracked = buildLayeredStructuralWitnessScenario().states.cracked;
const previewNode = cracked.nodes
  .filter(node => !node.pinned)
  .sort((a, b) => Math.hypot(
    b.displacement.x,
    b.displacement.y,
    b.displacement.z,
  ) - Math.hypot(
    a.displacement.x,
    a.displacement.y,
    a.displacement.z,
  ))[0];
const previewInteraction = {
  operationMode: 'bind',
  gestureId: 'preview-bind-1',
  point: { x: previewNode.x, y: previewNode.y, z: previewNode.z },
  radius: 0.28,
  inputLoad: 0.72,
  contactRamp: 1,
  contactIdentity: {
    authority: 'stable-rest-material-contact-v0',
    kind: 'node',
    id: previewNode.id,
    segmentT: null,
  },
};
const beforeConnectivity = cracked.bonds.map(bond => ({
  id: bond.id,
  alive: bond.alive,
  repaired: bond.repaired,
}));
const bindPreview = liveDrag.buildLayeredStructuralBindContactPreview(cracked, previewInteraction);
assert.equal(bindPreview.status, 'active');
assert.equal(bindPreview.authority, 'visual-only-bind-contact-compliance-not-connectivity-v0');
assert.equal(bindPreview.sourceTopologyEpoch, cracked.topologyEpoch);
assert.equal(bindPreview.sourceConnectivityEpoch, cracked.connectivityEpoch);
assert.ok(bindPreview.maxOffset > 0, 'active Bind produces visible pre-repair compliance');
assert.ok(bindPreview.nodeOffsets.some(entry => entry.nodeId === previewNode.id && entry.weight === 1));
const contactOffset = bindPreview.nodeOffsets.find(entry => entry.nodeId === previewNode.id).offset;
assert.ok(
  contactOffset.x * previewNode.displacement.x +
    contactOffset.y * previewNode.displacement.y +
    contactOffset.z * previewNode.displacement.z < 0,
  'Bind preview moves displaced material toward rest rather than farther apart',
);
assert.deepEqual(
  cracked.bonds.map(bond => ({ id: bond.id, alive: bond.alive, repaired: bond.repaired })),
  beforeConnectivity,
  'visual Bind compliance cannot mutate source connectivity',
);
const zeroPreview = liveDrag.buildLayeredStructuralBindContactPreview(cracked, {
  ...previewInteraction,
  inputLoad: 0,
  contactRamp: 0,
});
assert.equal(zeroPreview.maxOffset, 0, 'zero-input Bind cannot visually counterfeit repair');

assert.match(pageSource, /role="group"[^>]*aria-label="Structural operation"/, 'operation buttons expose one grouped mode selector');
assert.match(pageSource, /id="fracture"[^>]*aria-pressed="true"/, 'Shear is visibly and accessibly selected by default');
assert.match(pageSource, /id="bind"[^>]*aria-pressed="false"/, 'Bind starts visibly and accessibly inactive');
assert.match(
  pageSource,
  /querySelector\('#fracture'\)\.addEventListener\('click', \(\) => \{\s*selectStructuralInteractionMode\('shear'\);\s*\}\);/,
  'selecting Shear does not inject a canned force',
);
assert.match(
  pageSource,
  /querySelector\('#bind'\)\.addEventListener\('click', \(\) => \{\s*selectStructuralInteractionMode\('bind'\);\s*\}\);/,
  'selecting Bind does not immediately mutate connectivity',
);
assert.match(pageSource, /const operationMode = structuralInteractionMode\.snapshot\(\);[\s\S]*operationMode:\s*operationMode\.mode/, 'pointerdown snapshots the selected operation at the picked contact');
assert.match(pageSource, /interaction\.operationMode === 'bind'[\s\S]*buildLayeredStructuralPickedBinding\(interaction\)[\s\S]*requestGpuBinding/, 'Bind gestures route to resident binding');
assert.match(pageSource, /interaction\.operationMode === 'shear'[\s\S]*requestGpuSympatheticTear/, 'Shear gestures route to the resident tear solver');
assert.match(pageSource, /interactionMode:\s*structuralInteractionMode\.snapshot\(\)/, 'the product witness exposes effective interaction mode identity');
assert.doesNotMatch(pageSource, /GPU bind no-op \| repaired/, 'a settled duplicate release cannot contradict the gesture repair already visible');
assert.match(witnessSource, /Input\.dispatchMouseEvent[\s\S]*#bind/, 'browser evidence selects Bind through a real pointer event');
assert.match(witnessSource, /modeSelectionInert/, 'browser evidence rejects structural mutation caused by selecting a mode');
assert.match(witnessSource, /pickedBindLocality/, 'browser evidence binds the GPU repair point to the rendered picked contact');
assert.match(witnessSource, /bindDidNotInvokeTear/, 'browser evidence rejects a Bind gesture routed through Shear');
assert.match(witnessSource, /bindingRouteStatusVisible/, 'browser evidence requires the operator-visible status to identify resident binding');
assert.match(
  pageSource,
  /gpuBindingPostExecutionWitnessHold/,
  'Bind exposes a dedicated hold at the post-execution cancellation boundary',
);
assert.match(
  pageSource,
  /request-invalidated-after-execution[\s\S]*binding invalidated after GPU execution/,
  'a Bind cancelled after resident execution settles as an explicit failed operation',
);
assert.match(
  pageSource,
  /sidecar\.bind\(binding,\s*\{[\s\S]*acceptReceipt[\s\S]*request-invalidated-after-execution/,
  'the page gives resident Bind an acceptance predicate at its transactional boundary',
);
assert.match(
  hotSidecarSource,
  /acceptReceipt[\s\S]*restoreAcceptedGpuState\(sourceState\)[\s\S]*state = applyGpuBondMutationState/,
  'the sidecar rolls a rejected Bind back before committing its accepted resident mirror',
);
assert.match(
  witnessSource,
  /cancelledInFlightBindingRejected/,
  'browser evidence rejects a cancelled post-execution Bind that settles as passed',
);
assert.match(
  witnessSource,
  /residentPageBindingAgreementAfterCancel/,
  'browser evidence compares resident connectivity with the page after cancelled Bind rollback',
);
assert.match(pageSource, /visibleBindContactPreview/, 'the product witness exposes visual-only Bind compliance separately from structural state');
assert.match(pageSource, /renderTimingLedger/, 'the product witness separates material rebuild and scene submission timing');
assert.match(witnessSource, /bindPreviewPrecededGpuAcceptance/, 'browser evidence requires shell response before held GPU Bind acceptance');
assert.match(witnessSource, /bindPreviewAdvancedWhileGpuHeld/, 'browser evidence requires multiple immediate preview states during one held GPU transaction');
assert.match(witnessSource, /bindPreviewRenderWithinFrameBudget/, 'browser evidence rejects a preview path that misses one 60 Hz frame before GPU acceptance');
assert.match(witnessSource, /bindPreviewPreservedConnectivity/, 'browser evidence rejects preview-authored connectivity');
assert.match(greenroomSource, /bind-interaction-mode-greenroom-r9/, 'continuous Bind response has a dedicated non-overwriting Greenroom artifact identity');
assert.match(greenroomSource, /structural-material-3d-resident-solver-greenroom-launch/, 'Bind mode evidence retains the accepted native-WebGPU route shield');
assert.match(witnessSource, /visualState:\s*'post-picked-bind'/, 'visual evidence names the bound state whose color predicate it applies');
assert.match(witnessSource, /capture:\s*lastCapture/, 'a failed pixel predicate still preserves the last trustworthy screenshot');

console.log('structural-material-3d interaction mode contracts passed');
