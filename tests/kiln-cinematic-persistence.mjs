import assert from 'node:assert/strict';
import { buildSceneDocument, planSceneRestore } from '../scene-persistence-core.js';

const cinematic = {
  schema: 'kaminos.kiln-cues.v1',
  ignition: [{ time: 0, radius: 0.15, flow: 0 }, { time: 2, radius: 0.52, flow: 2.5 }],
  work: [{ time: 0, radius: 0.52, flow: 2.5 }, { time: 4, radius: 0.35, flow: 1.2 }],
  extinguishSeconds: 5,
  revealSeconds: 3,
  previewWorkSeconds: 8,
  workLight: 0.35,
  cameraPush: 0.12,
};
const document = buildSceneDocument({ objects: [{ id: 'kiln', source: '/api/generated-meshes/kiln.glb' }], cinematic });
assert.deepEqual(document.cinematic, cinematic, 'scene save must retain the authored kiln cues');
assert.deepEqual(planSceneRestore(document).cinematic, cinematic, 'reopening must recover the same cues');
cinematic.ignition[0].flow = 1;
assert.equal(document.cinematic.ignition[0].flow, 0, 'saved cues must not alias editor state');
assert.equal(planSceneRestore({ ...document, cinematic: undefined }).cinematic, null, 'old scenes must load without cues');
assert.throws(() => buildSceneDocument({ cinematic: { ...cinematic, extinguishSeconds: -1 } }), /extinguishSeconds/);
assert.throws(() => buildSceneDocument({ cinematic: { ...cinematic, work: [{time: 0, radius: 0.52, flow: 9}, cinematic.work[1]] } }), /flow/);
assert.throws(() => buildSceneDocument({ cinematic: { ...cinematic, ignition: [{time: 1, radius: 0.52, flow: 1}, cinematic.ignition[1]] } }), /time/);
console.log('Cinematic recipe persistence contracts passed');
