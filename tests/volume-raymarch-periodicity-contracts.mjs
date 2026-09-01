import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const raymarch = sourceBetween(
  core,
  'fn raymarchVolume(in: VSOut, sceneDepthEndT: f32) -> RaymarchResult {',
  'fn fs(in: VSOut) -> @location(0) vec4<f32> {',
);

assert.doesNotMatch(
  raymarch,
  /\b(?:sin|cos)\s*\(/,
  'production raymarch appearance must not contain direct explicit periodic modulation',
);
assert.doesNotMatch(
  raymarch,
  /verticalPhaseBreak|verticalPuffBreak/,
  'vertical phase/puff waves must not directly regularize smoke, fire, or vapor appearance',
);
assert.match(
  raymarch,
  /let\s+pyroMemoryStructure\s*=\s*clamp\(/,
  'pyro appearance must use transported material-memory structure rather than a presentation-time phase wave',
);
assert.doesNotMatch(
  raymarch,
  /pyroMemoryPattern/,
  'the retired periodic pyro-memory pattern must not remain as an alias',
);

console.log('volume raymarch periodicity contracts passed');
