import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTimeFreeWgslCallGraph } from './helpers/wgsl-time-free-callgraph.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function assertSourceBoundary(source) {
  // The Bonfire law is retired, not an alternative source behind a hidden flag.
  for (const name of [
    'bonfireTransportedCombustionField', 'bonfireTransportedSourceBreakup',
    'bonfireSymmetricCombustionPairOffset', 'bonfirePairStrength',
    'bonfireCombustionPacketField', 'bonfireSymmetricEdgeBreakup',
    'bonfireAzimuthalBreakup', 'bonfireMirrorBalancedBreakup',
    'bonfireSourceY', 'bonfireScene',
  ]) {
    assert.ok(!source.includes(name), name + ' must remain retired');
  }
  assertTimeFreeWgslCallGraph(source, ['materialInterfaceGradient'], {
    label: 'Flame material-interface call graph',
  });
  const start = source.indexOf('  let flameAboveSource = smoothstep(-0.72, 0.34, p.y);');
  const end = source.indexOf('  let flameReactionContour = clamp(', start);
  assert.ok(start >= 0 && end > start, 'the active Flame contour must exist');
  const contour = source.slice(start, end);
  assert.doesNotMatch(contour, /\b(?:sin|cos)\s*\(/, 'contour birth must not contain periodic waves');
  assert.doesNotMatch(contour, /\btime\b/, 'contour birth must not advance from simulation time');
  assert.match(contour, /transportedSourceStructure/, 'breakup uses transported source structure');
  assert.match(contour, /sourceStartupDephase/, 'startup dephasing remains behind its authority decay');
  assert.doesNotMatch(contour, /\bsourceSpatialDephaseB?\b/, 'raw static dephasing cannot bypass that decay');
}

assertSourceBoundary(core);
for (const [name, mutate] of [
  ['restored Bonfire source', s => s + '\nfn bonfireTransportedCombustionField() {}\n'],
  ['direct contour clock', s => s.replace('smoothstep(-0.72, 0.34, p.y);', 'smoothstep(-0.72, 0.34, p.y);\n  let periodicBirth = sin(time);')],
  ['raw static contour dephasing', s => s.replace('smoothstep(-0.72, 0.34, p.y);', 'smoothstep(-0.72, 0.34, p.y);\n  let hiddenBirth = sourceSpatialDephase;')],
  ['material clock', s => s.replace('  let sx0 = readSlot(', '  let hiddenClock = sin(u.cameraPos_time.w);\n  let sx0 = readSlot(')],
]) {
  const mutated = mutate(core);
  assert.notEqual(mutated, core, name + ' mutation must alter source');
  assert.throws(() => assertSourceBoundary(mutated), undefined, name + ' must fail the boundary');
}
console.log('volume source retirement: Bonfire source law absent; Flame contour and material interface remain time-free');
