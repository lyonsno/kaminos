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
assert.match(witness, /__kaminosVolumeCockpitLayoutReceipt[\s\S]*controlCount[\s\S]*rootControlCounts/, 'visual witness requires the validated complete layout receipt');
assert.match(witness, /volume-authored-mix-panel[\s\S]*volume-authored-mix-body[\s\S]*volume-authored-mix-toggle/, 'visual witness inspects the complete panel surface');
assert.match(witness, /elementFromPoint[\s\S]*hitInsidePanel/, 'visual witness rejects a panel painted behind another surface');
assert.match(
  witness,
  /hostRendererCanvasGeometry[\s\S]*hostCanvasRight[\s\S]*viewportRight[\s\S]*hostCanvasCrossesPanel/,
  'visual witness rejects a stale host-renderer canvas that crosses into the authored-mix panel',
);
assert.match(
  witness,
  /assayViewportGeometry[\s\S]*kaminos-volume-assay-viewport-placement-v0[\s\S]*nonVolumeTabs[\s\S]*for \(const tabName of nonVolumeTabs\)[\s\S]*assay cockpit leaked into the \$\{tabName\} tab/,
  'visual witness proves viewport containment and rejects assay controls leaking into non-volume tabs',
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
  /function syncVolumeAssayViewportPlacement\(\)[\s\S]*#viewport[\s\S]*\.tab\.active\[data-tab\][\s\S]*activeTab === 'volume'[\s\S]*kaminos-volume-assay-viewport-placement-v0/,
  'the assay cockpit must measure and receipt placement inside the active volume viewport',
);
assert.match(
  selectiveLive,
  /#volume-authored-mix-panel[\s\S]*availableViewportRight[\s\S]*insufficient-volume-viewport-space/,
  'responsive placement must subtract the visible authored-mix overlay and fail closed when no flame viewport remains',
);
assert.match(
  selectiveLive,
  /innerWindow\.__kaminosSetActiveTab\?\.\('volume'\)[\s\S]*new ResizeObserver\(syncVolumeAssayViewportPlacement\)/,
  'the assay route must explicitly activate volume and track viewport geometry',
);
assert.match(index, /window\.__kaminosSetActiveTab\s*=\s*setActiveTab/, 'the viewer exposes an explicit tab admission API to same-origin volume wrappers');
assert.match(index, /window\.__kaminosActiveTab\s*=\s*\(\)\s*=>/, 'the viewer exposes effective tab identity for volume-only overlay gating');
assert.ok(
  index.indexOf("if (isKaminosVolumeSmokeRoute(initialViewerParams)) setActiveTab('volume');") < index.indexOf('initScene().then(() => {'),
  'volume-route tab admission must occur before asynchronous renderer and environment initialization',
);
assert.doesNotMatch(
  selectiveLive,
  /#toolbar\s*\{[^}]*top:\s*12px[^}]*left:\s*12px[^}]*right:\s*12px/,
  'the assay cockpit must not span the shared shell as a global fixed toolbar',
);
assert.doesNotMatch(index, /--kaminos-operator-overlay-safe-top/, 'the shared authored-mix panel must not reserve space for a volume-only viewport overlay');
assert.match(
  selectiveLive,
  /for \(const button of compositionButtons\) button\.setAttribute\('aria-pressed',[^\n]+\);\s*compositionSelect\.value = requestedComposition;\s*setRole\(requestedRole\);/,
  'the compact renderer menu must initialize from requested composition instead of displaying its first option',
);
assert.match(
  selectiveLive,
  /function syncCompositionControlAvailability\(presentation\)[\s\S]*compositionSelect\.disabled = disabled[\s\S]*compositionSelect\.setAttribute\('aria-disabled'/,
  'the renderer select itself must become visibly and semantically unavailable when its pass axis is suppressed',
);
assert.match(
  selectiveLive,
  /raymarchSmokeApplied[\s\S]*appearanceApplication\?\.smokeApplied[\s\S]*passReceipt\?\.raymarchApplied === true[\s\S]*raymarch smoke:.*applied:/,
  'operator status must distinguish remembered smoke presentation from smoke actually applied to current pixels',
);
assert.match(
  witness,
  /nonVolumeTabs[\s\S]*for \(const tabName of nonVolumeTabs\)[\s\S]*Emulation\.setDeviceMetricsOverride[\s\S]*responsiveIsolation/,
  'the browser witness must exercise every non-volume tab and the fixed authored-mix responsive breakpoint',
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
assert.equal(accepted.controlCount, 189);
assert.equal(accepted.expectedControlCount, 189);
assert.equal(accepted.presetControlCount, 186);
assert.equal(accepted.rendererControlCount, 3);
assert.deepEqual(accepted.missingControlIds, []);
assert.deepEqual(accepted.unexpectedControlIds, []);
assert.deepEqual(accepted.duplicateControlIds, []);
assert.deepEqual(accepted.rootControlCounts, {
  'volume-primary-control-root': 188,
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
