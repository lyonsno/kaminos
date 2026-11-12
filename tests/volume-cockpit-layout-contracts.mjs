import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const cockpitLayoutSource = readFileSync(join(root, 'volume-cockpit-layout.mjs'), 'utf8');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));

assert.match(
  index,
  /from ['"]\.\/volume-cockpit-layout\.mjs['"]/,
  'the primary viewer must load the explicit two-root cockpit contract',
);
assert.match(index, /id="volume-primary-control-root"[^>]+data-volume-control-root="primary"/, 'left controls have an explicit canonical root');
assert.match(index, /id="volume-authored-mix-control-root"[^>]+data-volume-control-root="authored-mix"/, 'authored-mix controls have an explicit canonical root');
assert.match(index, /id="volume-authored-mix-panel"/, 'the viewport has a dedicated authored-mix panel sibling');
assert.match(index, /id="volume-authored-mix-toggle"/, 'the authored-mix panel has a collapse command');
assert.match(
  index,
  /#viewport\s*\{[^}]*overflow:\s*hidden[^}]*isolation:\s*isolate[^}]*\}/,
  'the viewport must contain stale or oversized GPU compositor surfaces',
);
assert.match(
  index,
  /function syncViewportRendererSize\(\)[\s\S]*new ResizeObserver\(syncViewportRendererSize\)[\s\S]*observe\(vp\)/,
  'the host renderer must resize from viewport geometry changes, not only window resize events',
);
assert.match(index, /window\.__kaminosSetActiveTab\s*=\s*setActiveTab/, 'the viewer exposes an explicit tab admission API to same-origin volume wrappers');
assert.match(index, /window\.__kaminosActiveTab\s*=\s*\(\)\s*=>/, 'the viewer exposes effective tab identity for volume-only overlay gating');
const volumeTabAdmission = "if (isKaminosVolumeSmokeRoute(initialViewerParams)) setActiveTab('volume');";
const sceneInitializationCall = 'const sceneInitialization = startupSceneAdmission.then(admission => {';
const sceneInitializationContinuation = 'sceneInitialization.then(async () => {';
const volumeAdmissionPrecedesSceneInitialization = source => {
  const admissionIndex = source.indexOf(volumeTabAdmission);
  const initializationIndex = source.indexOf(sceneInitializationCall);
  return admissionIndex !== -1 && initializationIndex !== -1 && admissionIndex < initializationIndex;
};
assert.notEqual(index.indexOf(volumeTabAdmission), -1, 'volume route admission is present');
assert.notEqual(index.indexOf(sceneInitializationCall), -1, 'the current scene initialization call is present');
assert.notEqual(index.indexOf(sceneInitializationContinuation), -1, 'the current asynchronous scene initialization continuation is present');
assert.ok(
  index.indexOf(sceneInitializationCall) < index.indexOf(sceneInitializationContinuation),
  'the asynchronous renderer/environment continuation follows the scene initialization call',
);
assert.ok(
  volumeAdmissionPrecedesSceneInitialization(index),
  'volume-route tab admission must occur before initScene starts asynchronous renderer and environment initialization',
);
const admissionRemoved = index.replace(volumeTabAdmission, '');
assert.notEqual(admissionRemoved, index, 'the volume admission can be isolated for the ordering regression');
const admissionMovedAfterInitialization = admissionRemoved.replace(
  sceneInitializationCall,
  `${sceneInitializationCall}\n${volumeTabAdmission}`,
);
assert.equal(
  volumeAdmissionPrecedesSceneInitialization(admissionMovedAfterInitialization),
  false,
  'the ordering contract rejects moving volume admission until after initScene has started',
);
assert.doesNotMatch(index, /--kaminos-operator-overlay-safe-top/, 'the shared authored-mix panel must not reserve space for a volume-only viewport overlay');
assert.match(index, /collectVolumeCockpitControlElements\(document\)/, 'preset capture reads every explicit canonical control root');
assert.doesNotMatch(
  index,
  /querySelectorAll\(['"]#sidebar input\[id\^=[^\n]+#sidebar textarea/,
  'preset capture must not silently retain sidebar-only authority',
);
assert.match(index, /volume-authored-mix-control-root/, 'the authored-mix surface stays as a root with no resident control after the painting retirement');

const {
  VOLUME_AUTHORED_MIX_CONTROL_IDS,
  VOLUME_COCKPIT_CONTROL_ROOT_IDS,
  validateVolumeCockpitControlInventory,
} = await import('../volume-cockpit-layout.mjs');

assert.deepEqual(VOLUME_COCKPIT_CONTROL_ROOT_IDS, [
  'volume-primary-control-root',
  'volume-authored-mix-control-root',
]);
assert.deepEqual(VOLUME_AUTHORED_MIX_CONTROL_IDS, [], 'the boundary support thermal canary was retired with the legacy material laws');
assert.match(
  cockpitLayoutSource,
  /select\[data-volume-assay-control="emitter-family"\]/,
  'the canonical cockpit collector includes the emitter selector even though its durable id predates the volume-* convention',
);

function schemaRecords() {
  return [...schema.controls, ...schema.rendererControls].map(control => ({
    id: control.key,
    tagName: control.tagName,
    type: control.type,
    rootId: VOLUME_AUTHORED_MIX_CONTROL_IDS.includes(control.key)
      ? 'volume-authored-mix-control-root'
      : 'volume-primary-control-root',
  }));
}

const accepted = validateVolumeCockpitControlInventory({ schema, controlRecords: schemaRecords() });
assert.equal(accepted.identity, 'kaminos-volume-cockpit-layout-receipt-v0');
assert.equal(accepted.controlCount, schema.controls.length + schema.rendererControls.length);
assert.equal(accepted.expectedControlCount, schema.controls.length + schema.rendererControls.length);
assert.equal(accepted.presetControlCount, schema.controlCount);
assert.equal(accepted.rendererControlCount, schema.rendererControls.length);
assert.deepEqual(accepted.missingControlIds, []);
assert.deepEqual(accepted.unexpectedControlIds, []);
assert.deepEqual(accepted.duplicateControlIds, []);
assert.deepEqual(accepted.rootControlCounts, {
  'volume-primary-control-root': schema.controls.length + schema.rendererControls.length - VOLUME_AUTHORED_MIX_CONTROL_IDS.length,
  'volume-authored-mix-control-root': VOLUME_AUTHORED_MIX_CONTROL_IDS.length,
});

const missing = schemaRecords().filter(record => record.id !== 'volume-density');
assert.throws(
  () => validateVolumeCockpitControlInventory({ schema, controlRecords: missing }),
  /volume-cockpit-control-inventory-invalid:missing=volume-density/,
  'a missing canonical control fails loud instead of looking like an authoritative partial preset',
);

const duplicate = schemaRecords();
duplicate.push({ ...duplicate.find(record => record.id === 'volume-resolution'), rootId: 'volume-authored-mix-control-root' });
assert.throws(
  () => validateVolumeCockpitControlInventory({ schema, controlRecords: duplicate }),
  /duplicate=volume-resolution/,
  'a cloned control across roots fails loud',
);

const substituted = schemaRecords();
substituted.find(record => record.id === 'volume-density').type = 'text';
assert.throws(
  () => validateVolumeCockpitControlInventory({ schema, controlRecords: substituted }),
  /type=volume-density:INPUT\/range->INPUT\/text/,
  'a visually plausible control-type substitution cannot retain schema authority',
);

const unexpected = schemaRecords();
unexpected.push({
  id: 'volume-fallback-looking-authoritative',
  tagName: 'INPUT',
  type: 'range',
  rootId: 'volume-primary-control-root',
});
assert.throws(
  () => validateVolumeCockpitControlInventory({ schema, controlRecords: unexpected }),
  /unexpected=volume-fallback-looking-authoritative/,
  'an unregistered volume control cannot silently enter a saved basin',
);

console.log('volume cockpit layout contracts passed');
