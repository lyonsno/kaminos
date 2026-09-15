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

function assertSourceBirthAuthorityBoundary(source) {
const commonTallCanonicalSourceBirth = sourceBetween(
  source,
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
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+sourceStartupAuthority\s*=\s*1\.0\s*-\s*smoothstep\([^;]*transportedSourceStructure[^;]*\);/,
  'static source dephasing must explicitly relinquish authority as transported structure develops',
);
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+sourceStartupDephase\s*=\s*sourceSpatialDephase\s*\*\s*sourceStartupAuthority\s*\*\s*fixedSourceDephase;/,
  'the first static dephasing channel must pass through transported-state startup authority and its explicit ablation gate',
);
assert.match(
  commonTallCanonicalSourceBirth,
  /let\s+sourceStartupDephaseB\s*=\s*sourceSpatialDephaseB\s*\*\s*sourceStartupAuthority\s*\*\s*fixedSourceDephase;/,
  'the second static dephasing channel must pass through transported-state startup authority and its explicit ablation gate',
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
const sourceBirthConsumers = commonTallCanonicalSourceBirth.slice(
  commonTallCanonicalSourceBirth.indexOf('  let breakup = clamp('),
);
assert.doesNotMatch(
  sourceBirthConsumers,
  /\bsourceSpatialDephaseB?\b/,
  'common, Tall Plume, and Canonical source birth must not consume raw static dephasing after the startup-authority transfer',
);
assert.match(
  sourceBirthConsumers,
  /\bsourceStartupDephase\b/,
  'source birth must consume the authority-decayed first startup channel',
);
assert.match(
  sourceBirthConsumers,
  /\bsourceStartupDephaseB\b/,
  'source birth must consume the authority-decayed second startup channel',
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
}

assertSourceBirthAuthorityBoundary(core);

const ungatedStaticMutation = core.replace(
  '      + sourceStartupDephase * 0.08',
  '      + sourceSpatialDephase * 0.08',
);
assert.notEqual(ungatedStaticMutation, core, 'the ungated static-dephasing false-closure mutation must alter reviewed source');
assert.throws(
  () => assertSourceBirthAuthorityBoundary(ungatedStaticMutation),
  /must not consume raw static dephasing/,
  'the source-birth authority barrier must reject one restored ungated static term',
);

console.log('volume source-birth periodicity: common, Tall, and Canonical source waves are replaced by transported/static breakup');
