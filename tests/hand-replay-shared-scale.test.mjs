// kaminos-test: node
import assert from 'node:assert/strict';
import {sourceStageGeometry} from '../experiments/hand-replay-inspection.mjs';
const h={status:'observed',vertices:Array.from({length:778},(_,i)=>[i%7*.003,i%9*.003,i%4*.002]),joints:Array.from({length:21},()=>[0,0,0]),camera:{schema:'hand-state.source-camera.v1',basis:'opencv_x_right_y_down_z_forward',imageSize:[224,224],intrinsics:[500,500,112,112],translation:[0,0,.4],method:'source camera'}};
const other=structuredClone(h);other.vertices[77][2]=.08;
const a=sourceStageGeometry(h,[47,47,177,177],2.5,.6),b=sourceStageGeometry(other,[47,47,177,177],2.5,.6);
assert.equal(a.scale,b.scale,'all meshes sharing source camera/crop must use one sequence depth, rather than normalizing each mesh by its own deepest vertex');
