import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const NEW = ['volume-emitter-line-weight', 'volume-emitter-jet-jitter', 'volume-emitter-inlet-turbulence', 'volume-emitter-inlet-turbulence-scale', 'volume-emitter-puff', 'volume-emitter-puff-period'];
const SNAPSHOT = { 'volume-emitter-line-weight': 'emitterLineWeight', 'volume-emitter-jet-jitter': 'emitterJetJitter', 'volume-emitter-inlet-turbulence': 'emitterInletTurbulence', 'volume-emitter-inlet-turbulence-scale': 'emitterInletTurbulenceScale', 'volume-emitter-puff': 'emitterPuff', 'volume-emitter-puff-period': 'emitterPuffPeriod' };

test('the six slice-3 inlet controls exist, are read, displayed, listened to, helped, and are additive 228–233 in the schema', () => {
  const listenerList = index.slice(index.indexOf("'volume-emitter-source-law',"), index.indexOf("'volume-wind-gust-veer',") + 400);
  for (const id of NEW) {
    assert.match(index, new RegExp(`<input type="range" id="${id}" data-volume-settings-param="${id.replace(/-/g, '_')}"`), `${id} row`);
    assert.match(index, new RegExp(`${SNAPSHOT[id]}: parseFloat\\(document\\.getElementById\\('${id}'\\)\\.value\\)`), `${id} in the controls snapshot`);
    assert.match(index, new RegExp(`getElementById\\('${id}-val'\\)\\.textContent = `), `${id} value display`);
    assert.ok(listenerList.includes(`'${id}',`), `${id} has a change listener`);
    // The help span follows its row as a sibling: that is what the hover-help
    // installer (previousElementSibling must be the row) and the layout
    // engine's row clustering expect; a span nested inside the row is unreachable.
    const rowEnd = index.indexOf('</div>', index.indexOf(`id="${id}"`));
    const afterRow = index.slice(rowEnd, rowEnd + 400);
    assert.match(afterRow, /^<\/div>\s*<span class="slider-help">/, `${id} help text follows the row as a sibling`);
    const inside = index.slice(index.indexOf(`id="${id}"`), rowEnd);
    assert.doesNotMatch(inside, /slider-help/, `${id} has no help span nested inside the row`);
  }
  assert.equal(schema.controlCount, 235);
  assert.deepEqual(NEW.map(id => schema.controls.find(c => c.key === id)?.additiveSinceControlCount), [228, 229, 230, 231, 232, 233]);
  assert.deepEqual(NEW.map(id => schema.controls.find(c => c.key === id)?.additiveDefault), [1, 0, 0, 6, 0, 3]);
});

// A saved basin is its route: the preset page re-enters the cockpit with the
// basin's parameters in the URL, and initKaminosVolumeRoute applies them. The
// slice-1 fuel/temperature, the slice-2 pattern/swirl/wind and the slice-3
// inlet controls were never applied there (only the older emitter dynamics
// had explicit reads), so a cold load of a saved basin fell back to the page
// defaults for all seventeen (witnessed: route-restore-e05f6323). The route
// initialiser applies every one of them by its settings param.
const ROUTE_RESTORED = ['volume-emitter-fuel-fraction', 'volume-emitter-inlet-temperature', 'volume-emitter-aperture-pattern', 'volume-emitter-aperture-count', 'volume-emitter-aperture-ratio', 'volume-emitter-aperture-seed', 'volume-emitter-swirl', 'volume-wind-model', 'volume-wind-gust', 'volume-wind-gust-period', 'volume-wind-gust-veer', ...NEW];
test('every inflow and wind control is restored from a saved route by the route initialiser', () => {
  const init = index.slice(index.indexOf('async function initKaminosVolumeRoute()'), index.indexOf('\n}\n', index.indexOf('async function initKaminosVolumeRoute()')));
  const listMatch = init.match(/const VOLUME_ROUTE_RESTORED_CONTROL_IDS = \[([^\]]*)\];/);
  assert.ok(listMatch, 'the initialiser names the controls it restores from the route');
  const listed = [...listMatch[1].matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
  for (const id of ROUTE_RESTORED) assert.ok(listed.includes(id), `${id} is restored from the route`);
  assert.match(init, /for \(const id of VOLUME_ROUTE_RESTORED_CONTROL_IDS\) \{\s*\n\s*const param = document\.getElementById\(id\)\?\.dataset\.volumeSettingsParam;\s*\n\s*if \(!param \|\| !params\.has\(param\)\) continue;\s*\n\s*const value = params\.get\(param\);[\s\S]{0,600}?setVolumeControlValue\(id, value\);\s*\n\s*\}/, 'each listed control takes its route value through the shared setter (the retired pattern aside)');
});

test('spiral and concentric are gone from the pattern select; retired-from-the-interface rows stay in the DOM but hidden', () => {
  const select = index.slice(index.indexOf('id="volume-emitter-aperture-pattern"'), index.indexOf('</select>', index.indexOf('id="volume-emitter-aperture-pattern"')));
  assert.doesNotMatch(select, /spiral|concentric/);
  assert.match(select, /value="shape"[\s\S]*value="jets"[\s\S]*value="slot"[\s\S]*value="bed"/);
  for (const id of ['volume-pressure-mode', 'volume-pressure-tier-overlay', 'volume-pressure-tier-lower-max', 'volume-pressure-tier-hero-min', 'volume-pressure-tier-hero-max', 'volume-emitter-aperture-ratio']) {
    assert.match(index, new RegExp(`<div class="slider-row"[^>]*data-volume-ui-retired="${id}"[^>]*>\\s*<span class="slider-label">[^<]*</span>\\s*<(?:input|select)[^>]*id="${id}"`), `${id} row is marked retired from the interface`);
    assert.match(index, new RegExp(`getElementById\\('${id}'\\)`), `${id} is still read, so saved basins route their value`);
  }
  assert.match(index, /\.slider-row\[data-volume-ui-retired\] \{ display: none; \}/);
  // The layout engine must keep these controls authorable: saved layouts name
  // them and the validator rejects a layout naming a control the page does not
  // author (a 3d73ef32 exclusion made every saved layout fail to load).
  const layoutEngine = readFileSync(new URL('../volume-cockpit-layout.mjs', import.meta.url), 'utf8');
  const authorable = layoutEngine.slice(layoutEngine.indexOf('function isAuthorableControl'), layoutEngine.indexOf('\n}\n', layoutEngine.indexOf('function isAuthorableControl')));
  const authorableCode = authorable.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(authorableCode, /data-volume-ui-retired/, 'retired-from-the-interface rows stay layout-authorable (the exclusion is absent from the code; the comment may name it)');
});

test('the older emitter dynamics and the boundary gradient / softness / cut hide while the inflow law is selected', () => {
  assert.match(index, /const VOLUME_INFLOW_HIDDEN_CONTROL_IDS = \['volume-emitter-source-depth', 'volume-emitter-inlet-profile', 'volume-emitter-momentum-linked', 'volume-emitter-shear-width', 'volume-emitter-edge-entrainment', 'volume-reaction-boundary-gradient', 'volume-reaction-boundary-softness', 'volume-reaction-boundary-cut'\];/);
  assert.match(index, /const hide = sourceLaw === 'inflow-boundary';/);
  assert.match(index, /applyVolumeInflowLawRowVisibility\(document\.getElementById\('volume-emitter-source-law'\)\?\.value\);/, 'applied on every receipt update, so a basin load re-evaluates it');
  assert.match(index, /\.slider-row\[data-volume-inflow-hidden="true"\] \{ display: none; \}/);
});

// A basin saved with a retired pattern (spiral, concentric) must load as the
// family shape AND keep the saved request so the receipt can say so. Assigning
// the retired value to the select clears it (no such option), so the route
// loader sets the select to shape and keeps the request beside it; the
// controls snapshot sends the kept request to the resolver; authoring a new
// pattern clears it.
test('a retired pattern in a saved route loads as the family shape with its request kept for the receipt, until a new pattern is authored', () => {
  assert.match(index, /const VOLUME_RETIRED_APERTURE_PATTERNS = \['concentric', 'spiral'\];/);
  const init = index.slice(index.indexOf('async function initKaminosVolumeRoute()'), index.indexOf('\n}\n', index.indexOf('async function initKaminosVolumeRoute()')));
  assert.match(init, /if \(id === 'volume-emitter-aperture-pattern' && VOLUME_RETIRED_APERTURE_PATTERNS\.includes\(value\)\) \{\s*\n\s*patternSelect\.value = 'shape';\s*\n\s*patternSelect\.dataset\.volumeRetiredPatternRequest = value;/, 'the loader keeps the retired request beside a valid selection');
  assert.match(index, /emitterAperturePattern: volumeAperturePatternValue\(document\.getElementById\('volume-emitter-aperture-pattern'\)\)/, 'the snapshot sends the kept request so the resolver names the fallback');
  assert.match(index, /delete document\.getElementById\('volume-emitter-aperture-pattern'\)\.dataset\.volumeRetiredPatternRequest/, 'authoring a pattern clears the kept request');
  assert.match(index, /volume-emitter-aperture-pattern-val'\)\.textContent = [^;]*retired/, 'the label says a retired request is standing in');
});

// Saving must not migrate a retired request: the canonical DOM-control reader
// (the save path and the capture route) returns the kept request, as the
// simulation snapshot does, until the operator authors a pattern.
test('saving an untouched retired-pattern basin keeps its request (the DOM-control reader returns the kept request)', () => {
  const reader = index.slice(index.indexOf('function readVolumeDomControlValue(el)'), index.indexOf('\n}\n', index.indexOf('function readVolumeDomControlValue(el)')));
  assert.match(reader, /if \(el\.id === 'volume-emitter-aperture-pattern'\) return volumeAperturePatternValue\(el\);/, 'the reader returns the kept retired request for the pattern select (volumeAperturePatternValue, tests/volume-exact-load-contracts.mjs)');
});

// The hover help renders through one popover on body: the sidebar is a
// transformed ancestor, so a fixed box inside it is positioned against the
// sidebar and landed 3000 px offscreen (probe on 18462, 2026-10-06). The row's
// help span stays in place (layout clustering, contracts) and hidden.
test('help marks show their text through a body-level popover, on hover, focus and click', () => {
  const installer = index.slice(index.indexOf('(function installVolumeHelpMarks()'), index.indexOf('})();', index.indexOf('(function installVolumeHelpMarks()')));
  assert.match(installer, /popover\.id = 'volume-help-popover'/);
  assert.match(installer, /document\.body\.appendChild\(popover\)/, 'the popover is a child of body, outside the transformed sidebar');
  assert.match(installer, /popover\.textContent = help\.textContent;/, 'it shows the row\'s help text');
  assert.match(installer, /mark\.addEventListener\('click'/, 'click toggles it (trackpads without hover)');
  assert.doesNotMatch(installer, /help\.setAttribute\('data-open'/, 'the in-place span is never opened');
  assert.match(index, /#volume-help-popover \{ display: none; position: fixed;/);
  assert.match(index, /\.slider-help \{ display: none; \}/);
});

test('the force-contribution rows leave the interface (master and interface shred stay on by default)', () => {
  for (const id of ['volume-procedural-detail-forces', 'volume-force-micro-carrier', 'volume-force-interface-shred', 'volume-force-fine-breakup', 'volume-fine-breakup-localization']) {
    assert.match(index, new RegExp(`<div class="slider-row[^"]*"[^>]*data-volume-ui-retired="${id}"`), `${id} is retired from the interface`);
  }
  assert.match(index, /<input type="checkbox" id="volume-procedural-detail-forces" checked>/, 'master stays on by default');
  assert.match(index, /<input type="checkbox" id="volume-force-interface-shred" data-volume-settings-param="volume_force_interface_shred" checked>/, 'interface shred stays on by default');
});
