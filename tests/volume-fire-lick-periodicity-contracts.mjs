import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTimeFreeWgslCallGraph } from './helpers/wgsl-time-free-callgraph.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function wgslFunctionBody(source, name) {
  const start = source.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `missing WGSL function ${name}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing WGSL body for ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated WGSL body for ${name}`);
}

function wgslFunctionSignature(source, name) {
  const start = source.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `missing WGSL function ${name}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing WGSL body for ${name}`);
  return source.slice(start, open);
}

function braceBodyAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing block marker: ${marker}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing block body: ${marker}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated block: ${marker}`);
}

const allowedFireLickCallees = new Set([
  'clamp',
  'cross',
  'curlAtCell',
  'fireLickAshCarry',
  'length',
  'materialInterfaceGradient',
  'max',
  'normalize',
  'readFrontField',
  'readSlot',
  'smoothstep',
  'vec3',
  'vec4',
]);

function assertFireLickPeriodicityBoundary(source) {
  assertTimeFreeWgslCallGraph(
    source,
    ['fireLickBreakup', 'bonfireFireLickBreakup'],
    {
      label: 'Fire Lick transported-breakup call graph',
      forbiddenCallees: ['hash31'],
    },
  );
  for (const name of ['fireLickBreakup', 'bonfireFireLickBreakup']) {
    const signature = wgslFunctionSignature(source, name);
    const body = wgslFunctionBody(source, name);
    assert.doesNotMatch(
      signature,
      /\btime\b/,
      `${name} must not retain an unused time channel that can silently restore animated breakup`,
    );
    assert.doesNotMatch(
      signature,
      /\bp\s*:\s*vec3/,
      `${name} must not retain source coordinates solely as authority for authored breakup texture`,
    );
    assert.doesNotMatch(
      body,
      /\btime\b/,
      `${name} must derive no breakup term from simulation time`,
    );
    assert.doesNotMatch(
      body,
      /\b(?:sin|cos)\s*\(/,
      `${name} must not stamp an animated periodic comb into the transported fire-lick field`,
    );
    assert.doesNotMatch(
      body,
      /\bturbulentDetailForce\s*\(/,
      `${name} must not reintroduce periodicity indirectly through the analytic detail-force field`,
    );
    const callees = [...body.matchAll(/\b([A-Za-z_]\w*)\s*(?:<[^>{};\n]+>)?\s*\(/g)]
      .map(match => match[1]);
    const unknownCallees = [...new Set(callees.filter(callee => !allowedFireLickCallees.has(callee)))].sort();
    assert.deepEqual(
      unknownCallees,
      [],
      `${name} must not reach time-bearing or periodic behavior through an unreviewed helper`,
    );
    assert.match(body, /readSlot\(c, 2u\)/, `${name} derives breakup from transported fire state`);
    assert.match(body, /readSlot\(c, 3u\)/, `${name} derives breakup from transported microdetail state`);
    assert.match(body, /readFrontField\(c\)/, `${name} derives breakup from the transported combustion front`);
    assert.match(body, /curlAtCell\(c\)/, `${name} derives breakup from live flow structure`);
    assert.doesNotMatch(
      body,
      /\bhash31\s*\(/,
      `${name} must not stamp permanent static hash texture into the transported Fire Lick field`,
    );
  }

  const guardedBreakup = braceBodyAfter(source, '  if (fireLickBreakupEnabled) {');
  const expectedGuardedCalls = [
    'columnLickBirth = fireLickBreakup(cellI, fireLickOperatorGain, heat, fuel, flame, flameDetail, tallPlumeFireLickSource);',
    'bonfireLickBirth = bonfireFireLickBreakup(cellI, fireLickOperatorGain, heat, fuel, flame, flameDetail, source);',
  ];
  assert.deepEqual(
    guardedBreakup.trim().split('\n').map(line => line.trim()).filter(Boolean),
    expectedGuardedCalls,
    'the Fire Licks enable guard owns exactly one evaluation of each breakup operator',
  );
  for (const name of ['fireLickBreakup', 'bonfireFireLickBreakup']) {
    assert.equal(
      [...source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].length,
      2,
      `${name} must occur exactly once as a definition and once inside the enable guard`,
    );
  }
  assert.match(
    source,
    /const fireLickBreakupEvaluationsPerCell = fireLickBreakupEnabled \? 2 : 0;/,
    'the cost ledger still records zero periodic-breakup work when Fire Licks are disabled',
  );
  assert.match(
    source,
    /const FIRE_LICK_BREAKUP_BYPASS_THRESHOLD = 0\.0005;/,
    'Fire Lick owns one explicit authoritative bypass threshold',
  );
  assert.match(
    source,
    /let fireLickBreakupEnabled = fireLickOperatorGain > \$\{FIRE_LICK_BREAKUP_BYPASS_THRESHOLD\};/,
    'the WGSL execution predicate is generated from the authoritative Fire Lick threshold',
  );
  assert.match(
    source,
    /const fireLickBreakupEnabled = fireLickOperatorGain > FIRE_LICK_BREAKUP_BYPASS_THRESHOLD;/,
    'the JavaScript cost predicate uses the same authoritative Fire Lick threshold',
  );
}

assertFireLickPeriodicityBoundary(core);

const falseClosureMutations = [
  [
    'animated non-floor time hash',
    source => source.replace(
      '  let breakupGain = clamp(0.54 + transportedStructure',
      `  let animatedCellJitter = fract(time * 0.73);\n  let breakupGain = clamp(0.54 + animatedCellJitter * 0.01 + transportedStructure`,
    ),
  ],
  [
    'indirect periodic helper',
    source => source.replace(
      '  let breakupGain = clamp(0.54 + transportedStructure',
      `  let indirectPeriodicGain = bonfirePairStrength(0.0, time);\n  let breakupGain = clamp(indirectPeriodicGain * 0.01 + 0.54 + transportedStructure`,
    ),
  ],
  [
    'time-phased admitted ash helper',
    source => source.replace(
      '  return shred * (baseAsh + lick * lickAsh);',
      '  return shred * (baseAsh + lick * lickAsh) + sin(u.cameraPos_time.w * 0.61) * 0.01;',
    ),
  ],
  [
    'unguarded extra breakup evaluation',
    source => source.replace(
      '  if (fireLickBreakupEnabled) {',
      `  columnLickBirth = fireLickBreakup(cellI, fireLickOperatorGain, heat, fuel, flame, flameDetail, tallPlumeFireLickSource);\n  if (fireLickBreakupEnabled) {`,
    ),
  ],
  [
    'restored permanent cell hash',
    source => source.replace(
      '  let breakupGain = clamp(0.54 + transportedStructure',
      `  let permanentCellTexture = hash31(vec3<f32>(f32(c.x), f32(c.y), f32(c.z))) - 0.5;\n  let breakupGain = clamp(0.54 + permanentCellTexture * 0.10 + transportedStructure`,
    ),
  ],
  [
    'helper-hidden permanent hash',
    source => source.replace(
      '  return shred * (baseAsh + lick * lickAsh);',
      '  return shred * (baseAsh + lick * lickAsh) + hash31(vec3<f32>(f32(c.x), f32(c.y), f32(c.z))) * 0.01;',
    ),
  ],
  [
    'shader threshold above ledger threshold',
    source => source.replace(
      'let fireLickBreakupEnabled = fireLickOperatorGain > ${FIRE_LICK_BREAKUP_BYPASS_THRESHOLD};',
      'let fireLickBreakupEnabled = fireLickOperatorGain > 0.10;',
    ),
  ],
  [
    'shader threshold below ledger threshold',
    source => source.replace(
      'let fireLickBreakupEnabled = fireLickOperatorGain > ${FIRE_LICK_BREAKUP_BYPASS_THRESHOLD};',
      'let fireLickBreakupEnabled = fireLickOperatorGain > 0.0;',
    ),
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate] of falseClosureMutations) {
  try {
    assertFireLickPeriodicityBoundary(mutate(core));
    acceptedFalseClosures.push(name);
  } catch {
    // A semantic boundary must reject the mutation.
  }
}
assert.deepEqual(
  acceptedFalseClosures,
  [],
  'the Fire Lick periodicity and cost boundary must reject every false-closure mutation',
);

console.log('volume fire-lick periodicity: transported-field breakup owns the effect without periodic or permanent-hash texture, and zero remains a hard bypass');
