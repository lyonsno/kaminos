// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {encodeGlb} from '../poly-glb-io.mjs';import {createTrellisTrainingSource} from '../trellis-training-source.mjs';import {withKaminosGpu} from '../tools/shader-herder.mjs';
function shellFixture(){
 const positions=[],normals=[],uvs=[];const add=(x0,x1,z0,z1,y,up)=>{const a=[x0,y,z0],b=[x1,y,z1],c=[x1,y,z0],d=[x0,y,z1];for(const tri of [[a,b,c],[a,d,b]])for(const p of up?tri:[tri[0],tri[2],tri[1]]){positions.push(...p);normals.push(0,up?1:-1,0);uvs.push(.25,.25);}};
 add(-1,1,-1,1,.1,true);for(let y=0;y<3;y++)for(let x=0;x<3;x++)add(-1+x*2/3,-1+(x+1)*2/3,-1+y*2/3,-1+(y+1)*2/3,-.1,false);
 const arrays=[new Float32Array(positions),new Float32Array(normals),new Float32Array(uvs),Uint32Array.from({length:positions.length/3},(_,i)=>i)],chunks=[],views=[],accessors=[];let offset=0;
 arrays.forEach((a,i)=>{chunks.push(new Uint8Array(a.buffer));views.push({buffer:0,byteOffset:offset,byteLength:a.byteLength});accessors.push({bufferView:i,componentType:i===3?5125:5126,count:i===3?a.length:a.length/(i===2?2:3),type:i===3?'SCALAR':i===2?'VEC2':'VEC3'});offset+=a.byteLength;});const bin=new Uint8Array(offset);let at=0;for(const a of chunks){bin.set(a,at);at+=a.length;}
 return encodeGlb({asset:{version:'2.0'},buffers:[{byteLength:offset}],bufferViews:views,accessors,nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],roughnessFactor:1,metallicFactor:0}}]},bin);
}
test('panel sampling plane follows the first visible surface rather than a more densely tessellated underside',async()=>{
 await withKaminosGpu(async({device})=>{let source;try{source=await createTrellisTrainingSource(device,shellFixture(),{region:{origin:[0,0,0],normal:[0,1,0],tangent:[1,0,0],radius:.5,depth:.4,top:.2},tileSize:.5});assert.ok(Math.abs(source.capture.samplingPlaneHeight-.1)<1e-6,`visible surface .1, got ${source.capture.samplingPlaneHeight}`);}finally{source?.dispose();}});
});
test('raw aligned material rows are the teacher, rather than a reduced GLB fallback',async()=>{
 await withKaminosGpu(async({device})=>{let source;try{
  const rawSource={positions:new Float32Array([-1,.1,-1,1,.1,1,1,.1,-1,-1,.1,1]),indices:new Uint32Array([0,1,2,0,3,1]),normals:new Float32Array([0,1,0,0,1,0,0,1,0,0,1,0]),materialRows:new Float32Array([1,0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,1,1])};
  source=await createTrellisTrainingSource(device,shellFixture(),{rawSource,region:{origin:[0,0,0],normal:[0,1,0],tangent:[1,0,0],radius:.5,depth:.4,top:.2},tileSize:.5});
  const rgb=await source.teacher.evaluateMaterial(new Float32Array([.5,.5,0,0,0,0,0,0]),{...source.capture,resolution:32,samples:1});
  assert.ok(rgb[0]>rgb[1]*10,`provided raw material is red, received ${Array.from(rgb)}`);
  assert.equal(source.source.route,'raw-aligned-fields');
 }finally{source?.dispose();}});
});
test('coverage labels distinguish source hits from support exits',async()=>{
 await withKaminosGpu(async({device})=>{let source;try{source=await createTrellisTrainingSource(device,shellFixture(),{region:{origin:[0,0,0],normal:[0,1,0],tangent:[1,0,0],radius:.5,depth:.4,top:.2},tileSize:.5});const labels=await source.teacher.evaluateMaterial(new Float32Array([.5,.5,0,0,0,0,0,0,10,10,0,0,0,0,0,0]),{...source.capture,resolution:32,samples:1,coverage:true});assert.equal(labels.length,8,'coverage query returns RGB plus coverage per query');assert.equal(labels[3],1);assert.equal(labels[7],0);}finally{source?.dispose();}});
});

test('a preselected raw source cannot silently supply a different support region',async()=>{
 const {createRawTrellisTrainingSource}=await import('../trellis-raw-training-source.mjs');
 const region={origin:[0,0,0],normal:[0,1,0],tangent:[1,0,0],radius:.5,depth:.4,top:.2};
 const rawSource={positions:new Float32Array([0,0,0]),indices:new Uint32Array([0,0,0]),normals:new Float32Array([0,1,0]),materialRows:new Float32Array([1,0,0,0,1,1]),provenance:{region:{...region,radius:.1}}};
 await assert.rejects(createRawTrellisTrainingSource({},rawSource,{region,tileSize:.5}),/Raw manifest region mismatch/);
});
test('raw optics clamp after barycentric interpolation, like the existing raw-field mesh',async()=>{
 await withKaminosGpu(async({device})=>{let source;try{
  const rawSource={positions:new Float32Array([-1,.1,-1,1,.1,1,1,.1,-1,-1,.1,1]),indices:new Uint32Array([0,1,2,0,3,1]),normals:new Float32Array([0,1,0,0,1,0,0,1,0,0,1,0]),materialRows:new Float32Array([1,0,0,-1,1,1,1,0,0,1,1,1,1,0,0,1,1,1,1,0,0,-1,1,1])};
  source=await createTrellisTrainingSource(device,shellFixture(),{rawSource,region:{origin:[0,0,0],normal:[0,1,0],tangent:[1,0,0],radius:.5,depth:.4,top:.2},tileSize:.5});
  const rgb=await source.teacher.evaluateMaterial(new Float32Array([.5,.5,0,0,0,0,0,0]),{...source.capture,resolution:1000000,samples:1});
  assert.ok(Math.abs(rgb[0]-.97/Math.PI)<1e-5,`center interpolates raw metallic to zero before clamping; expected ${.97/Math.PI}, received ${rgb[0]}`);
 }finally{source?.dispose();}});
});

test('an explicit support-top raw carrier encloses relief instead of passing through its center hit',async()=>{
 await withKaminosGpu(async({device})=>{let source;try{
  const rawSource={positions:new Float32Array([-1,.1,-1,1,.1,1,1,.1,-1,-1,.1,1]),indices:new Uint32Array([0,1,2,0,3,1]),normals:new Float32Array([0,1,0,0,1,0,0,1,0,0,1,0]),materialRows:new Float32Array([1,0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,1,1])};
  source=await createTrellisTrainingSource(device,shellFixture(),{rawSource,region:{origin:[0,0,0],normal:[0,1,0],tangent:[1,0,0],radius:.5,depth:.4,top:.2},tileSize:.5,samplingPlane:'support-top'});
  assert.ok(Math.abs(source.capture.samplingPlaneHeight-.2)<1e-6,`support top .2, got ${source.capture.samplingPlaneHeight}`);
  assert.equal(source.source.samplingPlaneSelection.method,'support top; all clipped source vertices inset or flush');
  assert.ok(source.triangles.every(t=>[t.a,t.b,t.c].every(p=>p[1]<=source.capture.samplingPlaneHeight+1e-6)));
  const labels=await source.teacher.evaluateMaterial(new Float32Array([.5,.5,0,0,0,0,0,0]),{...source.capture,resolution:32,samples:1,coverage:true});
  assert.equal(labels[3],1);assert.ok(labels[0]>labels[1]*10,'explicit carrier keeps actual red source response');
 }finally{source?.dispose();}});
});

test('unknown raw sampling-plane selections refuse before source work',async()=>{
 const {createRawTrellisTrainingSource}=await import('../trellis-raw-training-source.mjs');
 const rawSource={positions:new Float32Array([0,0,0]),indices:new Uint32Array([0,0,0]),normals:new Float32Array([0,1,0]),materialRows:new Float32Array([1,0,0,0,1,1])};
 await assert.rejects(createRawTrellisTrainingSource({},rawSource,{region:{origin:[0,0,0],normal:[0,1,0],tangent:[1,0,0],radius:.5,depth:.4,top:.2},tileSize:.5,samplingPlane:'misspelled-top'}),/Unknown raw sampling plane/);
});
