import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertEntrainmentSwayBoundary(source, page) {
  const canonicalRegion = sourceBetween(source, '  let canonicalLiftGate =', '  let bonfireLiftImpulse =');
  assert.doesNotMatch(canonicalRegion, /\b(?:sin|cos|tan)\s*\(/, 'Canonical entrainment must not use a periodic cell');
  assert.doesNotMatch(canonicalRegion, /\b(?:time|canonicalPhaseTime)\b/, 'Canonical entrainment must not retain a hidden clock');
  assert.doesNotMatch(canonicalRegion, /canonicalEntrainmentCell/, 'the named analytic entrainment cell must be retired');
  assert.match(
    canonicalRegion,
    /var canonicalEntrainmentVelocity = vec3<f32>\(0\.0\);[\s\S]*if \(canonicalPlumeScene > 0\.5 && canonicalEntrainmentBand > 0\.0005\) \{[\s\S]*let canonicalTransportDelta = prev\.xyz - advected\.xyz;/,
    'Canonical entrainment must derive from transported flow only inside its scene gate',
  );
  const canonicalGate = canonicalRegion.indexOf('if (canonicalPlumeScene > 0.5 && canonicalEntrainmentBand > 0.0005) {');
  assert.doesNotMatch(canonicalRegion.slice(0, canonicalGate), /canonicalTransportDelta/, 'Canonical transported-state work must not run before its scene gate');

  const swayRegion = sourceBetween(source, '  let columnLiftImpulse =', '  let bonfireNonWindLateralDampingTarget =');
  assert.doesNotMatch(swayRegion, /\b(?:sin|cos|tan)\s*\(/, 'optional lateral excitation must not preserve phased oscillation');
  assert.match(
    swayRegion,
    /if \(transportedLateralExcitationEnabled > 0\.5\) \{[\s\S]*let transportedLateralDelta = prev\.xz - advected\.xz;/,
    'optional lateral excitation must amplify transported variation only after its operator gate',
  );
  assert.doesNotMatch(swayRegion.slice(0, swayRegion.indexOf('if (transportedLateralExcitationEnabled > 0.5) {')), /transportedLateralDelta/, 'lateral excitation work must not run before its operator gate');

  assert.match(page, /<span class="slider-label">Transported lateral excitation<\/span>[\s\S]{0,160}id="volume-phased-sway"/, 'the legacy persisted control id must present its field-derived semantics honestly');
  assert.doesNotMatch(page, /<span class="slider-label">Phased sway<\/span>/, 'the cockpit must not describe retired phase authority as active');
  assert.match(source, /const MAIN_FLUID_PERIODIC_ENTRAINMENT_SWAY_STRATEGY_RETIRED = 'retired-periodic-entrainment-sway-v0';/, 'the structural ledger must name periodic entrainment/sway retirement');
  assert.match(source, /const periodicEntrainmentSwayEvaluationsPerCell = 0;/, 'the cost ledger must report zero periodic entrainment/sway evaluations');
}

assertEntrainmentSwayBoundary(core, index);

const falseClosureMutations = [
  [
    'restored Canonical periodic cell',
    (source, page) => [
      source.replace(
        'var canonicalEntrainmentVelocity = vec3<f32>(0.0);',
        'let canonicalEntrainmentCell = vec3<f32>(sin(p.y), cos(p.x), sin(p.z));\n  var canonicalEntrainmentVelocity = canonicalEntrainmentCell;',
      ),
      page,
    ],
  ],
  [
    'Canonical transport work moved before scene gate',
    (source, page) => [
      source.replace(
        'var canonicalEntrainmentVelocity = vec3<f32>(0.0);\n  if (canonicalPlumeScene > 0.5 && canonicalEntrainmentBand > 0.0005) {\n    let canonicalTransportDelta = prev.xyz - advected.xyz;',
        'let canonicalTransportDelta = prev.xyz - advected.xyz;\n  var canonicalEntrainmentVelocity = vec3<f32>(0.0);\n  if (canonicalPlumeScene > 0.5 && canonicalEntrainmentBand > 0.0005) {',
      ),
      page,
    ],
  ],
  [
    'restored phased sway',
    (source, page) => [
      source.replace(
        'if (transportedLateralExcitationEnabled > 0.5) {',
        'let restoredSway = vec2<f32>(sin(time), cos(time));\n  if (transportedLateralExcitationEnabled > 0.5) {',
      ),
      page,
    ],
  ],
  [
    'restored periodic work count',
    (source, page) => [
      source.replace('const periodicEntrainmentSwayEvaluationsPerCell = 0;', 'const periodicEntrainmentSwayEvaluationsPerCell = 5;'),
      page,
    ],
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate] of falseClosureMutations) {
  const [mutatedCore, mutatedIndex] = mutate(core, index);
  assert.ok(mutatedCore !== core || mutatedIndex !== index, `${name} mutation must alter the reviewed source`);
  try {
    assertEntrainmentSwayBoundary(mutatedCore, mutatedIndex);
    acceptedFalseClosures.push(name);
  } catch {
    // Each restored phase or pre-gate computation must fail the complete boundary.
  }
}
assert.deepEqual(acceptedFalseClosures, [], 'the entrainment/sway boundary must reject every false-closure mutation');

console.log('volume entrainment and lateral excitation: periodic cells retired and optional work gated before evaluation');
