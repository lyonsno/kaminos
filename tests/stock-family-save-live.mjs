// kaminos-test: node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import experiment from '../experiments/stock-family.experiment.mjs';
import {Group} from '../lib/three.core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';

function glb(height){
 const arrays=[new Float32Array([-.1,0,-.5,.1,0,-.5,0,height,.5]),new Float32Array([0,1,0,0,1,0,0,1,0]),new Float32Array([0,0,1,0,.5,1])];
 const bin=Buffer.concat(arrays.map(a=>Buffer.from(a.buffer))),views=[];let offset=0;for(const a of arrays){views.push({buffer:0,byteOffset:offset,byteLength:a.byteLength});offset+=a.byteLength;}
 const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-.1,0,-.5],max:[.1,height,.5]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'}],materials:[{}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0}));
 const padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),result=Buffer.alloc(28+padded.length+bin.length);result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(padded.length,12);result.writeUInt32LE(0x4e4f534a,16);padded.copy(result,20);result.writeUInt32LE(bin.length,20+padded.length);result.writeUInt32LE(0x004e4942,24+padded.length);bin.copy(result,28+padded.length);return result;
}
const originalFetch=globalThis.fetch,files=new Map(),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),canonical=bytes=>`/api/read?root=generated-meshes&path=${sha(bytes)}.glb`;
const primary=glb(.1),post=glb(.2);files.set('/primary.glb',primary);files.set('/temporary-support.glb',post);
globalThis.fetch=async(url,options={})=>{
 if(files.has(url))return new Response(files.get(url));
 if(url==='/api/ingest-mesh'){const bytes=Buffer.from(options.body);files.set(canonical(bytes),bytes);return Response.json({schema:'kaminos.generated-mesh.v0',sha256:sha(bytes),bytes:bytes.length,source:canonical(bytes)});}
 if(url==='/api/stock-families'){const input=JSON.parse(options.body);return Response.json({schema:'kaminos.stock-family-asset.v1',id:input.id??'12345678-1234-1234-1234-123456789abc',name:input.name,revision:'a'.repeat(64),recipe:input.recipe});}
 return new Response('not found',{status:404});
};
const scene=new Group(),roots=new Map(),pose=root=>({position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()});
const edits=createSceneEdits({read:id=>roots.has(id)?pose(roots.get(id)):null,write:(id,p)=>{const root=roots.get(id);root.position.fromArray(p.position);root.rotation.set(...p.rotation);root.scale.fromArray(p.scale);}});
const win={kaminosSceneEdits:edits,kaminosSelection:{set(){}},kaminosSceneAuthoring:{read:()=>({groups:[]})}};
let view={position:[2,2,2],target:[0,0,0]},serial=0,owner;
const session={attach:async root=>{const id='fixture-'+(++serial);scene.add(root);roots.set(id,root);return {id,root};},readView:()=>view,setView:v=>view=v,redraw(){},dispose:async()=>{for(const root of roots.values())root.removeFromParent();}};
const source=(url,bytes)=>({url,sha256:sha(bytes),profile:{min:-.5,max:.5,xMin:-.1,xMax:.1,locks:[]}});
try{
 owner=await experiment.create({host:{scene:{open:async()=>session,refreshPresentation(){}},controls:{document:{defaultView:win,querySelectorAll:()=>[]},mountObject(){}}},inputs:{recipe:{schema:'kaminos.stock-family.v1',source:source('/primary.glb',primary),variants:[{id:'one',label:'One',length:1,bend:0,protect:false}],supports:[{label:'Post',source:source('/temporary-support.glb',post),pose:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]}}});
 const saved=await owner.operations.save({name:'Supported'});assert.equal(saved.recipe.supports[0].source.url,canonical(post));
 files.delete('/temporary-support.glb');
 await owner.operations.set({id:'one',length:1.2});
 await owner.operations.save({name:'Supported'});
 assert.equal(owner.operations.export().supports[0].source.url,canonical(post));
 console.log('live stock save: retained support URLs survive expiry of the original locator and continued editing');
}finally{await owner?.dispose();globalThis.fetch=originalFetch;}
