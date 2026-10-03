import assert from 'node:assert/strict';
import { buildKimodoHindquartersTrack } from '../motion-rig-retarget-core.mjs';
// Observed retained SOMA30 pose, exact input preserved with the live witness.
// Captured mapped landmarks from retained gallop SHA 2abade01…98c4,
// first frame. Unused joints are zero; these are not a full motion export.
const landmarks = {0:[-0.014370552751322312,0.9857465612397853,0.0589001721748519],1:[-0.015006421274833918,1.0357719117036146,0.05783649564517262],22:[0.08688515493493543,0.902684829538087,0.08577974061428335],23:[0.156397604252698,0.47694130459401196,0.05772754916142116],24:[0.21058927575144185,0.0663919008043718,-0.02846840600417401],25:[0.24472854059559604,0.017350444505827893,0.0999706987512712],26:[-0.11402375730127878,0.9020760882080944,0.0859373648011843],27:[-0.18365956076605983,0.4759421815248865,0.04527141927164545],28:[-0.24358262263646455,0.06629998959114886,-0.03958079675488134],29:[-0.2715873507812248,0.01476352205528672,0.08998366831746753]};
const pose = Array.from({length:30}, (_,i) => landmarks[i] || [0,0,0]);
const result = { numJoints:30, fps:30, parents:[-1,0,1,2,3,4,5,6,6,6,3,10,11,12,13,13,3,16,17,18,19,19,0,22,23,24,0,26,27,28] };
const turned = pose.map(([x,y,z]) => [z + 2,y - 3,-x + 4]);
const track = buildKimodoHindquartersTrack({ ...result, joints: [pose, turned], numFrames: 2 });
for (const side of ['left', 'right']) {
  for (const [joint, angle] of Object.entries(track.frames[1][side])) {
    assert.ok(Math.abs(angle) < 1e-10, `rigid donor turn must not manufacture ${side} ${joint}: ${angle}`);
  }
}
console.log('cat donor body-frame contracts passed');
const straight = structuredClone(pose);
straight[0]=[0,0,0]; straight[1]=[0,1,0]; straight[22]=[1,0,0]; straight[26]=[-1,0,0];
straight[23]=[1,-1,.5]; straight[24]=[1,-2,.3]; straight[25]=[1,-2,1];
straight[27]=[-1,-1,.5]; straight[28]=[-1,-2,.3]; straight[29]=[-1,-2,1];
const sway = structuredClone(straight); sway[27][0] += .01;
const swayTrack = buildKimodoHindquartersTrack({...result,joints:[straight,sway],numFrames:2});
assert.ok(Math.abs(swayTrack.frames[1].right.hipRadians) < 1e-10, 'pure lateral thigh sway must not change sagittal hip flexion');
