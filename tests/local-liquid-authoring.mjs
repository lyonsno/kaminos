import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneEdits} from '../scene-edit-session.mjs';
const settings={schema:'kaminos.local-liquid-emitter.v1',baseRadius:.08,strength:1.15,rate:null,inletProfile:'plug'};
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
test('selected water settings edit the named emitter through chronological undo/redo and saved settings',async()=>{
 const m=await import('../local-liquid-authoring.mjs').catch(()=>({}));
 assert.equal(typeof m.createLocalLiquidEmitterAuthoring,'function','water needs an authored settings target');
 const records=new Map(['a','b'].map(id=>[id,{id,transform:structuredClone(pose),localLiquidEmitter:structuredClone(settings)}]));
 const edits=createSceneEdits({read:()=>pose,write:()=>{}});const writes=[];
 const water=m.createLocalLiquidEmitterAuthoring({edits,readRecord:id=>records.get(id),writeSettings:(id,value)=>{records.get(id).localLiquidEmitter=value;writes.push(id);}});
 water.apply('a',{strength:1.7,rate:400,inletProfile:'round_poiseuille'});
 assert.equal(edits.state().undoCount,1);assert.equal(records.get('a').localLiquidEmitter.strength,1.7);assert.deepEqual(records.get('b').localLiquidEmitter,settings);
 edits.undo();assert.deepEqual(records.get('a').localLiquidEmitter,settings);edits.redo();assert.equal(records.get('a').localLiquidEmitter.rate,400);
 water.apply('a',{rate:null});assert.equal(records.get('a').localLiquidEmitter.rate,null);
 const saved=JSON.parse(JSON.stringify(records.get('a')));assert.equal(saved.localLiquidEmitter.strength,1.7);
 assert.throws(()=>water.apply('a',{strength:NaN}),/strength/);assert.throws(()=>water.apply('missing',{rate:0}),/emitter/);
 records.get('a').transform.scale=[2,2,2];assert.throws(()=>water.apply('a',{baseRadius:.15}),/aperture/);
});
test('helper ground disappears only during the retained basin draw and always restores authored visibility',async()=>{
 const m=await import('../local-liquid-authoring.mjs').catch(()=>({}));
 assert.equal(typeof m.withLocalLiquidHelperGround,'function','the duplicate helper must not occlude basin water');
 const ground={visible:true};m.withLocalLiquidHelperGround(ground,()=>assert.equal(ground.visible,false));assert.equal(ground.visible,true);
 assert.throws(()=>m.withLocalLiquidHelperGround(ground,()=>{assert.equal(ground.visible,false);throw Error('draw failed');}),/draw failed/);assert.equal(ground.visible,true);
 ground.visible=false;m.withLocalLiquidHelperGround(ground,()=>{});assert.equal(ground.visible,false);
 assert.equal(m.withLocalLiquidHelperGround(null,()=>42),42);
});
