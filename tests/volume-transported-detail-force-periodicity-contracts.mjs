import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTimeFreeWgslCallGraph } from './helpers/wgsl-time-free-callgraph.mjs';
import { assertWgslCallsOwnedByBlock } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertTransportedDetailForceBoundary(source) {
  assert.doesNotMatch(source, /\bturbulentDetailForce\b/, 'the shared trigonometric detail-force basis must be absent');
  assertTimeFreeWgslCallGraph(
    source,
    [
      'transportedDetailDirection',
      'interfaceShreddingForce',
      'fieldDerivedFineScaleBreakup',
      'oracleActivityCurlForce',
    ],
    { label: 'transported detail-force replacement graph' },
  );

  const microAdvection = sourceBetween(source, 'fn transportedMicrodetailAdvection(', 'fn interfaceShreddingForce(');
  assert.doesNotMatch(microAdvection, /\b(?:sin|cos|tan)\s*\(/, 'microdetail transport must not use periodic slip');
  assert.doesNotMatch(microAdvection, /\b(?:slip|time|cameraPos_time)\b/, 'microdetail transport must not retain independent slip or a hidden clock');
  assert.match(microAdvection, /let backCell = cell - \(velocity \+ lift\) \* \(1\.44 \+ speed \* 0\.28\);/, 'microdetail follows the transported velocity and existing thermal lift');
  assert.doesNotMatch(source, /fn transportedScalarSlip\(/, 'the field-derived scalar/velocity disagreement operator is retired');

  const detailHelpers = sourceBetween(source, 'fn interfaceShreddingForce(', 'fn smokeShredEnergy(');
  assert.doesNotMatch(detailHelpers, /\b(?:sin|cos|tan)\s*\(/, 'interface and fine-detail forces must derive from transported fields rather than periodic bases');
  assert.doesNotMatch(detailHelpers, /\btime\b/, 'interface and fine-detail helpers must not retain a hidden clock');
  assert.match(source, /fn transportedDetailDirection\(/, 'shared detail direction must name transported-field authority');
  assert.doesNotMatch(sourceBetween(source, 'fn transportedDetailDirection(', 'fn materialInterfaceGradient('), /\b(?:sin|cos|tan|time|cameraPos_time)\b/, 'transported detail direction must remain nonperiodic and time-free');

  const mainDetailRegion = sourceBetween(source, '  let rawDetailCarrier =', '  let projectionCorrection = vec3<f32>(0.0);');
  assert.doesNotMatch(mainDetailRegion, /\b(?:sin|cos|tan)\s*\(/, 'the live detail-force application must not restore periodic motion inline');
  assert.match(mainDetailRegion, /var detailForce = vec3<f32>\(0\.0\);[\s\S]*if \(proceduralDetailForces > 0\.5\) \{/, 'detail forces must initialize inert and enter one pre-evaluation operator gate');
  for (const call of ['transportedDetailDirection', 'interfaceShreddingForce', 'fieldDerivedFineScaleBreakup']) {
    const gate = mainDetailRegion.indexOf('if (proceduralDetailForces > 0.5) {');
    const callIndex = mainDetailRegion.indexOf(`${call}(`);
    assert.ok(callIndex > gate, `${call} must be evaluated only after the procedural-detail gate`);
  }
  assertWgslCallsOwnedByBlock(
    source,
    'if (proceduralDetailForces > 0.5) {',
    {
      transportedDetailDirection: 2,
      interfaceShreddingForce: 1,
      fieldDerivedFineScaleBreakup: 1,
    },
    { label: 'procedural detail-force guard' },
  );

  const oracleRegion = sourceBetween(source, '  let oracleActivityCue =', '  let confinement =');
  assert.match(oracleRegion, /if \(oracleActivityCue > 0\.0005 && oracleActivityCurlGain > 0\.0005\) \{[\s\S]*oracleActivityCurlForce\(/, 'the default-zero Oracle curl receiver must not evaluate its force while inactive');
  assert.doesNotMatch(oracleRegion, /oracleActivityCurlNoiseForce/, 'Oracle must not retain the retired trigonometric curl-noise helper');
  assertWgslCallsOwnedByBlock(
    source,
    'if (oracleActivityCue > 0.0005 && oracleActivityCurlGain > 0.0005) {',
    { oracleActivityCurlForce: 1 },
    { label: 'Oracle activity-curl guard' },
  );

  assert.match(source, /const MAIN_FLUID_PERIODIC_DETAIL_FORCE_STRATEGY_RETIRED = 'retired-periodic-detail-force-basis-v0';/, 'the structural ledger must name periodic detail-force retirement');
  assert.match(source, /const periodicDetailForceEvaluationsPerCell = 0;/, 'the cost ledger must report zero periodic detail-force evaluations per cell');
}

assertTransportedDetailForceBoundary(core);

const falseClosureMutations = [
  [
    'helper-hidden periodic direction',
    source => source.replace(
      'fn transportedDetailDirection(material: vec4<f32>, fireLayer: vec4<f32>, microLayer: vec4<f32>, frontTopology: f32, velocity: vec3<f32>) -> vec3<f32> {',
      `fn hiddenPeriodicDetailDirection() -> vec3<f32> {
  let hiddenPhase = u.cameraPos_time.w;
  return vec3<f32>(sin(hiddenPhase), cos(hiddenPhase), 0.0);
}

fn transportedDetailDirection(material: vec4<f32>, fireLayer: vec4<f32>, microLayer: vec4<f32>, frontTopology: f32, velocity: vec3<f32>) -> vec3<f32> {
  let hiddenPeriodicDirection = hiddenPeriodicDetailDirection();`,
    ).replace(
      '  let direction = velocity * (0.58 + carrier * 0.18)',
      '  let direction = hiddenPeriodicDirection * 0.01 + velocity * (0.58 + carrier * 0.18)',
    ),
    /helper hiddenPeriodicDetailDirection must not (?:read temporal|introduce explicit periodic)/,
  ],
  [
    'extra detail helper evaluation after gate',
    source => source.replace(
      '  }\n  let heatExpansion = thermalExpansionForce(cellI, heat, 0.048 + curl * 0.019);',
      '  }\n  detailForce = detailForce + transportedDetailDirection(material, fireLayer, microLayer, combustionFrontTopology, prev.xyz) * 0.001;\n  let heatExpansion = thermalExpansionForce(cellI, heat, 0.048 + curl * 0.019);',
    ),
    /procedural detail-force guard must own every live transportedDetailDirection call/,
  ],
  [
    'extra Oracle curl evaluation after gate',
    source => source.replace(
      '  }\n  let confinement = vorticityConfinement(cellI, 0.034 + curl * 0.044);',
      '  }\n  oracleActivityCurl = oracleActivityCurl + oracleActivityCurlForce(cellI, oracleActivityCue, oracleActivityCurlGain);\n  let confinement = vorticityConfinement(cellI, 0.034 + curl * 0.044);',
    ),
    /Oracle activity-curl guard must own every live oracleActivityCurlForce call/,
  ],
  [
    'restored shared trig helper',
    source => source.replace(
      'fn transportedDetailDirection(',
      'fn turbulentDetailForce(p: vec3<f32>) -> vec3<f32> { return vec3<f32>(sin(p.x), cos(p.y), sin(p.z)); }\n\nfn transportedDetailDirection(',
    ),
    /shared trigonometric detail-force basis must be absent/,
  ],
  [
    'restored hidden scalar slip',
    source => source.replace(
      'fn transportedMicrodetailAdvection(',
      'fn transportedScalarSlip() -> vec3<f32> { return vec3<f32>(0.1); }\n\nfn transportedMicrodetailAdvection(',
    ),
    /scalar\/velocity disagreement operator is retired/,
  ],
  [
    'restored periodic work count',
    source => source.replace(
      'const periodicDetailForceEvaluationsPerCell = 0;',
      'const periodicDetailForceEvaluationsPerCell = 72;',
    ),
    /cost ledger must report zero periodic detail-force evaluations per cell/,
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate, expectedFailure] of falseClosureMutations) {
  const mutated = mutate(core);
  assert.notEqual(mutated, core, `${name} mutation must alter the reviewed source`);
  try {
    assertTransportedDetailForceBoundary(mutated);
    acceptedFalseClosures.push(name);
  } catch (error) {
    assert.match(error.message, expectedFailure, `${name} must fail on its intended boundary`);
  }
}
assert.deepEqual(acceptedFalseClosures, [], 'the transported-detail boundary must reject every false-closure mutation');

console.log('volume transported detail forces: periodic shared basis retired and disabled work gated before evaluation');
