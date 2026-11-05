// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as mold from '../stage-mold.mjs';
import {Raycaster,Vector3} from '../lib/three.core.js';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {buildSceneDocument,planSceneRestore,isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
const recipe={schema:'kaminos.stage-mold.v1',label:'O',pitch:.1,wallHeight:.4,baseThickness:.1,rows:['#########','#.......#','#.#####.#','#.#####.#','#.#####.#','#.#####.#','#.#####.#','#.......#','#########']};
test('casting occupies the open strokes and preserves the counter as an actual hole',()=>{
 assert.equal(typeof mold.createStageCasting,'function','mold needs a separate positive casting');
 const object=mold.createStageCasting(recipe);object.updateMatrixWorld(true);
 const hits=x=>new Raycaster(new Vector3(x,1,0),new Vector3(0,-1,0)).intersectObject(object);
 assert.equal(hits(0).length,0);assert.ok(hits(-.3).length);assert.equal(hits(-.4).length,0);
 assert.ok(Math.abs(hits(-.3)[0].point.y-.4)<1e-6);
 const entry=createSceneObjectRecord(object,{id:'cast',source:'kaminos:stage-casting-v1',type:'pbr',burnable:{enabled:true,material:'wood'}},{id:'cast'});
 const saved=planSceneRestore(JSON.parse(JSON.stringify(buildSceneDocument({objects:[entry]})))).objects[0];
 assert.equal(isReloadableSceneObjectRecord(saved),true);assert.deepEqual(saved.stageCasting,recipe);assert.equal(saved.burnable.enabled,true);
 object.geometry.dispose();object.material.dispose();
});

test('hover arrives exactly once and does not keep overwriting native edits',async()=>{
 const {createCastingTransfer}=await import('../casting-transfer.mjs');let current,arrivals=0;
 const transfer=createCastingTransfer({write:p=>current=p,arrive:()=>arrivals++});
 const a={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},b={position:[3,1,2],rotation:[Math.PI/2,.3,0],scale:[1,1,1]};
 transfer.start(a,b,{seconds:4,lift:1});transfer.advance(2);assert.ok(current.position[1]>.5);assert.throws(()=>transfer.start(a,b),/already moving/);
 transfer.advance(9);assert.deepEqual(current,b);assert.equal(arrivals,1);current.position[0]=5;transfer.advance(1);assert.equal(current.position[0],5);assert.equal(arrivals,1);
});

test('casting pickup includes the mold parent transform',async()=>{
 const t=await import('../casting-transfer.mjs');const {Group,Quaternion,Euler}=await import('../lib/three.core.js');
 assert.equal(typeof t.castingPickupPose,'function');
 const parent=new Group(),child=new Group();parent.position.set(3,2,-1);parent.rotation.y=.7;parent.scale.setScalar(2);child.position.set(1,.5,2);child.rotation.x=.2;parent.add(child);parent.updateMatrixWorld(true);
 const offset=[.5,0,-.3],p=t.castingPickupPose(child,offset),expected=child.localToWorld(new Vector3(...offset));
 assert.ok(new Vector3(...p.position).distanceTo(expected)<1e-9);assert.ok(p.scale.every(v=>Math.abs(v-2)<1e-9));
 const q=new Quaternion().setFromEuler(new Euler(...p.rotation));assert.ok(q.angleTo(child.getWorldQuaternion(new Quaternion()))<1e-7);
});

async function workshopFixture({saved=false}={}){
 const {default:experiment}=await import('../experiments/stage-casting.experiment.mjs');
 const {Group}=await import('../lib/three.core.js');
 const rows=Array.from({length:96},(_,i)=>i>10&&i<50?'##..##..##':'##########');
 const recipe={schema:'kaminos.stage-mold.v1',label:'AB',pitch:.1,wallHeight:.1,baseThickness:.1,rows};
 const m=new Group();m.userData.kaminosStageMold=recipe;const k=new Group();k.position.set(4,0,0);
 const objects=[{id:'mold',object:m},{id:'kiln',object:k,label:'Kiln · fixture'}],events=[];let resident=false,finish,frame;
 const settled=new Promise(resolve=>finish=()=>{resident=true;resolve();});
 const author={burningState:()=>({status:resident?'resident':'waiting-for-fire',state:resident?{elapsed:0}:null}),settleCombustion:()=>{events.push('settle');return settled;},addStageCasting:async (p,pose)=>{const o=mold.createStageCasting(p);o.position.fromArray(pose.position);o.rotation.set(...pose.rotation);o.scale.fromArray(pose.scale);const id='piece-'+objects.length;objects.push({id,object:o});return id;}};
 if(saved){const part=(await import('../casting-transfer.mjs')).stageLetterCastings(recipe)[0],o=mold.createStageCasting(part.recipe);objects.push({id:'saved',object:o});}
 const app={kaminosSceneAuthoring:author,removeSceneObject:id=>objects.splice(objects.findIndex(o=>o.id===id),1)};
 const flame={read:()=>({scene:{objects:[{id:'flame-field'}]}}),setPaused:v=>events.push(['pause',v])};
 const host={controls:{document:{defaultView:app}},scene:{objects:()=>objects,open:async()=>({onFrame:fn=>{frame=fn;return()=>{};},redraw(){},dispose(){}}),refreshPresentation({id,root}){events.push({presented:id,position:root.position.toArray()});}},flame:{open:async()=>flame},fire:{read:()=>({registered:false}),setEnabled:v=>events.push(['emit',v])}};
 const study=await experiment.create({host,record:()=>{}},async()=>({read:()=>({moldId:'mold'}),operations:{stopPour:async()=>{}},dispose(){}}));
 return {study,app,events,finish,frame:dt=>frame({deltaSeconds:dt}),objects};
}
test('reopened casting is adopted and ignition waits for resident material',async()=>{
 const f=await workshopFixture({saved:true});assert.equal(f.study.read().pieceId,'saved');assert.equal(f.study.read().cursor,1);
 const ignition=f.study.operations.ignite();await new Promise(resolve=>setImmediate(resolve));
 assert.ok(f.events.includes('settle'));assert.equal(f.events.some(e=>e[0]==='emit'&&e[1]===true),false);
 f.finish();await ignition;assert.ok(f.events.some(e=>e[0]==='emit'&&e[1]===true));await f.study.dispose();
});
test('next delivery requires explicitly clearing the current casting',async()=>{
 const f=await workshopFixture();await f.study.operations.release();f.frame(4);
 await assert.rejects(f.study.operations.release(),/casting.*remove|Remove.*casting/i);
 assert.equal(typeof f.study.operations.removeCasting,'function');await f.study.operations.removeCasting();await f.study.operations.release();assert.equal(f.study.read().cursor,2);await f.study.dispose();
});
test('cold ignition does not enable the source before material initialization',async()=>{
 const f=await workshopFixture();await f.study.operations.release();f.frame(4);
 const ignition=f.study.operations.ignite();await new Promise(resolve=>setImmediate(resolve));
 assert.ok(f.events.includes('settle'),'native material initialization must be awaited');assert.equal(f.events.some(e=>e[0]==='emit'&&e[1]===true),false);
 f.finish();await ignition;await f.study.dispose();
});
test('native deletion of the active casting stops its ignition',async()=>{
 const f=await workshopFixture();await f.study.operations.release();f.frame(4);f.finish();await f.study.operations.ignite();
 f.objects.splice(2);f.frame(.1);assert.equal(f.study.read().igniting,false);assert.deepEqual(f.events.at(-1),['emit',false]);await f.study.dispose();
});

test('stationary unmolding leaves a letter at the mold for a mechanical pickup',async()=>{
 const f=await workshopFixture();
 assert.equal(typeof f.study.operations.unmold,'function','stationary unmold is a distinct operation');
 await f.study.operations.unmold();
 const id=f.study.read().pieceId,root=f.objects.find(o=>o.id===id).object;
 const before=root.position.toArray();f.frame(20);
 assert.deepEqual(root.position.toArray(),before);
 assert.ok(!f.study.read().transfer?.moving);
 await f.study.dispose();
});

async function loaderFixture({phase=.25,cycle=.5}={}){
 const f=await workshopFixture(),{Group}=await import('../lib/three.core.js');
 const root=new Group(),recipe={nodes:[{parent:null},{parent:0}],phase,castingCarrier:{moldId:'mold',joint:1},attachments:[]};root.userData.linkMechanism=recipe;
 const state={recipe,cycle,fraction:(1-Math.cos((cycle+phase)*2*Math.PI))/2,playing:false};
 const operations={pause(){state.playing=false;},seek({cycle}){state.cycle=((cycle%1)+1)%1;state.fraction=(1-Math.cos((cycle+phase)*2*Math.PI))/2;},attach(a){recipe.attachments.push(a);},detach({objectId}){recipe.attachments=recipe.attachments.filter(a=>a.objectId!==objectId);}};
 const runtime={read:()=>structuredClone(state),operations};
 f.objects.push({id:'loader',object:root});f.app.kaminosMechanisms={ensure:async()=>runtime,invoke:async(id,op,args)=>operations[op](args)};
 return {...f,runtime,state};
}
test('carrier uses authored endpoints despite phase or a native cycle on the returning half',async()=>{
 const f=await loaderFixture();await f.study.operations.unmold();await f.study.operations.carry();f.frame(4);
 assert.ok(Math.abs(f.state.fraction-1)<1e-10);assert.equal(f.study.read().carriage.moving,false);
 await f.study.operations.returnLoader();f.frame(4);assert.ok(Math.abs(f.state.fraction)<1e-10);await f.study.dispose();
});
test('native loader changes cancel automatic carry before it overwrites the edit',async()=>{
 const f=await loaderFixture({phase:0,cycle:0});await f.study.operations.unmold();await f.study.operations.carry();f.frame(1);
 f.runtime.operations.seek({cycle:.37});f.frame(1);
 assert.ok(Math.abs(f.state.cycle-.37)<1e-10);assert.equal(f.study.read().carriage.moving,false);await f.study.dispose();
});
test('deleting a carried casting stops automatic loader travel',async()=>{
 const f=await loaderFixture({phase:0,cycle:0});await f.study.operations.unmold();await f.study.operations.carry();f.frame(1);
 f.objects.splice(f.objects.findIndex(o=>o.id===f.study.read().pieceId),1);const cycle=f.state.cycle;f.frame(1);
 assert.equal(f.state.cycle,cycle);assert.equal(f.study.read().carriage.moving,false);await f.study.dispose();
});

test('each letter lifts to the editable paddle mount before articulated transport',async()=>{
 const f=await loaderFixture({phase:0,cycle:0});
 const{Group}=await import('../lib/three.core.js');const paddle=new Group();paddle.position.set(2,3,4);paddle.rotation.y=.4;paddle.scale.setScalar(2);f.objects.push({id:'paddle',object:paddle});
 f.state.recipe.mounts=[{id:'load',owner:{objectId:'paddle'},position:[0,.05,0],rotation:[0,0,0]}];f.state.recipe.castingCarrier.pickupMount='load';
 for(let n=0;n<2;n++){
  await f.study.operations.unmold();assert.equal(f.study.read().transfer?.moving,true,'unmolding lifts to the loading mount');
  await assert.rejects(f.study.operations.carry(),/transfer|lift/i);
  f.frame(4);const piece=f.objects.find(o=>o.id===f.study.read().pieceId).object;
  assert.ok(piece.position.distanceTo(new Vector3(2,3.1,4))<1e-8);assert.ok(Math.abs(piece.rotation.y-.4)<1e-8);assert.deepEqual(piece.scale.toArray(),[1,1,1]);
  assert.match(f.study.read().phase,/loader/i);await f.study.operations.removeCasting();
 }
 f.state.fraction=1;await assert.rejects(f.study.operations.unmold(),/return.*loader|loader.*mold/i);assert.equal(f.objects.filter(o=>o.object.userData.kaminosStageCasting).length,0);
 f.state.fraction=0;f.state.recipe.castingCarrier.pickupMount='missing';await assert.rejects(f.study.operations.unmold(),/mount/i);assert.equal(f.objects.filter(o=>o.object.userData.kaminosStageCasting).length,0);
 await f.study.dispose();
});

 test('carriage presents the selected casting at each move and at stop',async()=>{
 const f=await loaderFixture({phase:0,cycle:0});await f.study.operations.unmold();
 const id=f.study.read().pieceId,root=f.objects.find(o=>o.id===id).object;
 f.app.kaminosSelection={read:()=>({ids:[id]})};
 const seek=f.runtime.operations.seek;f.runtime.operations.seek=p=>{seek(p);root.position.x=f.state.fraction*10;};
 await f.study.operations.carry();f.frame(1);
 assert.deepEqual(f.events.at(-1),{presented:id,position:root.position.toArray()},'selected native controls follow the moved payload');
 f.events.length=0;f.study.operations.stopTransfer();
 assert.deepEqual(f.events.at(-1),{presented:id,position:root.position.toArray()},'Stop publishes the editable pose');
 await f.study.operations.carry();f.frame(4);
 assert.equal(root.position.x,10);assert.deepEqual(f.events.at(-1),{presented:id,position:root.position.toArray()});
 await f.study.dispose();
 });

test('Carry exits polygon editing through its normal owner before attaching, without bypassing edit history',async()=>{
 const f=await loaderFixture({phase:0,cycle:0});await f.study.operations.unmold();
 let editing=true,exits=0;f.app.kaminosPolyEdit={read:()=>({editing}),exit(){editing=false;exits++;}};
 const attach=f.runtime.operations.attach;f.runtime.operations.attach=a=>{if(editing)throw Error('Finish preview or correction before editing placement');attach(a);};
 await f.study.operations.carry();assert.equal(exits,1);f.frame(4);assert.equal(f.state.fraction,1);await f.study.dispose();
});

test('Run next letter consumes cavity measurement and native stage completion',async()=>{
 const f=await loaderFixture({phase:0,cycle:0});let step=0,counts=[0,0],flowing=false,elapsed=0;
 // The fixture supplies the GPU measurement boundary; its kernel has a separate native witness.
 f.app.kaminosWaterSources={read:()=>({runtime:{step}}),createRegionMeasurement:async()=>({measure:async()=>({counts,particleVolume:.001,step}),dispose(){}})};
 f.study.operations.pour=async()=>{flowing=true;};f.study.operations.stopPour=async()=>{flowing=false;};
 const old=f.app.kaminosSceneAuthoring.burningState;f.app.kaminosSceneAuthoring.burningState=id=>{const s=old(id);if(s.state)s.state.elapsed=elapsed;return s;};
 const drain=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
 f.study.operations.runCycle();await drain();assert.equal(flowing,true);f.frame(.1);await drain();assert.equal(f.study.read().pieceId,null);
 step=60;counts=[80,0];f.frame(.1);await drain();assert.ok(f.study.read().pieceId);assert.equal(flowing,false);
 f.frame(4);await drain();f.frame(4);await drain();f.finish();await drain();assert.equal(f.study.read().igniting,true);
 elapsed=3;f.frame(.1);await drain();f.frame(4);await drain();
 assert.equal(f.study.read().cycle.phase,'complete');assert.equal(f.state.fraction,0);assert.equal(f.study.read().igniting,false);await f.study.dispose();
});
