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

function jsFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing JavaScript function ${name}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing JavaScript body for ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated JavaScript body for ${name}`);
}

function assertInitialFieldPeriodicityBoundary(source) {
  const initialFluid = jsFunction(source, 'makeInitialFluid');
  assert.doesNotMatch(initialFluid, /Math\.(?:sin|cos|tan|atan2|random)\s*\(/, 'CPU initial fields must not stamp explicit periodic or nondeterministic patterns into transported state');
  assert.doesNotMatch(initialFluid, /\b(?:detailScale|scaledDetailFrequency|seedDetailFrequency)\b/, 'Detail Scale must not control synthetic CPU initial-field topology');

  const seedHash = jsFunction(source, 'deterministicInitialSeedUnit');
  assert.doesNotMatch(seedHash, /Math\.(?:sin|cos|tan|atan2|random)\s*\(/, 'the initial-state dephasing helper must be deterministic and nonperiodic');
  assert.doesNotMatch(seedHash, /\b(?:time|frame|detailScale|seedDetailFrequency)\b/i, 'the initial-state dephasing helper must not receive clock or Detail Scale authority');
  assert.match(seedHash, /Math\.imul\s*\(/, 'the initial-state dephasing helper uses integer mixing rather than a hidden wave');
  assert.match(initialFluid, /const seedKeyX = isBonfireInitialScene\s*\?\s*Math\.round\(Math\.abs\(dx\)/, 'Bonfire seed dephasing mirrors the source-relative X coordinate');
  assert.match(initialFluid, /const seedKeyZ = isBonfireInitialScene\s*\?\s*Math\.round\(Math\.abs\(dz\)/, 'Bonfire seed dephasing mirrors the source-relative Z coordinate');
  assert.match(initialFluid, /const seedNoiseA = deterministicInitialSeedUnit\(seedKeyX, seedKeyY, seedKeyZ, 0x[\da-f]+\);/i, 'initial fields own an explicit deterministic spatial dephasing channel');
  assert.match(initialFluid, /const seedNoiseB = deterministicInitialSeedUnit\(seedKeyX, seedKeyY, seedKeyZ, 0x[\da-f]+\);/i, 'initial fields own a second decorrelated deterministic spatial dephasing channel');
  assert.match(initialFluid, /const seedNoiseC = deterministicInitialSeedUnit\(seedKeyX, seedKeyY, seedKeyZ, 0x[\da-f]+\);/i, 'initial fields own a third decorrelated deterministic spatial dephasing channel');
  assert.doesNotMatch(initialFluid, /\b(?:azimuthalSeed|radialSeedDetail|angle)\b/, 'retired angular/radial seed-carpet semantics must not remain in initial-state source');

  const seededChannels = sourceBetween(
    initialFluid,
    '          const seedMaterialDetail =',
    '          const i = ((x + y * nextGridSize',
  );
  for (const name of [
    'seedMaterialDetail',
    'seedBonfireFlame',
    'seedVisibleFireCarrier',
    'seedMicroSmoke',
    'seedInterfaceShred',
    'seedFireLick',
  ]) {
    assert.match(seededChannels, new RegExp(`\\b${name}\\b`), `${name} remains explicitly initialized`);
  }
  assert.match(seededChannels, /seedNoiseA/, 'initial-state channel variation consumes deterministic spatial dephasing');
  assert.match(seededChannels, /seedNoiseB/, 'initial-state channel variation uses more than one correlated seed channel');
  assert.match(seededChannels, /seedNoiseC/, 'initial-state channel variation uses the third decorrelated seed channel');
}

assertInitialFieldPeriodicityBoundary(core);

const falseClosureMutations = [
  [
    'direct periodic seed',
    source => source.replace(
      '          const seedNoiseA = deterministicInitialSeedUnit(',
      '          const periodicSeed = Math.sin(fx * 19 + fy * 7);\n          const seedNoiseA = periodicSeed * 0.01 + deterministicInitialSeedUnit(',
    ),
  ],
  [
    'nondeterministic seed',
    source => source.replace(
      '  let h = Math.imul(',
      '  let h = Math.imul(Math.floor(Math.random() * 0x7fffffff) ^ ',
    ),
  ],
  [
    'Detail Scale restores seed frequency authority',
    source => source.replace(
      '          const seedKeyX =',
      '          const seedDetailFrequency = controlsSnapshot.detailScale;\n          const seedKeyX =',
    ),
  ],
];

const acceptedFalseClosures = [];
for (const [name, mutate] of falseClosureMutations) {
  const mutated = mutate(core);
  assert.notEqual(mutated, core, `${name} mutation must alter the reviewed source`);
  try {
    assertInitialFieldPeriodicityBoundary(mutated);
    acceptedFalseClosures.push(name);
  } catch {
    // Expected: the boundary rejects the mutation.
  }
}
assert.deepEqual(acceptedFalseClosures, [], 'the initial-field periodicity boundary must reject every false-closure mutation');

console.log('volume initial-field periodicity: deterministic spatial dephasing replaces angular/radial seed carpets');
