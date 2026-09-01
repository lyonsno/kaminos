import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTimeFreeWgslCallGraph } from './helpers/wgsl-time-free-callgraph.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assertTimeFreeWgslCallGraph(core, ['hash31'], { label: 'static source-dephasing call graph' });

const timePhasedHash = core.replace(
  '  return fract((r.x + r.y) * r.z);',
  '  return fract((r.x + r.y) * r.z + sin(u.cameraPos_time.w * 0.73) * 0.01);',
);
assert.notEqual(timePhasedHash, core, 'the static-hash false-closure mutation must alter the reviewed source');
assert.throws(
  () => assertTimeFreeWgslCallGraph(timePhasedHash, ['hash31'], { label: 'static source-dephasing call graph' }),
  /must not read temporal globals or tokens|must not introduce explicit periodic behavior/,
  'source-birth static dephasing must reject time phase added inside the already-admitted hash helper',
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const commonTallCanonicalSourceBirth = sourceBetween(
  core,
  '  let sourceCenter = p - u.primitive_source.xyz;',
  '  let bonfireSourceY = 0.62;',
);

assert.doesNotMatch(
  commonTallCanonicalSourceBirth,
  /\b(?:sin|cos)\s*\(/,
  'common, Tall Plume, and Canonical source birth must not paint animated periodic waves into transported material',
);
assert.doesNotMatch(
  commonTallCanonicalSourceBirth,
  /\b(?:time|canonicalPhaseTime)\b/,
  'source-breakup irregularity must not advance from a hidden presentation clock',
);
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+transportedSourceStructure\s*=\s*clamp\(/,
  'source breakup must respond to transported material, fire, interface, and combustion-front topology',
);
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+sourceSpatialDephase\s*=\s*hash31\(/,
  'empty-field source startup may retain low-authority static spatial dephasing',
);
const staticDephaseDefinitions = sourceBetween(
  commonTallCanonicalSourceBirth,
  '  let sourceSpatialDephase = hash31(',
  '  let breakup = clamp(',
);
assert.doesNotMatch(
  staticDephaseDefinitions,
  /\b(?:time|frame|canonicalPhaseTime)\b/,
  'static source dephasing must not become animated source choreography',
);
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+tallPlumeSmokeSourceBreakup\s*=\s*clamp\(/,
  'Tall Plume smoke birth must own an explicit transported/static breakup law',
);
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+tallPlumeFrontPacketBreakup\s*=\s*clamp\(/,
  'Tall Plume front birth must retain bounded nonperiodic irregularity',
);
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+tallPlumeEmitterBreakup\s*=\s*clamp\(/,
  'Tall Plume emitter birth must retain bounded nonperiodic irregularity',
);
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+canonicalSourceBreakup\s*=\s*clamp\(/,
  'Canonical source birth must retain bounded nonperiodic irregularity',
);

console.log('volume source-birth periodicity: common, Tall, and Canonical source waves are replaced by transported/static breakup');
