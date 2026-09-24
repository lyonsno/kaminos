import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const layoutSource = readFileSync(join(root, 'volume-cockpit-layout.mjs'), 'utf8');
const layoutModule = await import('../volume-cockpit-layout.mjs');

const detailRowAndFollower = index.match(
  /<div class="slider-row" data-volume-visual-cost-knob="ray-detail">[\s\S]*?id="volume-detail-scale"[\s\S]*?<\/div>[\s\S]*?(?=<div class="slider-row")/,
)?.[0] || '';
assert.ok(detailRowAndFollower, 'Detail Scale row is present');
assert.doesNotMatch(
  detailRowAndFollower,
  /<span class="slider-help">/,
  'Detail Scale does not grow unsolicited explanatory copy',
);

const windRowAndFollower = index.match(
  /<div class="slider-row" data-volume-visual-cost-knob="occupied-volume">[\s\S]*?id="volume-wind-angle"[\s\S]*?<\/div>[\s\S]*?(?=<div class="slider-row")/,
)?.[0] || '';
assert.ok(windRowAndFollower, 'Wind Angle row is present');
assert.match(windRowAndFollower, /<span class="slider-label">Wind Angle \(°\)<\/span>/, 'Wind Angle names degrees in the label');
assert.doesNotMatch(
  windRowAndFollower,
  /<span class="slider-help">/,
  'Wind Angle uses a unit marker rather than an explanatory sentence',
);

const splatGroup = index.match(
  /<details class="volume-collapsible-group" data-volume-collapsible-group="splat-settings">[\s\S]*?<\/details>/,
)?.[0] || '';
assert.ok(splatGroup, 'Splat settings disclosure is present');
assert.doesNotMatch(
  splatGroup,
  /id="volume-boundary-sidecar-ridge"/,
  'the main baked-ridge intensity remains usable without opening Splat settings',
);
assert.match(index, /id="volume-boundary-sidecar-ridge"/, 'the main baked-ridge intensity remains in the cockpit');

assert.equal(
  typeof layoutModule.setVolumeCockpitGroupCollapsedState,
  'function',
  'group collapse has a local DOM update boundary',
);
assert.match(
  layoutSource,
  /collapse:\s*groupId\s*=>\s*this\.collapseGroup\(groupId\)/,
  'ordinary collapse does not rebuild every cockpit group',
);

const body = { hidden: false };
const toggleAttributes = new Map();
const toggle = {
  textContent: '',
  title: '',
  setAttribute(name, value) { toggleAttributes.set(name, value); },
};
const shell = {
  querySelector(selector) {
    if (selector === ':scope > .volume-layout-group-body') return body;
    if (selector === ':scope > .volume-layout-group-heading > .volume-layout-group-collapse') return toggle;
    return null;
  },
};

const collapsed = layoutModule.setVolumeCockpitGroupCollapsedState({ shell, collapsed: true });
assert.equal(collapsed.collapsed, true);
assert.equal(body.hidden, true);
assert.equal(toggle.textContent, '▸');
assert.equal(toggleAttributes.get('aria-expanded'), 'false');

const expanded = layoutModule.setVolumeCockpitGroupCollapsedState({ shell, collapsed: false });
assert.equal(expanded.collapsed, false);
assert.equal(body.hidden, false);
assert.equal(toggle.textContent, '▾');
assert.equal(toggleAttributes.get('aria-expanded'), 'true');

console.log('volume cockpit product regression contracts passed');
