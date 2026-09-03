import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTimeFreeWgslCallGraph } from './helpers/wgsl-time-free-callgraph.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function wgslFunction(source, name) {
  const start = source.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `missing WGSL function ${name}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing WGSL body for ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          signature: source.slice(start, open),
          body: source.slice(open + 1, index),
        };
      }
    }
  }
  throw new Error(`unterminated WGSL body for ${name}`);
}

function replaceInsideWgslFunction(source, name, anchor, replacement) {
  const functionStart = source.indexOf(`fn ${name}(`);
  assert.notEqual(functionStart, -1, `missing WGSL function ${name} for mutation`);
  const replacementIndex = source.indexOf(anchor, functionStart);
  assert.notEqual(replacementIndex, -1, `missing ${name} mutation anchor: ${anchor}`);
  return source.slice(0, replacementIndex)
    + replacement
    + source.slice(replacementIndex + anchor.length);
}

function assertBonfireSourcePeriodicityBoundary(source) {
  assertTimeFreeWgslCallGraph(
    source,
    [
      'bonfireTransportedCombustionField',
      'bonfireTransportedSourceBreakup',
      'materialInterfaceGradient',
    ],
    { label: 'Bonfire transported source call graph' },
  );
  assertTimeFreeWgslCallGraph(
    source,
    ['bonfireTransportedCombustionField', 'bonfireTransportedSourceBreakup'],
    {
      label: 'Bonfire zero-neighborhood-read source call graph',
      forbiddenCallees: [
        'readSlot',
        'readFrontField',
        'curlAtCell',
        'materialInterfaceGradient',
      ],
    },
  );
  for (const retiredName of [
    'bonfireSymmetricCombustionPairOffset',
    'bonfirePairStrength',
    'bonfirePairYOffset',
    'bonfirePairRadius',
    'bonfireCombustionPacketOffset',
    'bonfireCombustionPacketField',
    'bonfireCombustionCellField',
    'bonfireSymmetricEdgeBreakup',
    'bonfireAzimuthalBreakup',
    'bonfireMirrorBalancedBreakup',
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\b${retiredName}\\b`),
      `${retiredName} must not preserve fixed-lobe, packet-orbit, or animated source choreography`,
    );
  }

  const allowedCallees = new Set([
    'abs',
    'clamp',
    'exp',
    'f32',
    'floor',
    'hash31',
    'length',
    'max',
    'min',
    'mix',
    'pow',
    'smoothstep',
    'vec3',
    'vec4',
  ]);
  for (const name of ['bonfireTransportedCombustionField', 'bonfireTransportedSourceBreakup']) {
    const fn = wgslFunction(source, name);
    assert.doesNotMatch(fn.signature, /\b(?:time|detailFrequency)\b/, `${name} must not accept a source clock or Detail Scale`);
    assert.doesNotMatch(fn.body, /\b(?:time|detailFrequency)\b/, `${name} must not use a source clock or Detail Scale`);
    assert.doesNotMatch(fn.body, /\b(?:sin|cos)\s*\(/, `${name} must not stamp periodic waves into source birth`);
    const callees = [...fn.body.matchAll(/\b([A-Za-z_]\w*)\s*(?:<[^>{};\n]+>)?\s*\(/g)].map(match => match[1]);
    const unknownCallees = [...new Set(callees.filter(callee => !allowedCallees.has(callee)))].sort();
    assert.deepEqual(unknownCallees, [], `${name} must not reach unreviewed periodic behavior through an indirect helper`);
    assert.match(fn.signature, /fireState: vec4<f32>/, `${name} must accept transported fire state`);
    assert.match(fn.signature, /microState: vec4<f32>/, `${name} must accept transported microdetail state`);
    assert.match(fn.signature, /frontTopology: f32/, `${name} must accept transported combustion-front topology`);
    assert.match(fn.signature, /interfaceEnergy: f32/, `${name} must accept live interface structure`);
    assert.match(fn.signature, /flowEnergy: f32/, `${name} must accept live transported-flow structure`);
    assert.match(fn.body, /fireState\./, `${name} must use transported fire state`);
    assert.match(fn.body, /microState\./, `${name} must use transported microdetail state`);
    assert.match(fn.body, /frontTopology/, `${name} must use transported combustion-front topology`);
    assert.match(fn.body, /interfaceEnergy/, `${name} must use live interface structure`);
    assert.match(fn.body, /flowEnergy/, `${name} must use live transported-flow structure`);
  }

  const combustionField = wgslFunction(source, 'bonfireTransportedCombustionField');
  assert.match(combustionField.body, /exp\(/, 'Bonfire source support remains a continuous spatial field rather than a point/lobe population');
  assert.match(combustionField.body, /staticDephase/, 'Bonfire startup retains only a low-authority static dephasing term');

  const bonfireSourceBirth = sourceBetween(
    source,
    '  let bonfireSourceY = 0.62;',
    '  let canonicalMinimalFireBirth = canonicalFireContent',
  );
  assert.doesNotMatch(bonfireSourceBirth, /\b(?:sin|cos)\s*\(/, 'Bonfire source birth and ember birth must not contain periodic waves');
  assert.doesNotMatch(bonfireSourceBirth, /\btime\b/, 'Bonfire source birth and ember birth must not advance from simulation time');
  assert.doesNotMatch(bonfireSourceBirth, /\bscaledDetailFrequency\b/, 'Detail Scale must not synthesize Bonfire source topology');
  assert.doesNotMatch(bonfireSourceBirth, /\b(?:packet|Packet|pair|Pair)\b/, 'Bonfire source-law names must not preserve retired packet/pair semantics');
  assert.doesNotMatch(bonfireSourceBirth, /\b(?:2\.0943951|2\.3999632)\b/, 'Bonfire source birth must not retain fixed 120-degree or golden-angle populations');
  assert.match(bonfireSourceBirth, /var bonfireCombustion = vec4<f32>\(0\.0\);/, 'Bonfire combustion starts at the non-Bonfire neutral value');
  assert.match(bonfireSourceBirth, /var bonfireSourceStructure = vec4<f32>\(0\.0\);/, 'Bonfire source structure starts at the non-Bonfire neutral value');
  const guardedBonfireSource = sourceBetween(
    bonfireSourceBirth,
    '  if (bonfireScene > 0.5) {',
    '  let bonfireTongues = bonfireFlameTongues(',
  );
  assert.match(guardedBonfireSource, /length\(prev\.xyz - advected\.xyz\)/, 'the Bonfire-only guard derives live flow response from already-sampled transported velocity');
  assert.doesNotMatch(guardedBonfireSource, /\b(?:readSlot|readFrontField|curlAtCell)\s*\(/, 'Bonfire source topology must not add neighborhood reads inside its scene guard');
  assert.equal([...guardedBonfireSource.matchAll(/\bbonfireTransportedCombustionField\s*\(/g)].length, 1, 'the Bonfire scene guard owns exactly one combustion-field evaluation');
  assert.equal([...guardedBonfireSource.matchAll(/\bbonfireTransportedSourceBreakup\s*\(/g)].length, 1, 'the Bonfire scene guard owns exactly one source-breakup evaluation');
  assert.match(guardedBonfireSource, /fireLayer,[\s\S]*microLayer,[\s\S]*combustionFrontTopology,[\s\S]*interfaceEnergy,[\s\S]*bonfireSourceFlowEnergy/, 'both Bonfire source operators consume shared live transported state instead of rereading it internally');
  for (const name of ['bonfireTransportedCombustionField', 'bonfireTransportedSourceBreakup']) {
    assert.equal(
      [...source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].length,
      2,
      `${name} must occur exactly once as a definition and once as a guarded product call`,
    );
  }

  const tallPlumeContourBirth = sourceBetween(
    source,
    '  let tallPlumeAboveSource = smoothstep(-0.72, 0.34, p.y);',
    '  let tallPlumeReactionContour = clamp(',
  );
  assert.doesNotMatch(tallPlumeContourBirth, /\b(?:sin|cos)\s*\(/, 'Tall Plume reaction-contour birth must not contain periodic waves');
  assert.doesNotMatch(tallPlumeContourBirth, /\btime\b/, 'Tall Plume reaction-contour birth must not advance from simulation time');
  assert.match(tallPlumeContourBirth, /transportedSourceStructure/, 'Tall Plume reaction-contour breakup must use transported source structure');
  assert.match(tallPlumeContourBirth, /sourceStartupDephase/, 'Tall Plume reaction-contour startup may retain bounded static dephasing only through transported-state authority decay');
  assert.doesNotMatch(tallPlumeContourBirth, /\bsourceSpatialDephaseB?\b/, 'Tall Plume reaction-contour birth must not retain raw static dephasing after transported structure develops');

  assert.match(
    source,
    /const bonfireCombustionFieldEvaluationsPerCell = bonfireCombustionFieldActive \? 1 : 0;/,
    'the cost ledger records one-or-zero Bonfire combustion evaluations per cell',
  );
  assert.match(
    source,
    /const bonfireProceduralBreakupEvaluationsPerCell = bonfireCombustionFieldActive \? 1 : 0;/,
    'the cost ledger records one-or-zero Bonfire transported-breakup evaluations per cell',
  );
  assert.match(
    source,
    /const bonfireSourceTopologyExtraReadsPerCell = 0;/,
    'the cost ledger records that transported Bonfire source topology adds no neighborhood reads',
  );
}

assertBonfireSourcePeriodicityBoundary(core);

const falseClosureMutations = [
  [
    'direct source time wave',
    source => source.replace(
      '  let staticDephase =',
      '  let periodicBirth = sin(time * 0.73);\n  let staticDephase = periodicBirth * 0.01 +',
    ),
  ],
  [
    'indirect retired pair helper',
    source => source.replace(
      '  let staticDephase =',
      '  let hiddenPairPulse = bonfirePairStrength(0.0, time);\n  let staticDephase = hiddenPairPulse * 0.01 +',
    ),
  ],
  [
    'time-phased admitted hash helper',
    source => source.replace(
      '  return fract((r.x + r.y) * r.z);',
      '  return fract((r.x + r.y) * r.z + sin(u.cameraPos_time.w * 0.73) * 0.01);',
    ),
  ],
  [
    'unguarded extra combustion evaluation',
    source => source.replace(
      '  var bonfireCombustion = vec4<f32>(0.0);',
      '  var bonfireCombustion = bonfireTransportedCombustionField(cellI, p, bonfireSourceY, bonfireCoreRadius);',
    ),
  ],
  [
    'inflated combustion cost ledger',
    source => source.replace(
      'const bonfireCombustionFieldEvaluationsPerCell = bonfireCombustionFieldActive ? 1 : 0;',
      'const bonfireCombustionFieldEvaluationsPerCell = bonfireCombustionFieldActive ? 2 : 0;',
    ),
  ],
  [
    'helper-local hidden neighborhood read',
    source => replaceInsideWgslFunction(
      source,
      'bonfireTransportedCombustionField',
      '  let radial = length(p.xz);',
      '  let reviewerHiddenState = readSlot(vec3<i32>(0), 2u);\n  let radial = length(p.xz) + reviewerHiddenState.x * 0.0001;',
    ),
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate] of falseClosureMutations) {
  try {
    assertBonfireSourcePeriodicityBoundary(mutate(core));
    acceptedFalseClosures.push(name);
  } catch {
    // The source-law boundary must reject the mutation.
  }
}
assert.deepEqual(acceptedFalseClosures, [], 'the Bonfire source-periodicity boundary must reject every false-closure mutation');

console.log('volume bonfire source periodicity: continuous transported source birth replaces pair/packet clocks and animated breakup');
