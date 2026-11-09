// kaminos-test: node
import assert from 'node:assert/strict';
import {sourceStageGeometry} from '../experiments/hand-replay-inspection.mjs';
import {projectHand} from '../experiments/hand-replay-projection.mjs';

const camera={schema:'hand-state.source-camera.v1',basis:'opencv_x_right_y_down_z_forward',imageSize:[640,480],intrinsics:[510,490,320,240],translation:[.01,.02,.45],method:'retained camera'};
const vertices=Array.from({length:778},(_,i)=>[(i%13)*.003-.02,(i%17)*.004-.03,(i%7)*.006]);
const hand={status:'observed',vertices,joints:vertices.slice(0,21),camera};
const snapshot=structuredClone(hand),box=[150,80,450,380],span=2.5;
const geometry=sourceStageGeometry(hand,box,span,1.3,{aligned:true});
const projected=projectHand(hand);
for(const i of [0,5,90,777]){
 const actual=Array.from(geometry.positions.slice(3*i,3*i+3)).map((v,k)=>v+geometry.wrist[k]);
 const expected=[(projected.vertices[i][0]-(box[0]+box[2])/2)/300*span,-(projected.vertices[i][1]-(box[1]+box[3])/2)/300*span];
 assert(Math.abs(actual[0]-expected[0])<1e-6,'locked photo view must place every vertex at its saved-camera projection, independent of overview-camera perspective');
 assert(Math.abs(actual[1]-expected[1])<1e-6);
 assert.equal(actual[2],0,'photo projection is composited in the image plane');
}
assert.deepEqual(hand,snapshot,'alignment is a presentation transform and must not mutate source geometry or camera');
const free=sourceStageGeometry(hand,box,span,1.3,{freeScale:12});
const distance=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));
const a=Array.from(free.positions.slice(0,3)),b=Array.from(free.positions.slice(270,273));
assert(Math.abs(distance(a,b)/distance(vertices[0],vertices[90])-12)<1e-5,'3D mode preserves raw distances with one common scale');
console.log('locked photo projection preserves source-camera pixels and raw geometry');
