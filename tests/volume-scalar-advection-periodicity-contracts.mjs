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

function assertOnlyAllowedCalls(region, allowedCalls, label) {
  const discovered = [...region.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]);
  const unexpected = [...new Set(discovered.filter(name => !allowedCalls.has(name)))];
  assert.deepEqual(unexpected, [], `${label} must not hide analytic slip behind helper calls: ${unexpected.join(', ')}`);
}

function assertScalarAdvectionPeriodicityBoundary(source) {
  const thermal = sourceBetween(source, 'fn thermalAdvection(', 'fn thermalBuoyancyForce(');
  const fire = sourceBetween(source, 'fn fireLayerAdvection(', 'fn gridLine(');

  for (const [name, region] of [['thermal material', thermal], ['fire layer', fire]]) {
    assert.doesNotMatch(region, /\b(?:sin|cos|tan)\s*\(/, `${name} advection must not add a periodic spatial slip`);
    assert.doesNotMatch(region, /\b(?:rawThermalSlip|thermalSlip|rawLick|lick|lateralSlipScale)\b/, `${name} advection must not preserve the retired slip through an alias`);
  }
  assertOnlyAllowedCalls(thermal, new Set(['thermalAdvection', 'vec3', 'clamp', 'sampleFluidSlot']), 'thermal material advection');
  assertOnlyAllowedCalls(fire, new Set(['fireLayerAdvection', 'vec3', 'clamp', 'sampleFluidSlot']), 'fire-layer advection');

  assert.match(
    thermal,
    /let backCell = cell - \(velocity \+ thermalLift\) \* \(2\.30 \+ speed \* 0\.46\);/,
    'thermal material must backtrace through transported velocity plus heat-derived lift only',
  );
  assert.match(
    fire,
    /let backCell = cell - \(velocity \+ fastLift\) \* \(1\.82 \+ speed \* 0\.34\);/,
    'fire material must backtrace through transported velocity plus heat-derived lift only',
  );
  assert.match(
    source,
    /thermalAdvection\(cell, advectVelocity, speed, localMaterial\.y, thermalAdvectionRiseDirection\)/,
    'the live thermal call must not retain a hidden lateral-slip input',
  );
  assert.match(
    source,
    /fireLayerAdvection\(cell, advectVelocity, speed, localMaterial\.y, fireLayerRiseDirection\)/,
    'the live fire-layer call must not retain a hidden lateral-slip input',
  );
  assert.match(
    source,
    /const MAIN_FLUID_SCALAR_ADVECTION_PERIODIC_SLIP_STRATEGY_RETIRED = 'retired-periodic-scalar-advection-slip-v0';/,
    'the structural ledger must name scalar-advection periodic-slip retirement',
  );
  assert.match(
    source,
    /const mainFluidScalarAdvectionPeriodicSlipStrategy = MAIN_FLUID_SCALAR_ADVECTION_PERIODIC_SLIP_STRATEGY_RETIRED;/,
    'the live cost ledger must report the retired scalar-advection strategy',
  );
  assert.match(
    source,
    /const scalarAdvectionPeriodicSlipEvaluationsPerCell = 0;/,
    'the live cost ledger must report zero scalar periodic-slip evaluations per cell',
  );
  assert.match(
    source,
    /state\.mainFluidScalarAdvectionPeriodicSlipStrategy = mainFluidScalarAdvectionPeriodicSlipStrategy;/,
    'the public runtime state must carry the effective retirement strategy',
  );
  assert.match(
    source,
    /state\.scalarAdvectionPeriodicSlipEvaluationsPerCell = scalarAdvectionPeriodicSlipEvaluationsPerCell;/,
    'the public runtime state must carry the zero-work count',
  );
  assert.doesNotMatch(
    source,
    /bonfireLocalMicrodetailSlipGain|transportedScalarSlip/,
    'scalar advection must not preserve a separate microdetail transport-slip exception',
  );
  assert.doesNotMatch(
    source,
    /bonfireLocalLateralSlipGain/,
    'the remaining microdetail-only slip must not impersonate generic scalar-advection authority',
  );
}

assertScalarAdvectionPeriodicityBoundary(core);

const falseClosureMutations = [
  [
    'restored direct thermal sine',
    source => source.replace(
      'let backCell = cell - (velocity + thermalLift) * (2.30 + speed * 0.46);',
      'let backCell = cell - (velocity + thermalLift + vec3<f32>(sin(cell.z), 0.0, 0.0)) * (2.30 + speed * 0.46);',
    ),
  ],
  [
    'hidden helper-local fire slip',
    source => source
      .replace('fn fireLayerAdvection(', 'fn hiddenFireSlip(cell: vec3<f32>) -> vec3<f32> { return vec3<f32>(sin(cell.y), 0.0, cos(cell.x)); }\n\nfn fireLayerAdvection(')
      .replace('let backCell = cell - (velocity + fastLift) * (1.82 + speed * 0.34);', 'let backCell = cell - (velocity + fastLift + hiddenFireSlip(cell)) * (1.82 + speed * 0.34);'),
  ],
  [
    'restored hidden work count',
    source => source.replace(
      'const scalarAdvectionPeriodicSlipEvaluationsPerCell = 0;',
      'const scalarAdvectionPeriodicSlipEvaluationsPerCell = 4;',
    ),
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate] of falseClosureMutations) {
  const mutated = mutate(core);
  assert.notEqual(mutated, core, `${name} mutation must alter the reviewed source`);
  try {
    assertScalarAdvectionPeriodicityBoundary(mutated);
    acceptedFalseClosures.push(name);
  } catch {
    // The retirement boundary must reject the mutation.
  }
}
assert.deepEqual(acceptedFalseClosures, [], 'the scalar-advection retirement boundary must reject every false-closure mutation');

console.log('volume scalar advection periodicity: thermal/fire transport follows velocity and heat lift without analytic slip');
