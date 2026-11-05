// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from '../lib/three.core.js';
import * as mold from '../stage-mold.mjs';
import casting from '../experiments/stage-casting.experiment.mjs';
import arrival from '../experiments/generation-arrival.experiment.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const rows=Array.from({length:96},(_,i)=>i>10&&i<50?'##..##..##':'##########');
 const m=mold.createStageMold({schema:'kaminos.stage-mold.v1',label:'AB',pitch:.1,wallHeight:.1,baseThickness:.1,rows});
 const k=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial());k.position.set(4,0,0);
 const objects=[{id:'mold',object:m},{id:'kiln',object:k,label:'Kiln · fixture'}],frames=[],events=[];
 let resident=false,finish,firePaused=true,emitting=false,waterPaused=false;
 const settled=new Promise(r=>finish=()=>{resident=true;r();});
 const author={burningState:()=>({status:resident?'resident':'waiting-for-fire',state:resident?{elapsed:0}:null}),settleCombustion:()=>settled,addStageCasting:async(p,pose)=>{const o=mold.createStageCasting(p);o.position.fromArray(pose.position);o.rotation.set(...pose.rotation);o.scale.fromArray(pose.scale);const id='piece-'+objects.length;objects.push({id,object:o});return id;}};
 const flame={read:()=>({paused:firePaused,scene:{objects:[{id:'flame-field'}]}}),setPaused:v=>{firePaused=v;events.push({pause:v});}};
 const app={kaminosSceneAuthoring:author,kaminosWaterSources:{read:()=>({runtime:{paused:waterPaused}})},kaminosPauseLocalLiquid:v=>waterPaused=v};
 const view={position:[10,7,13],target:[0,1,-2],fov:38};
 const host={controls:{document:{defaultView:app,addEventListener(){},removeEventListener(){}}},scene:{objects:()=>objects,open:async()=>({onFrame:f=>{frames.push(f);return()=>{};},readView:()=>view,redraw(){},dispose(){}}),renderer:()=>({domElement:{clientWidth:1000,clientHeight:800}}),refreshPresentation(){},translateArrivalStage(ids,delta){for(const o of objects)if(ids.includes(o.id))o.object.position.add(new T.Vector3(...delta));},arrivalPresentation:{set(){},dispose(){}}},flame:{open:async()=>flame},fire:{read:()=>({registered:false}),setEnabled:v=>{emitting=v;events.push({emitting:v});}}};
 const create=ctx=>casting.create(ctx,async()=>({read:()=>({moldId:'mold'}),operations:{stopPour:async()=>{}},dispose(){}}));
 return {host,create,objects,frames,events,finish,view,state:()=>({firePaused,emitting}),frame:dt=>frames.forEach(f=>f({deltaSeconds:dt}))};
}
test('Return invalidates pending individual ignition before late material completion',async()=>{
 const f=fixture(),s=await f.create({host:f.host,inputs:{},record(){}});await s.operations.unmold();
 const pending=s.operations.ignite();await tick();await s.operations.suspend();f.finish();
 await assert.rejects(pending,/suspend|cancel/i);assert.deepEqual(f.state(),{firePaused:true,emitting:false});assert.equal(s.read().igniting,false);await s.dispose();
});
test('Return invalidates pending cycle ignition without unpausing thermal state',async()=>{
 const f=fixture(),s=await f.create({host:f.host,inputs:{},record(){}});await s.operations.unmold();
 await s.operations.runCycle();await tick();f.frame(4);await tick();await s.operations.suspend();f.finish();await tick();await tick();
 assert.deepEqual(f.state(),{firePaused:true,emitting:false});assert.equal(s.read().igniting,false);assert.equal(s.read().cycle.running,false);await s.dispose();
});
test('repeated Return preserves one resume obligation and respects user-paused fire',async()=>{
 const f=fixture(),s=await f.create({host:f.host,inputs:{},record(){}});await s.operations.unmold();f.finish();await s.operations.ignite();
 await s.operations.suspend();await s.operations.suspend();s.operations.resume();assert.equal(f.state().firePaused,false);
 s.operations.pause();await s.operations.suspend();await s.operations.suspend();s.operations.resume();assert.equal(f.state().firePaused,true);await s.dispose();
});
test('an interrupted hover resumes within the new entrance frame',async()=>{
 const f=fixture(),s=await arrival.create({host:f.host,inputs:{stageIds:['mold','kiln']},record(){}},f.create);
 s.operations.enter();f.frame(3);await s.operations.unmold();await s.operations.carry();f.frame(1);
 await s.operations.exit();f.frame(3);f.view.position[0]+=30;f.view.target[0]+=30;s.operations.enter();f.frame(3);
 const kilnNow=f.objects.find(o=>o.id==='kiln').object.position.toArray();await s.operations.runCycle();await tick();
 assert.ok(Math.abs(s.read().study.transfer.to.position[0]-kilnNow[0])<1e-9);f.frame(3);await tick();
 assert.ok(Math.abs(f.objects.find(o=>o.id===s.read().study.pieceId).object.position.x-kilnNow[0])<1e-9);await s.operations.stopCycle();await s.dispose();
});
