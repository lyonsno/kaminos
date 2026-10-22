// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import definition from '../experiments/part-claims.experiment.mjs';
const source={objects:[{id:'box',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters:{width:2,height:2,depth:2}},transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}],provenance:{analyticalCarrier:{parts:{base:['box']}}}};
const oldFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>source});
let target,view={position:[2,2,2],target:[0,0,0]},refreshes=0;
const host={scene:{refreshPresentation:()=>{refreshes++;},open:async()=>({
 loadAsset:async()=>{target=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());return {id:'target',root:target};},
 attach:async()=>{},redraw(){},onFrame:()=>()=>{},setView:v=>{view=v;},readView:()=>view,dispose:async()=>{},
})}};
try{
 const first=await definition.create({host,inputs:{},record(){}});
 target.position.set(3,4,5);target.rotation.z=.4;target.scale.setScalar(2);
 const recipe=first.operations.recipe();await first.dispose();
 const second=await definition.create({host,inputs:recipe,record(){}});
 assert.deepEqual(target.position.toArray(),[3,4,5],'reopen preserves edited target placement');
 assert.equal(target.rotation.z,.4);assert.deepEqual(target.scale.toArray(),[2,2,2]);assert.equal(refreshes,1);
 await second.dispose();
}finally{globalThis.fetch=oldFetch;}
console.log('registration experiment retains target placement with the comparison');
