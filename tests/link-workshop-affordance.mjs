// kaminos-test: node
import assert from 'node:assert/strict';
import {connectionGuide} from '../experiments/link-workshop/affordance.mjs';
const model={nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,0]},{parent:0,length:3,angles:[1,1]}],pistons:[{a:0,b:1}]};
const state={model,editing:true,playing:false,mode:'build',tool:'piston',start:0,hover:2};
assert.equal(connectionGuide(state).targets[0],'start');assert.equal(connectionGuide(state).targets[1],'blocked');assert.equal(connectionGuide(state).targets[2],'hover');assert.equal(connectionGuide(state).valid,true);
assert.equal(connectionGuide({...state,hover:1}).valid,false);assert.match(connectionGuide({...state,hover:1}).message,/already/i);
assert.equal(connectionGuide({...state,hover:0}).valid,false);
assert.equal(connectionGuide({...state,editing:false}).active,false);assert.equal(connectionGuide({...state,playing:true}).active,false);assert.equal(connectionGuide({...state,mode:'A'}).active,false);
console.log('connection guidance passes');
