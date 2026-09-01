import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const coreUrl = new URL('../volume-core.js', import.meta.url);
const core = await readFile(coreUrl, 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertNoExplicitPeriodicity(source, label) {
  assert.doesNotMatch(source, /Math\.(?:sin|cos|tan)\s*\(/, `${label} must not author explicit trigonometric motion`);
  assert.doesNotMatch(source, /(?:^|[^\w])(?:sin|cos|tan)\s*\(/, `${label} must not hide explicit trigonometric motion behind an unqualified call`);
}

function reachableJavascriptFunctions(source, rootNames) {
  const declarations = new Map();
  for (const match of source.matchAll(/\b(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\(/g)) {
    declarations.set(
      match[1],
      balancedWgslBlock(source.slice(match.index), match[0], { label: `JavaScript helper ${match[1]}` }),
    );
  }
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s+)?function\b[^\{]*\{/g,
  )) {
    declarations.set(
      match[1],
      balancedWgslBlock(source.slice(match.index), match[0], { label: `JavaScript function-expression helper ${match[1]}` }),
    );
  }
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/g,
  )) {
    const tail = source.slice(match.index);
    const bodyStart = match[0].length;
    const nextTokenIndex = tail.slice(bodyStart).search(/\S/);
    assert.ok(nextTokenIndex >= 0, `JavaScript arrow helper ${match[1]} must have a body`);
    const bodyIndex = bodyStart + nextTokenIndex;
    if (tail[bodyIndex] === '{') {
      declarations.set(
        match[1],
        balancedWgslBlock(tail, match[0], { label: `JavaScript arrow helper ${match[1]}` }),
      );
    } else {
      const statementEnd = tail.indexOf(';', bodyIndex);
      assert.ok(statementEnd > bodyIndex, `JavaScript arrow helper ${match[1]} expression must terminate`);
      declarations.set(match[1], tail.slice(0, statementEnd + 1));
    }
  }

  const pending = [...rootNames];
  const visited = new Set();
  const blocks = [];
  while (pending.length > 0) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    const block = declarations.get(name);
    assert.ok(block, `missing reachable JavaScript helper ${name}`);
    visited.add(name);
    blocks.push(block);
    for (const call of block.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const callee = call[1];
      const preceding = block[call.index - 1] || '';
      if (callee !== name && preceding !== '.' && declarations.has(callee)) pending.push(callee);
    }
  }
  return { names: [...visited].sort(), source: blocks.join('\n') };
}

function assertDiagnosticPeriodicityRetired(source) {
  const instanceLayout = reachableJavascriptFunctions(source, ['boundarySplatInstanceLayout']);
  const syntheticTrail = reachableJavascriptFunctions(source, ['syntheticHandTrailEmitters']);
  for (const expectedHelper of [
    'externalEmitterNowMs',
    'syntheticHandTrailEmitters',
    'syntheticTrailSignal',
    'syntheticTrailSignedUnit',
    'syntheticTrailSmoothUnit',
  ]) {
    assert.ok(
      syntheticTrail.names.includes(expectedHelper),
      `the synthetic trail dependency boundary must recursively inspect ${expectedHelper}`,
    );
  }
  assertNoExplicitPeriodicity(instanceLayout.source, 'multi-splat diagnostic layout and reachable helpers');
  assertNoExplicitPeriodicity(syntheticTrail.source, 'synthetic hand-trail diagnostic generator and reachable helpers');
  assert.doesNotMatch(instanceLayout.source, /(?:nowMs|Date|performance|externalEmitterNowMs)/, 'static multi-splat placement must remain clock-free');
  assert.match(source, /deterministic-nonperiodic-hand-trail-v0/, 'synthetic trail declares its nonperiodic diagnostic motion identity');
  assert.match(
    syntheticTrail.source,
    /const step = Math\.floor\(keyframe\);/,
    'synthetic trail keyframe identity must advance without a short-cycle reducer',
  );
  assert.match(
    syntheticTrail.source,
    /syntheticTrailSignedUnit\(step,\s*emitterIndex,\s*channel\)[\s\S]*syntheticTrailSignedUnit\(step \+ 1,\s*emitterIndex,\s*channel\)/,
    'synthetic trail interpolation must use adjacent unbounded keyframe identities',
  );
}

assertDiagnosticPeriodicityRetired(core);

const helperOutsidePriorWindow = core
  .replace(
    'function externalEmitterNowMs()',
    'function restoredPeriodicTrailHelper(value) { return Math.sin(value); }\n\nfunction externalEmitterNowMs()',
  )
  .replace(
    'const blend = syntheticTrailSmoothUnit(keyframe - step);',
    'const blend = syntheticTrailSmoothUnit(keyframe - step) + restoredPeriodicTrailHelper(keyframe) * 0.01;',
  );
assert.throws(
  () => assertDiagnosticPeriodicityRetired(helperOutsidePriorWindow),
  /must not author explicit trigonometric motion/,
  'the diagnostic barrier rejects trigonometry in a reachable helper outside the old local source window',
);

const arrowHelperOutsidePriorWindow = core
  .replace(
    'function externalEmitterNowMs()',
    'const restoredPeriodicTrailHelper = value => Math.sin(value);\n\nfunction externalEmitterNowMs()',
  )
  .replace(
    'const blend = syntheticTrailSmoothUnit(keyframe - step);',
    'const blend = syntheticTrailSmoothUnit(keyframe - step) + restoredPeriodicTrailHelper(keyframe) * 0.01;',
  );
assert.throws(
  () => assertDiagnosticPeriodicityRetired(arrowHelperOutsidePriorWindow),
  /must not author explicit trigonometric motion/,
  'the diagnostic barrier rejects trigonometry in a reachable arrow-function helper',
);

const functionExpressionHelperOutsidePriorWindow = core
  .replace(
    'function externalEmitterNowMs()',
    'const restoredPeriodicTrailHelper = function(value) { return Math.sin(value); };\n\nfunction externalEmitterNowMs()',
  )
  .replace(
    'const blend = syntheticTrailSmoothUnit(keyframe - step);',
    'const blend = syntheticTrailSmoothUnit(keyframe - step) + restoredPeriodicTrailHelper(keyframe) * 0.01;',
  );
assert.throws(
  () => assertDiagnosticPeriodicityRetired(functionExpressionHelperOutsidePriorWindow),
  /must not author explicit trigonometric motion/,
  'the diagnostic barrier rejects trigonometry in a reachable function-expression helper',
);

const shortCycleTrail = core.replace(
  'const step = Math.floor(keyframe);',
  'const step = Math.floor(keyframe) & 7;',
);
assert.throws(
  () => assertDiagnosticPeriodicityRetired(shortCycleTrail),
  /keyframe identity must advance without a short-cycle reducer/,
  'the diagnostic barrier rejects short bitmasked keyframe loops as well as trigonometric loops',
);

const {
  SYNTHETIC_HAND_TRAIL_MOTION_IDENTITY,
  boundarySplatInstanceLayout,
  syntheticHandTrailEmitters,
} = await import(coreUrl);

assert.equal(SYNTHETIC_HAND_TRAIL_MOTION_IDENTITY, 'deterministic-nonperiodic-hand-trail-v0');
assert.deepEqual(boundarySplatInstanceLayout(1), [[0, 0, 0, 1]]);
assert.deepEqual(boundarySplatInstanceLayout(9), boundarySplatInstanceLayout(9), 'static diagnostic placement is deterministic');

const first = syntheticHandTrailEmitters(12_345);
const repeated = syntheticHandTrailEmitters(12_345);
const advanced = syntheticHandTrailEmitters(12_445);
assert.deepEqual(first, repeated, 'a named timestamp produces repeatable synthetic diagnostic emitters');
assert.equal(first.length, 5);
assert.notDeepEqual(first, advanced, 'the opt-in moving-source diagnostic still exercises external emitter updates');
for (const emitter of first) {
  assert.equal(emitter.active, true);
  assert.equal(emitter.motionIdentity, SYNTHETIC_HAND_TRAIL_MOTION_IDENTITY);
  for (const point of [emitter.start, emitter.end]) {
    assert.equal(point.length, 3);
    assert.ok(point.every(Number.isFinite));
    assert.ok(point[0] >= -0.45 && point[0] <= 0.45, 'synthetic trail x stays inside its narrow diagnostic band');
    assert.ok(point[1] >= -0.95 && point[1] <= -0.20, 'synthetic trail y stays near the source region');
    assert.ok(point[2] >= -0.15 && point[2] <= 0.15, 'synthetic trail z stays inside its narrow diagnostic band');
  }
}

console.log('volume diagnostic periodicity contracts passed');
