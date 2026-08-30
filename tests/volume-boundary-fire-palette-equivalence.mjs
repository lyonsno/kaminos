import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LEGACY_BOUNDARY_FIRE_CLEAN_ENDPOINT,
  LEGACY_BOUNDARY_FIRE_SOOT_ENDPOINT,
  boundaryFireSrgbEndpoint,
} from '../volume-core.js';

const cockpit = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

const LEGACY_CLEAN = Object.freeze([0.12, 0.42, 1.75]);
const LEGACY_SOOT = Object.freeze([1.55, 0.86, 0.18]);

function valueFor(id) {
  const element = cockpit.match(new RegExp(`<input[^>]+id="${id}"[^>]*>`))?.[0] || '';
  const value = element.match(/\bvalue="(#[0-9a-f]{6})"/i)?.[1];
  assert.ok(value, `${id} has a six-digit sRGB default`);
  return value;
}

function srgbChannelToLinear(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function decodedDirection(hex) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map(srgbChannelToLinear);
  const peak = Math.max(...linear, Number.EPSILON);
  return linear.map(channel => channel / peak);
}

function assertDefaultDirection(id, legacy) {
  const direction = decodedDirection(valueFor(id));
  const peak = Math.max(...legacy);
  const expected = legacy.map(channel => channel / peak);
  direction.forEach((channel, index) => {
    assert.ok(
      Math.abs(channel - expected[index]) <= 0.008,
      `${id} linear channel ${index} preserves legacy direction: ${channel} != ${expected[index]}`,
    );
  });
}

assertDefaultDirection('volume-reaction-boundary-fire-clean-color', LEGACY_CLEAN);
assertDefaultDirection('volume-reaction-boundary-fire-soot-color', LEGACY_SOOT);
assert.deepEqual(
  boundaryFireSrgbEndpoint(valueFor('volume-reaction-boundary-fire-clean-color'), '#4a86ff', LEGACY_CLEAN),
  LEGACY_BOUNDARY_FIRE_CLEAN_ENDPOINT,
  'default clean swatch is algebraically identical to the pre-palette HDR endpoint',
);
assert.deepEqual(
  boundaryFireSrgbEndpoint(valueFor('volume-reaction-boundary-fire-soot-color'), '#ffc460', LEGACY_SOOT),
  LEGACY_BOUNDARY_FIRE_SOOT_ENDPOINT,
  'default soot swatch is algebraically identical to the pre-palette HDR endpoint',
);
assert.deepEqual(
  boundaryFireSrgbEndpoint('#000000', '#4a86ff', LEGACY_CLEAN),
  LEGACY_BOUNDARY_FIRE_CLEAN_ENDPOINT,
  'an achromatic zero swatch cannot erase model-owned HDR energy',
);
assert.deepEqual(
  boundaryFireSrgbEndpoint('#ff0000', '#4a86ff', LEGACY_CLEAN),
  [Math.max(...LEGACY_CLEAN), 0, 0],
  'a custom sRGB swatch changes chromatic direction while retaining model-owned peak energy',
);
assert.match(core, /function boundaryFireSrgbEndpoint\(/, 'Boundary Fire has a dedicated sRGB-to-linear endpoint decoder');
assert.match(core, /srgbChannelToLinear/, 'the dedicated decoder does not raw-divide web color bytes into linear shader values');
assert.match(core, /LEGACY_BOUNDARY_FIRE_CLEAN_ENDPOINT/, 'default clean chroma resolves to the exact pre-palette HDR endpoint');
assert.match(core, /LEGACY_BOUNDARY_FIRE_SOOT_ENDPOINT/, 'default soot chroma resolves to the exact pre-palette HDR endpoint');
assert.doesNotMatch(core, /writePyroPaletteUniform\(uniforms, 336/, 'Boundary Fire does not reuse the legacy raw-byte pyro palette writer');
assert.doesNotMatch(core, /writePyroPaletteUniform\(uniforms, 340/, 'Boundary Fire soot does not reuse the legacy raw-byte pyro palette writer');

console.log('volume Boundary Fire palette default-equivalence contracts passed');
