// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {Matrix4,Scene,Vector3} from '../lib/three.core.js';
import {checkedParticleInspectionView,particleInspectionProjection} from '../volume-particle-inspection.mjs';
import {createParticleIntegralDirection} from '../experiments/particle-integral-direction.mjs';
const view={position:[0,0,5],target:[0,0,0],up:[0,1,0],fov:50,near:.1,far:100,zoom:1};
test('world optical view maps the physical domain through an invertible projection',()=>{
 const frame={translate:[3,2,1],scale:2},p=particleInspectionProjection(view,frame,4/3);
 const m=new Matrix4().fromArray(p.viewProj),inverse=new Matrix4().fromArray(p.inverse);
 const product=m.clone().multiply(inverse).elements;product.forEach((v,i)=>assert.ok(Math.abs(v-(i%5===0?1:0))<1e-10));
 assert.deepEqual(checkedParticleInspectionView(view),view);assert.throws(()=>checkedParticleInspectionView({...view,position:[0,0,0]}),/aim/);
 assert.throws(()=>particleInspectionProjection(view,{...frame,scale:0},1),/domain/);
 assert.ok(new Vector3().applyMatrix4(m).distanceTo(new Vector3(...frame.translate).applyMatrix4(new Matrix4().fromArray(particleInspectionProjection(view,{translate:[0,0,0],scale:1},4/3).viewProj)))<1e-10);
});
test('one native scene transform drives all optical receivers independently from playback and the viewing camera',async()=>{
 const scene=new Scene(),calls=[],changed=[],selected=[];let owner={setOpticalParticleView:v=>calls.push(v)};
 const session={attach:async(root,options)=>{assert.equal(options.owned,true);scene.add(root);return {id:'integral-arrow',root};},redraw(){}};
 const h=await createParticleIntegralDirection({session,view,runtime:()=>owner,select:id=>selected.push(id),onChange:v=>changed.push(v)});
 h.enable();assert.deepEqual(h.view(),view);assert.equal(selected.at(-1),'integral-arrow');const start=calls.length;h.sync();assert.equal(calls.length,start,'unchanged frames have no runtime update');
 h.root.rotation.y=Math.PI/2;h.root.position.x=2;h.sync();const rotated=calls.at(-1);assert.deepEqual(rotated.target,[2,0,0]);assert.ok(Math.abs(rotated.position[0]-7)<1e-10);assert.ok(Math.abs(rotated.position[2])<1e-10);assert.equal(changed.at(-1),rotated);
 owner={setOpticalParticleView:v=>calls.push(v)};h.sync();assert.equal(calls.length,start+2,'replacement runtime receives the same current optical pose');
 h.disable();assert.equal(calls.at(-1),null);assert.equal(h.view(),null);h.root.rotation.y=0;h.sync();assert.equal(calls.at(-1),null);h.enable();assert.ok(h.view());
});

import {buildSceneDocument} from '../scene-persistence-core.js';
import {defaultSceneRecordOperations} from '../scene-record-operations.mjs';
test('native optical handles stay selectable but their pose is saved only in the experiment setup',()=>{
 const helper={id:'arrow',type:'experiment',source:'optical-particles:integral-direction',fileName:'Integral direction'};
 assert.equal(defaultSceneRecordOperations.reloadable(helper),false,'the editor helper is not an independent scene asset');
 const d=buildSceneDocument({objects:[helper],activeObjectId:'arrow',selectionIds:['arrow'],transientObjectIds:['arrow'],opticalParticleSetup:{particles:{enabled:true},integralView:view}});
 assert.deepEqual(d.objects,[]);assert.equal(d.activeObjectId,null);assert.deepEqual(d.selectionIds,[]);
 defaultSceneRecordOperations.assertReloadable(d.objects);assert.deepEqual(d.opticalParticleSetup.integralView,view);
});

test('an undeclared unsupported object still fails scene admission',()=>{
 const d=buildSceneDocument({objects:[{id:'other',type:'experiment',source:'unsupported'}],transientObjectIds:['arrow']});
 assert.equal(d.objects.length,1);assert.throws(()=>defaultSceneRecordOperations.assertReloadable(d.objects),/re-dropped/);
});
