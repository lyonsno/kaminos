import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const presetWitness = readFileSync(join(root, 'volume-settings-preset-witness.mjs'), 'utf8');

function sourceBetween(startNeedle, endNeedle, message) {
  const start = index.indexOf(startNeedle);
  const end = index.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, message);
  return index.slice(start, end);
}

function assertRetiredGroup({ name, endNeedle, ids }) {
  const marker = `data-volume-retired-control-state="${name}"`;
  const source = sourceBetween(marker, endNeedle, `retired ${name} group has a stable source boundary`);
  const openingTag = index.slice(index.lastIndexOf('<', index.indexOf(marker)), index.indexOf('>', index.indexOf(marker)) + 1);
  assert.match(openingTag, /\shidden(?:\s|>)/, `retired ${name} group is non-rendering before script startup`);
  for (const id of ids) {
    assert.match(source, new RegExp(`id="${id}"`), `retired ${name} keeps compatibility control ${id}`);
  }
  return source;
}

const atlasSource = assertRetiredGroup({
  name: 'atlas-capture',
  endNeedle: 'data-volume-control-section="visual-tuning"',
  ids: [
    'volume-reaction-heat-min',
    'volume-reaction-heat-max',
    'volume-reaction-fuel-min',
    'volume-reaction-fuel-max',
    'volume-reaction-flame-min',
    'volume-reaction-flame-max',
    'volume-reaction-front-min',
    'volume-reaction-front-max',
    'volume-reaction-gradient-min',
    'volume-reaction-gradient-max',
    'volume-reaction-core-min',
    'volume-reaction-core-max',
    'volume-reaction-core-reject',
    'volume-reaction-topology-gain',
    'volume-reaction-stretch-erode',
    'volume-reaction-divergence-min',
    'volume-reaction-divergence-max',
    'volume-reaction-divergence-gain',
    'volume-reaction-curl-warp',
    'volume-reaction-shell-gamma',
    'volume-reaction-shell-contrast',
    'volume-reaction-atlas-capture',
    'volume-reaction-atlas-canvas',
    'volume-reaction-atlas-state',
  ],
});
assert.match(atlasSource, /Capture Atlas/, 'retired Atlas action remains available to the diagnostic backend');

assert.doesNotMatch(index, /data-volume-retired-control-state="raymarch-history"/, 'deleted raymarch architecture does not survive as hidden cockpit state');
for (const id of [
  'volume-majorant-skip',
  'volume-majorant-smooth',
  'volume-majorant-guard',
  'volume-temporal-accum',
  'volume-temporal-jitter',
  'volume-history-clamp',
]) {
  assert.doesNotMatch(index, new RegExp(`id="${id}"`), `deleted raymarch control ${id} is absent from the cockpit`);
}

const shellSource = assertRetiredGroup({
  name: 'topology-shell',
  endNeedle: 'id="volume-oracle-activity-cue"',
  ids: [
    'volume-fire-render-mode',
    'volume-shell-inspect-mode',
    'volume-shell-amount',
    'volume-shell-width',
    'volume-shell-thermal',
    'volume-shell-reaction',
    'volume-shell-front',
    'volume-shell-edge',
    'volume-shell-curl',
    'volume-shell-core-suppress',
    'volume-shell-bite',
    'volume-shell-heat',
    'volume-shell-divergence',
    'volume-shell-luma',
    'volume-shell-exposure',
    'volume-shell-soft-clip',
    'volume-shell-smoke',
  ],
});
assert.doesNotMatch(shellSource, /id="volume-oracle-activity-cue"/, 'Oracle cueing remains outside retired topology-shell state');

assert.match(index, /id="volume-oracle-activity-cue"/, 'Oracle cueing remains in the operator cockpit');
assert.match(index, /id="volume-pressure-mode"/, 'Pressure remains in the operator cockpit');
assert.match(
  index,
  /collectVolumeCockpitControlElements\(document\)/,
  'settings capture continues to serialize retired compatibility controls through every canonical control root',
);
assert.match(
  presetWitness,
  /querySelectorAll\('\[data-volume-retired-control-state\]'\)[\s\S]*getComputedStyle[\s\S]*getBoundingClientRect/,
  'browser witness rejects retired groups that still occupy cockpit space',
);
assert.match(
  presetWitness,
  /volume-oracle-activity-cue[\s\S]*volume-pressure-mode/,
  'browser witness proves Oracle Cueing and Pressure remain rendered',
);
assert.match(
  presetWitness,
  /--cockpit-anchor[\s\S]*scrollIntoView/,
  'browser witness can scroll the cockpit to an explicit surviving control before capture',
);

console.log('volume cockpit retired controls contracts passed');
