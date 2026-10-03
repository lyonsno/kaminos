import assert from 'node:assert/strict';
import * as stages from '../sparse-decoder.js';
assert.equal(typeof stages.createTrellisMeshAdapter,'function');
assert.equal(typeof stages.sampleTrellisMaterial,'function',
  'The real six-channel decoder result must supply sampled learned PBR attributes, not a neutral geometry material.');
const coordinates=new Int32Array([0,0,0,0,0,1]),features=new Float32Array([-1,0,1,-.5,.5,1, 1,0,-1,.5,-.5,-1]);
const samples=stages.sampleTrellisMaterial({positions:new Float32Array([-.25,-.25,0]),coordinates,features,resolution:2});
assert.deepEqual([...samples],[.5,.5,.5,.5,.5,.5]);
assert.throws(()=>stages.sampleTrellisMaterial({positions:new Float32Array(3),coordinates,features:features.slice(1),resolution:2}),/complete/);
assert.throws(()=>stages.sampleTrellisMaterial({positions:new Float32Array([NaN,0,0]),coordinates,features,resolution:2}),/finite/);
assert.throws(()=>stages.sampleTrellisMaterial({positions:new Float32Array(3),coordinates:new Int32Array([0,0,0,0,0,0]),features,resolution:2}),/duplicate/);
const mesh={vertices:new Float32Array([-.25,-.25,-.25,-.25,-.25,.25,-.25,.25,-.25]),
  triangles:new Uint32Array([0,1,2]),uvs:new Float32Array([0,0,1,0,0,1])};
const baked=stages.bakeTrellisMaterialTextures({...mesh,coordinates,features,resolution:2,textureSize:4});
assert.equal(baked.baseColor.length,64);assert.equal(baked.metallicRoughness.length,64);
assert.ok(baked.coveredPixels>0);assert.ok(baked.coveredPixels<16);
assert.equal(baked.alphaMode,'OPAQUE');
assert.ok(baked.metallicRoughness.every((v,i)=>i%4===0?v===0:i%4===3?v===255:true));
assert.throws(()=>stages.bakeTrellisMaterialTextures({...mesh,uvs:new Float32Array(2),coordinates,features,resolution:2}),/complete/);
assert.throws(()=>stages.bakeTrellisMaterialTextures({...mesh,uvs:new Float32Array([0,0,0,0,0,0]),coordinates,features,resolution:2,textureSize:4}),/covered/);
const png=await stages.encodeTrellisTexturePNG({pixels:new Uint8Array([255,127,63,0]),width:1,height:1});
const {inflateSync}=await import('node:zlib');const p=new Uint8Array(png),v=new DataView(p.buffer,p.byteOffset,p.byteLength);
assert.deepEqual([...p.slice(0,8)],[137,80,78,71,13,10,26,10]);
let offset=8,idat;while(offset<p.length){const n=v.getUint32(offset),type=new TextDecoder().decode(p.subarray(offset+4,offset+8));
  if(type==='IDAT')idat=p.subarray(offset+8,offset+8+n);offset+=n+12;}
assert.deepEqual([...inflateSync(idat)],[0,255,127,63,0],'PNG must preserve unpremultiplied learned RGB even when alpha is zero.');
const glb=await stages.encodeTrellisPbrGLB(mesh,{textures:baked,provenance:{route:'test-only'}}),header=new DataView(glb),
  jsonLength=header.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,jsonLength)));
assert.equal(doc.meshes[0].primitives[0].attributes.TEXCOORD_0,3);
assert.equal(doc.materials[0].pbrMetallicRoughness.baseColorTexture.index,0);
assert.equal(doc.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.index,1);
assert.equal(doc.materials[0].alphaMode,'OPAQUE');assert.equal(doc.images.length,2);
assert.equal(doc.extras.trellis.material,'learned RGB/metallic/roughness/alpha textures');
assert.equal(header.getUint32(8,true),glb.byteLength);
const outputIndex=process.argv.indexOf('--asset-output');
if(outputIndex>=0){
  if(!process.argv[outputIndex+1])throw Error('explicit synthetic asset output path required');
  const {writeFile}=await import('node:fs/promises');await writeFile(process.argv[outputIndex+1],new Uint8Array(glb));
}
const {readFile}=await import('node:fs/promises'),observed=JSON.parse(await readFile(new URL('./fixtures/trellis-material-source.json',import.meta.url),'utf8'));
assert.equal(observed.source.commit,'34a7a570d5d6d8b9c99bbddb1d52bd414600d5c6');assert.equal(observed.source.modelCalls,0);
for(const c of observed.samples){
  const actual=stages.sampleTrellisMaterial({positions:new Float32Array(c.positions),coordinates:new Int32Array(c.coordinates),
    features:new Float32Array(c.features),resolution:c.resolution});
  assert.equal(actual.length,c.expected.length);
  for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-c.expected[i])<2e-7,c.name+' source sample '+i);
}
const raster=observed.raster,actualRaster=stages.rasterizeTrellisMaterialUV({vertices:new Float32Array(raster.uvs.length/2*3),
  triangles:new Uint32Array(raster.triangles),uvs:new Float32Array(raster.uvs),textureSize:raster.textureSize});
assert.deepEqual([...actualRaster.faces],raster.faces);
for(let i=0;i<actualRaster.bary.length;i++)assert.ok(Math.abs(actualRaster.bary[i]-raster.bary[i])<2e-7,'source pixel barycentric '+i);
console.log('Six learned channels become complete sparse-sampled base RGBA and metallic/roughness textures, unpremultiplied PNG and embedded PBR GLB. Synthetic fields are not native model evidence.');
