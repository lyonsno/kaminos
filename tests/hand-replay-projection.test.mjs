// kaminos-test: node
import assert from 'node:assert/strict';
import {projectHand,projectionSupport,commonImageBox,maskDisagreement} from '../experiments/hand-replay-projection.mjs';
const camera={schema:'hand-state.source-camera.v1',imageSize:[640,480],intrinsics:[500,600,320,240],translation:[.1,-.2,1],method:'test_observed_coordinate_contract',basis:'opencv_x_right_y_down_z_forward'};
const h={status:'observed',vertices:[[0,0,0],[.1,0,.5],[0,.1,0]],joints:Array.from({length:21},()=>[0,0,0]),camera};
assert.equal(projectionSupport(h).available,true);
assert.deepEqual(projectHand(h).vertices,[[370,120,1],[386.6666666666667,160,1.5],[370,180,1]]);
assert.deepEqual(h.vertices,[[0,0,0],[.1,0,.5],[0,.1,0]],'camera view never rewrites source geometry');
assert.equal(projectionSupport({...h,camera:undefined}).available,false);
assert.equal(projectionSupport({...h,status:'missing',reason:'native confidence'}).available,false);
for(const patch of [{intrinsics:[-1,600,320,240]},{basis:'unknown'},{translation:[0,0,-1]},{imageSize:[640,0]}]){
 const invalid={...h,camera:{...camera,...patch}};assert.equal(projectionSupport(invalid).available,false);assert.throws(()=>projectHand(invalid));
}
assert.deepEqual(commonImageBox([{hands:[{cropBox:[20,30,90,100]}]},{hands:[{cropBox:[10,40,120,150]}]}],0,[640,480]),[10,30,120,150]);
const both=maskDisagreement(new Uint8Array([0,255,255,0]),new Uint8Array([0,255,0,255]));
assert.deepEqual(both.counts,{both:1,leftOnly:1,rightOnly:1,neither:1});
assert.deepEqual([...both.rgba],[0,0,0,0,130,105,160,100,45,190,255,220,255,150,60,220]);
assert.throws(()=>maskDisagreement(new Uint8Array(2),null),/unavailable/,'missing output cannot become a full disagreement mask');
console.log('source-camera projection behavior passed');
