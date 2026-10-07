import assert from 'node:assert/strict';
import * as checks from '../sparse-generation-witness-checks.js';
import {encodeTrellisPbrGLB,bakeTrellisMaterialTextures} from '../trellis-material.js';
const sessionId='observed-native-session',inputManifestSha256='a'.repeat(64),
  report=()=>({fixtureSha256:inputManifestSha256,nativeSessionId:sessionId}),
  mesh={vertices:new Float32Array([0,0,0,0,.25,0,.25,0,0]),triangles:new Uint32Array([0,1,2]),uvs:new Float32Array([0,0,1,0,0,1])},
  textures=bakeTrellisMaterialTextures({...mesh,coordinates:new Int32Array([0,0,0]),features:new Float32Array(6),resolution:2,textureSize:4}),
  bytes=new Uint8Array(await encodeTrellisPbrGLB(mesh,{textures,provenance:{inputManifestSha256,sessionId,route:checks.GENERATION_ROUTE}}));
assert.equal(typeof checks.persistGenerationAsset,'function','The actual asset-output handler needs a tested complete, same-session PBR receipt.');
const writes=[],state=report(),saved=await checks.persistGenerationAsset({report:state,bytes,outputPath:'/owned/asset.glb',
  write:async(path,data)=>writes.push({path,data}),persist:async()=>{}});
assert.equal(saved.path,'/owned/asset.glb');assert.equal(saved.byteLength,bytes.length);assert.match(saved.sha256,/^[a-f0-9]{64}$/);
assert.equal(state.assetArtifact,saved);assert.deepEqual(writes[0].data,bytes);
function changed(edit){
  const h=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=h.getUint32(12,true),
    doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+n)));edit(doc);
  const json=new TextEncoder().encode(JSON.stringify(doc)),length=Math.ceil(json.length/4)*4,bin=bytes.subarray(20+n),
    out=new Uint8Array(20+length+bin.length),v=new DataView(out.buffer);
  out.set(bytes.subarray(0,20));v.setUint32(8,out.length,true);v.setUint32(12,length,true);
  out.fill(32,20,20+length);out.set(json,20);out.set(bin,20+length);return out;
}
for(const bad of [bytes.subarray(0,bytes.length-4),changed(d=>d.extras.trellis.provenance.sessionId='stale'),
  changed(d=>d.extras.trellis.provenance.inputManifestSha256='b'.repeat(64)),changed(d=>d.extras.trellis.provenance.route='fallback'),
  changed(d=>d.images=[{},{}]),changed(d=>d.images[0].uri='cached.png'),changed(d=>d.bufferViews[d.images[0].bufferView].byteLength=0),
  changed(d=>d.accessors[d.meshes[0].primitives[0].attributes.TEXCOORD_0].count=0),
  changed(d=>d.materials[0].pbrMetallicRoughness.baseColorTexture.index=99),changed(d=>d.buffers[0].byteLength=0)]){
  const badState=report();let wrote=false;
  await assert.rejects(checks.persistGenerationAsset({report:badState,bytes:bad,outputPath:'/owned/asset.glb',
    write:async()=>{wrote=true;},persist:async()=>{}}),/complete|identified|embedded|PBR/);
  assert.equal(wrote,false);assert.equal(badState.assetArtifact,undefined);
}
const failed=report();await assert.rejects(checks.persistGenerationAsset({report:failed,bytes,outputPath:'/owned/asset.glb',
  write:async()=>{throw Error('actual write failure');},persist:async()=>{}}),/actual write failure/);
assert.equal(failed.assetArtifact,undefined);
console.log('Production asset receipt rejects truncated, stale-session, wrong-route/source, missing embedded images/UVs and invalid PBR references before retention; failed writes publish no artifact. Synthetic asset bytes are not native generation.');
