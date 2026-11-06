// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {reconstructionSourceChanges,createReconstructionControlLock} from '../volume-reconstruction-pause.mjs';
test('held filter inputs are distinct from sampling, mode and simulation inputs',()=>{
 const c={raySteps:2,integralReconstruction:'combined',reconstructionWindow:3};
 assert.deepEqual(reconstructionSourceChanges(c,{...c,reconstructionWindow:2,reconstructionEdges:'image'}),[]);
 assert.deepEqual(reconstructionSourceChanges(c,{...c,raySteps:3}),['raySteps']);
 assert.deepEqual(reconstructionSourceChanges(c,{...c,integralReconstruction:'off'}),['integralReconstruction']);
 assert.deepEqual(reconstructionSourceChanges(c,{...c,reconstructionFresh:false}),['reconstructionFresh']);
});
test('disabled availability is visible, repeated synchronization is stable and release restores existing conditions',()=>{
 const make=(id,disabled=false)=>({id,disabled,title:'original',dataset:{},closest:()=>null});
 const count=make('selected-volume-steps');count.dataset.authoringAlias='volume-steps';const unavailable=make('volume-history-influence',true),radius=make('volume-reconstruction-radius'),play=make('volume-viewer-play'),resume=make('volume-reconstruction-pause');
 const lock=createReconstructionControlLock({querySelectorAll:()=>[count,unavailable,radius,play,resume]});lock.sync(true);
 assert.equal(count.disabled,true);assert.equal(count.dataset.reconstructionLocked,'true');assert.match(count.title,/Resume/);assert.equal(radius.disabled,false);assert.equal(play.disabled,true);assert.equal(resume.disabled,false);
 lock.sync(true);lock.sync(false);assert.equal(count.disabled,false);assert.equal(count.title,'original');assert.equal(unavailable.disabled,true);assert.equal(play.disabled,false);assert.equal(count.dataset.reconstructionLocked,undefined);
});
