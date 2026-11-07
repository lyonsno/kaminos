// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {installMountedGenerationWorkshop} from '../mounted-generation-workshop-page.mjs';
import {createWorkbenchFrameService} from '../workbench-scene-host.mjs';
test('prepared parts share the exact mesh visibility boundary on entry and Return',async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({schema:'kaminos.mounted-workshop.v1',objects:[{type:'glb',source:'fixture.glb',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},materials:[]}]})});
 const node=()=>({style:{},append(){},remove(){}}),document={createElement:node,getElementById:node,defaultView:{}};
 const frames=createWorkbenchFrameService(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1,.01,100),rows=[],seen=[];
 const host={onFrame:frames.onFrame,open:()=>({async attach(root,options){scene.add(root);const h={id:'kiln',root,source:options.metadata.source};rows.push(h);return h;},dispose(){}})};
 const workshop=installMountedGenerationWorkshop({document,THREE,host,camera,readView:()=>({position:[0,2,8],target:[0,0,0],fov:50,zoom:1}),loadGlb:async()=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());mesh.castShadow=true;return mesh;},selection:()=>({ids:[],activeId:null}),setSelection(){},find(){},applyMaterials(){},warm:async()=>{},redraw(){},prepareParts:async()=>({present:amount=>seen.push({amount,meshVisible:rows[0].root.visible}),dispose(){}})});
 try{await workshop.prepare();frames.tick(0);workshop.enter();frames.tick(100);assert.ok(seen.at(-1)?.amount>0,'parts must present on the first visible mesh frame');assert.equal(seen.at(-1).meshVisible,true);assert.equal(rows[0].root.castShadow,false,'partial presentation is outside binary static-shadow admission');frames.tick(2100);assert.equal(rows[0].root.material.transparent,false,'settled opaque workshop keeps its authored shadow contract');assert.equal(rows[0].root.material.opacity,1);assert.equal(rows[0].root.castShadow,true,'settled presentation restores authored shadow participation');workshop.exit();frames.tick(4200);assert.equal(workshop.read().phase,'closed');assert.deepEqual(seen.at(-1),{amount:0,meshVisible:false});}finally{await workshop.dispose();globalThis.fetch=originalFetch;}
});
