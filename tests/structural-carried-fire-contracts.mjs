import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  evaluateStructuralComponentMotion,
  transformStructuralCarriedNode,
} from '../structural-combustion-gpu.mjs';

const attached = evaluateStructuralComponentMotion({
  componentLabel: 0,
  step: 220,
  detachmentStep: 0,
});
assert.deepEqual(attached.translation, [0, 0, 0]);
assert.equal(attached.active, false);

const firstDetached = evaluateStructuralComponentMotion({
  componentLabel: 17,
  step: 160,
  detachmentStep: 0,
});
assert.equal(firstDetached.detachmentStep, 160);
assert.deepEqual(firstDetached.translation, [0, 0, 0]);

const carried = evaluateStructuralComponentMotion({
  componentLabel: 17,
  step: 220,
  detachmentStep: 160,
  dt: 1 / 60,
  lateralRate: 0.18,
  gravity: -0.82,
  depthRate: 0.04,
  maximumAge: 1,
});
assert.deepEqual(carried.translation.map(value => Number(value.toFixed(4))), [0.18, -0.82, 0.04]);
assert.equal(carried.active, true);

const transformed = transformStructuralCarriedNode({
  position: [0.25, 0.5, 0.75],
  displacement: [0.01, -0.02, 0.03],
  translation: carried.translation,
  pyroScale: [0.18, 0.24, 0.18],
  pyroOffset: [0.41, 0.26, 0.41],
  displayScale: [1.12, 0.68, 0.58],
  worldOffset: [-0.64, 0.08, 0],
});
assert.deepEqual(transformed.carriedLocal.map(value => Number(value.toFixed(4))), [0.43, -0.32, 0.79]);
assert.deepEqual(transformed.sourcePosition, transformed.exposurePosition);
assert.deepEqual(
  transformed.sourcePosition.map(value => Number(value.toFixed(4))),
  [0.4874, 0.1832, 0.5522],
);
assert.deepEqual(
  transformed.displayedPosition.map(value => Number(value.toFixed(4))),
  [-0.7084, -0.4976, 0.1982],
);

const source = readFileSync(new URL('../structural-combustion-gpu.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(source, /fallProgress/, 'presentation cannot own an independent global fall clock');
assert.match(source, /struct ComponentMotion/, 'the command graph must carry resident component motion state');
assert.match(source, /fn carriedNodePosition/, 'exposure, emission, and presentation need one carried-position law');
assert.match(
  source,
  /fluidExposure\(carriedNodePosition\(nodeIndex\)\)/,
  'continued exposure must sample the moved node position',
);
assert.match(
  source,
  /let position = carriedNodePosition\(nodeIndex\) \* params\.pyroScale\.xyz \+ params\.pyroOffset\.xyz/,
  'source records must use the same moved node position',
);
assert.match(source, /entryPoint: 'updateComponentMotions'/, 'topology must project into persistent component motion');
assert.match(source, /entryPoint: 'emitSources'/, 'source emission must occur after component motion updates');

console.log('structural carried-fire contracts: ok');
