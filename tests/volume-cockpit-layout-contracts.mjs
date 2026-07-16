import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const witness = readFileSync(join(root, 'volume-settings-preset-witness.mjs'), 'utf8');
const selectiveLive = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));

assert.match(
  index,
  /from ['"]\.\/volume-cockpit-layout\.mjs['"]/,
  'the primary viewer must load the explicit two-root cockpit contract',
);
assert.match(witness, /__kaminosVolumeCockpitLayoutReceipt[\s\S]*controlCount[\s\S]*rootControlCounts/, 'visual witness requires the validated 186-control layout receipt');
assert.match(witness, /volume-authored-mix-panel[\s\S]*volume-authored-mix-body[\s\S]*volume-authored-mix-toggle/, 'visual witness inspects the complete panel surface');
assert.match(witness, /elementFromPoint[\s\S]*hitInsidePanel/, 'visual witness rejects a panel painted behind another surface');
assert.match(
  witness,
  /hostRendererCanvasGeometry[\s\S]*hostCanvasRight[\s\S]*viewportRight[\s\S]*hostCanvasCrossesPanel/,
  'visual witness rejects a stale host-renderer canvas that crosses into the authored-mix panel',
);
assert.match(
  witness,
  /outerToolbarBottom[\s\S]*authoredTitleTop[\s\S]*authoredControlTop[\s\S]*authoredContentObscured/,
  'visual witness rejects authored-mix controls hidden beneath the outer assay toolbar',
);
assert.match(witness, /collapsedWidth[\s\S]*collapsedBodyDisplay[\s\S]*cockpitCollapsedScreenshot/, 'visual witness proves the compact rail state and preserves its pixels');
assert.match(
  witness,
  /TARGET_ONLY_VOLUME_PARAMS[\s\S]*volume_presentation[\s\S]*volume_raymarch_smoke[\s\S]*volume_appearance_decomposition[\s\S]*!TARGET_ONLY_VOLUME_PARAMS\.has\(key\)/,
  'visual witness distinguishes target-only presentation identity from immutable basin settings',
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
assert.match(
  selectiveLive,
  /--kaminos-operator-overlay-safe-top[\s\S]*kaminos-operator-overlay-safe-area-v0[\s\S]*new ResizeObserver\(syncOperatorOverlaySafeArea\)/,
  'the assay shell must publish its measured toolbar occlusion to the inner cockpit',
);
assert.match(
  index,
  /#volume-authored-mix-body\s*\{[^}]*var\(--kaminos-operator-overlay-safe-top,\s*0px\)[^}]*\}/,
  'the authored-mix body must consume the shell overlay safe area without changing standalone routes',
);
assert.match(index, /collectVolumeCockpitControlElements\(document\)/, 'preset capture reads every explicit canonical control root');
assert.doesNotMatch(
  index,
  /querySelectorAll\(['"]#sidebar input\[id\^=[^\n]+#sidebar textarea/,
  'preset capture must not silently retain sidebar-only authority',
);
assert.match(
  index,
  /volume-reaction-boundary-support-thermal[\s\S]*volume-authored-mix-control-root/,
  'the first recovered slice moves one authored-mix canary without cloning it',
);

const {
  VOLUME_AUTHORED_MIX_CONTROL_IDS,
  VOLUME_COCKPIT_CONTROL_ROOT_IDS,
  validateVolumeCockpitControlInventory,
} = await import('../volume-cockpit-layout.mjs');

assert.deepEqual(VOLUME_COCKPIT_CONTROL_ROOT_IDS, [
  'volume-primary-control-root',
  'volume-authored-mix-control-root',
]);
assert.deepEqual(VOLUME_AUTHORED_MIX_CONTROL_IDS, ['volume-reaction-boundary-support-thermal']);

function schemaRecords() {
  return schema.controls.map(control => ({
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
assert.equal(accepted.controlCount, 186);
assert.equal(accepted.expectedControlCount, 186);
assert.deepEqual(accepted.missingControlIds, []);
assert.deepEqual(accepted.unexpectedControlIds, []);
assert.deepEqual(accepted.duplicateControlIds, []);
assert.deepEqual(accepted.rootControlCounts, {
  'volume-primary-control-root': 185,
  'volume-authored-mix-control-root': 1,
});

const missing = schemaRecords().filter(record => record.id !== 'volume-density');
assert.throws(
  () => validateVolumeCockpitControlInventory({ schema, controlRecords: missing }),
  /volume-cockpit-control-inventory-invalid:missing=volume-density/,
  'a missing canonical control fails loud instead of looking like an authoritative partial preset',
);

const duplicate = schemaRecords();
duplicate.push({ ...duplicate[0], rootId: 'volume-authored-mix-control-root' });
assert.throws(
  () => validateVolumeCockpitControlInventory({ schema, controlRecords: duplicate }),
  /duplicate=volume-scene/,
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
