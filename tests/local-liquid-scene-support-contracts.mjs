// kaminos-test: node
import assert from 'node:assert/strict';
import {defaultLocalLiquidSetup,normalizeLocalLiquidSetup} from '../local-liquid-setup.mjs';
assert.equal(defaultLocalLiquidSetup().support,'scene_primitives','new authored water must not acquire the fixed playground');
assert.equal(normalizeLocalLiquidSetup({...defaultLocalLiquidSetup(),support:'retained_analytical_basin'}).support,'retained_analytical_basin','explicit legacy scenes remain reconstructible');
const {sceneLiquidCollider,sceneLiquidDistance,packSceneLiquidColliders,SCENE_LIQUID_SUPPORT_WGSL}=await import('../scene-liquid-support.mjs');
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const shape=(kind,parameters={},transform=pose)=>sceneLiquidCollider({id:'shape',type:'procedural-mesh',geometry:{kind,parameters},transform});
const sphere=shape('sphere',{radius:1});
assert.equal(sceneLiquidDistance(sphere,[0,2,0]).distance,1);
assert.equal(sceneLiquidDistance(sphere,[0,0,0]).distance,-1);
const bowl=shape('bowl',{radius:1,thickness:.1});
assert.ok(sceneLiquidDistance(bowl,[0,0,0]).distance>.8,'bowl interior is air');
assert.ok(sceneLiquidDistance(bowl,[0,1,0]).distance>.8,'bowl mouth stays open');
assert.ok(sceneLiquidDistance(bowl,[0,-.98,0]).distance<0,'shell wall is solid');
assert.deepEqual(sceneLiquidDistance(bowl,[0,-.94,0]).normal,[0,1,0],'inner wall pushes fluid into bowl');
assert.deepEqual(sceneLiquidDistance(bowl,[0,-1.02,0]).normal,[0,-1,0],'outer wall pushes fluid outside');
const plane=shape('plane',{width:2,depth:2});
assert.equal(sceneLiquidDistance(plane,[0,-.2,0]).distance,-.2,'finite plane stops a downward crossing');
assert.ok(sceneLiquidDistance(plane,[3,-.2,0]).distance>1,'plane must not create an infinite hidden floor');
const translated=shape('sphere',{radius:1},{...pose,position:[2,1,0],scale:[2,2,2]});
assert.equal(sceneLiquidDistance(translated,[2,4,0]).distance,1);
assert.throws(()=>shape('sphere',{radius:1},{...pose,scale:[1,2,1]}),/uniform scale/);
assert.equal(sceneLiquidCollider({id:'off',type:'procedural-mesh',waterCollision:false,geometry:{kind:'sphere'},transform:pose}),null);
assert.equal(packSceneLiquidColliders([sphere,bowl,plane]).length,3*20);
assert.ok(SCENE_LIQUID_SUPPORT_WGSL.includes('analyticObstacleSupportEnabled: bool = false'),'authored collision route cannot retain hidden analytic sphere');
console.log('authored sphere, finite plane and open bowl collision contracts passed');
const {buildSceneDocument,planSceneRestore}=await import('../scene-persistence-core.js');
const saved=buildSceneDocument({objects:[{id:'bowl',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'bowl',parameters:{radius:.8,thickness:.1}},transform:pose,waterCollision:false}],localLiquid:defaultLocalLiquidSetup()});
const restored=planSceneRestore(saved);
assert.equal(restored.localLiquid.support,'scene_primitives');assert.equal(restored.objects[0].waterCollision,false);assert.equal(restored.objects[0].geometry.kind,'bowl');
// Viewport presentation may mask an object/group around the actual host step.
const {Object3D,Group}=await import('../lib/three.core.js');
const {withViewportVisibility,sceneItemVisible}=await import('../scene-visibility.mjs');
const {createSceneLiquidSupport}=await import('../scene-liquid-support.mjs');
const priorBufferUsage=globalThis.GPUBufferUsage,priorTextureUsage=globalThis.GPUTextureUsage;
globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};
try{
 const object=new Object3D(),parent=new Group();parent.add(object);
 const record={id:'contained-bowl',type:'procedural-mesh',geometry:{kind:'bowl',parameters:{radius:1,thickness:.1}},object};
 const scene={objects:[record],groups:[{id:'vessels',objectIds:[record.id]}]};
 const device={limits:{maxTextureDimension2D:8192},createBuffer:()=>({destroy(){}}),createTexture:({size})=>({height:size[1],createView:()=>({}),destroy(){}}),queue:{writeTexture(){},writeBuffer(){}}};
 const support=createSceneLiquidSupport(device,[record]);
 for(const hidden of [[record.id],['@group:vessels']]){
  withViewportVisibility([record],id=>sceneItemVisible(id,hidden,scene),()=>{
   assert.equal(object.visible,false,'actual presentation wrapper must mask collider');
   support.update([record]);assert.deepEqual(support.read().memberIds,[record.id],'viewport hiding must retain water collision');
  });
  assert.equal(object.visible,true);assert.equal(support.read().generation,1,'presentation alone must not republish collider membership');
 }
 parent.visible=false;support.update([record]);assert.deepEqual(support.read().memberIds,[record.id],'hidden ancestor is presentation, not collider enablement');
 record.waterCollision=false;support.update([record]);assert.deepEqual(support.read().memberIds,[],'authored collision toggle removes support independently of visibility');
 support.dispose();
}finally{globalThis.GPUBufferUsage=priorBufferUsage;globalThis.GPUTextureUsage=priorTextureUsage;}
