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
  assert.equal(schema.controlCount, 233);
  assert.deepEqual(NEW.map(id => schema.controls.find(c => c.key === id)?.additiveSinceControlCount), [228, 229, 230, 231, 232, 233]);
  assert.deepEqual(NEW.map(id => schema.controls.find(c => c.key === id)?.additiveDefault), [1, 0, 0, 6, 0, 3]);
});

test('the six slice-3 controls are applied from a saved route like every other inflow control', () => {
  // Whatever loop applies volume_emitter_swirl from the URL must apply these too.
  const swirlApplications = [...index.matchAll(/volume_emitter_swirl/g)].length;
  for (const id of NEW) {
    const param = id.replace(/-/g, '_');
    const applications = [...index.matchAll(new RegExp(param, 'g'))].length;
    assert.ok(applications >= swirlApplications, `${param} appears in the page at least as often as volume_emitter_swirl (${applications} vs ${swirlApplications}): it is applied from routes wherever swirl is`);
  }
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
