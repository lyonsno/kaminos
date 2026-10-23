// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import definition from '../experiments/part-claims.experiment.mjs';
const source={objects:[{id:'box',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters:{width:2,height:2,depth:2}},transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}],provenance:{analyticalCarrier:{parts:{base:['box']}}}};
const oldFetch=globalThis.fetch;const savedRecords=[];const identity={source:{sha256:'source'},target:{sha256:'target'}};
globalThis.fetch=async(url,options)=>({ok:true,json:async()=>{
 if(!url.startsWith('/api/asset-registrations'))return source;
 if(options?.method==='POST'){const body=JSON.parse(options.body),record={schema:'kaminos.asset-registration.v1',id:String(savedRecords.length),...body};savedRecords.push(record);return {registration:record};}
 const id=new URL(url,'http://local').searchParams.get('id');return id?{identity,registration:savedRecords.find(r=>r.id===id)}:{identity,registrations:savedRecords.map(r=>({id:r.id,name:r.name,compatible:true}))};
}});
source.actuators=[{id:'drive',axis:[1,0,0],hinge:[0,1,0],baseMount:[0,0,0],movingMount:[0,1,1]}];
let target,view={position:[2,2,2],target:[0,0,0]},refreshes=0,transformCalls=0;const attachments=[],registrations=new Map();
const host={scene:{objects:()=>[...registrations.values()],setTransform:async(id,p)=>{transformCalls++;const root=registrations.get(id).object;root.position.fromArray(p.position);root.rotation.set(...p.rotation);root.scale.fromArray(p.scale);},refreshPresentation:()=>{refreshes++;},open:async()=>({
 loadAsset:async()=>{target=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());registrations.set('target',{id:'target',object:target});return {id:'target',root:target};},
 attach:async(root,options)=>{const receipt={id:root.uuid,root,options};attachments.push(receipt);if(!options.presentation)registrations.set(receipt.id,{id:receipt.id,object:root});return receipt;},redraw(){},onFrame:()=>()=>{},setView:v=>{view=v;},readView:()=>view,dispose:async()=>{},
})}};
try{
 const first=await definition.create({host,inputs:{},record(){}});
 const firstGuess=attachments.find(a=>a.id===first.read().joints[0].guessObjectId).root;
 firstGuess.position.set(7,8,9);firstGuess.rotation.set(0,.7,0);firstGuess.scale.set(2,3,4);
 target.position.set(3,4,5);target.rotation.z=.4;target.scale.setScalar(2);
 const oldLocation=globalThis.location;globalThis.location={href:'http://127.0.0.1:8342/'};
 const save=await first.operations.saveRegistration('Operator fit');
 assert.equal(save.registration.name,'Operator fit');assert.deepEqual(savedRecords[0].recipe.jointGuesses[first.read().joints[0].id].position,[7,8,9]);
 globalThis.location=oldLocation;
 const recipe=first.operations.recipe();await first.dispose();
 const second=await definition.create({host,inputs:recipe,record(){}});
 assert.deepEqual(target.position.toArray(),[3,4,5],'reopen preserves edited target placement');
 assert.equal(target.rotation.z,.4);assert.deepEqual(target.scale.toArray(),[2,2,2]);assert.equal(refreshes,3);
 assert.equal(attachments[0].options.presentation,undefined,'source carrier is an ordinary selectable scene registration');
 assert.deepEqual(second.read().joints[0].guessPose,{position:[7,8,9],rotation:[0,.7,0],scale:[2,3,4]},'manual joint correspondence survives reopening');
 second.operations.configure({solo:'base',referenceOpacity:.6});
 target.scale.x*=-1;
 const reflectedRecipe=second.operations.recipe();await second.dispose();
 const reflected=await definition.create({host,inputs:reflectedRecipe,record(){}});
 assert.deepEqual(target.scale.toArray(),[-2,2,2],'reopen preserves the shared editor Flip X reflection');
 assert.deepEqual(target.position.toArray(),[3,4,5]);assert.equal(target.rotation.z,.4);
 assert.equal(reflected.read().solo,'base');assert.equal(reflected.read().referenceOpacity,.6);
 await reflected.operations.compute();
 const state=reflected.read(),sourceRow=registrations.get(state.sourceObjectId),guessRow=registrations.get(state.joints[0].guessObjectId),diagnostic=attachments.at(-5).root;
 registrations.delete(sourceRow.id);
 assert.match(reflected.read().status,/unavailable.*source/i,'removed source invalidates dependent claims');
 assert.equal(reflected.read().summary,null);assert.equal(diagnostic.visible,false);
 await assert.rejects(reflected.operations.compute(),/unavailable.*source/i);
 assert.throws(()=>reflected.operations.recipe(),/unavailable.*source/i,'retention cannot silently resurrect a removed carrier');
 registrations.set(sourceRow.id,sourceRow);assert.equal(reflected.read().status,'not computed','restored original registration permits recomputation');
 await reflected.operations.compute();assert.equal(reflected.read().status,'computed');
 const beforePose=reflected.read().alignment,calls=transformCalls;
 registrations.delete(guessRow.id);
 assert.equal(reflected.read().joints[0].available,false);
 await assert.rejects(reflected.operations.snapJoint(state.joints[0].id),/unavailable/i);
 assert.deepEqual(reflected.read().alignment,beforePose);assert.equal(transformCalls,calls,'refusal cannot enter transform history');
 const missingGuessRecipe=reflected.operations.recipe();assert.equal(missingGuessRecipe.jointGuesses[state.joints[0].id],null);
 registrations.set(guessRow.id,{id:guessRow.id,object:new T.Group()});
 assert.equal(reflected.read().joints[0].available,false,'reused id with another root is not the original correspondence');
 registrations.set(guessRow.id,guessRow);assert.equal(reflected.read().joints[0].available,true);
 guessRow.object.scale.z=0;
 await assert.rejects(reflected.operations.snapJoint(state.joints[0].id),/guess axis/);
 assert.deepEqual(reflected.read().alignment,beforePose);assert.equal(transformCalls,calls);
 const targetRow=registrations.get('target');registrations.delete('target');assert.match(reflected.read().status,/unavailable.*target/i);assert.equal(diagnostic.visible,false);registrations.set('target',targetRow);
 await reflected.dispose();
 const withoutGuess=await definition.create({host,inputs:missingGuessRecipe,record(){}});assert.equal(withoutGuess.read().joints.some(j=>j.id===state.joints[0].id),false,'reopen preserves removed correspondence');await withoutGuess.dispose();
}finally{globalThis.fetch=oldFetch;}
console.log('registration experiment retains target placement with the comparison');
