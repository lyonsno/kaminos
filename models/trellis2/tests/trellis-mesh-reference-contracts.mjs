import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildSLatDecoderPlan,slatDecoderWeightShapes} from '../slat-decoder.js';
import {SLAT_DECODER_REFERENCE_ROUTE,validateSLatDecoderFixture} from '../slat-decoder-witness-checks.js';
import {extractTrellisDualGridMesh} from '../trellis-mesh.js';
const hash=a=>createHash('sha256').update(a).digest('hex'),config={tokenRows:3,latentChannels:2,resolution:2,channels:[16,8],numBlocks:[1,0],mode:'shape'},
  p=buildSLatDecoderPlan(config),weights=slatDecoderWeightShapes(p),identity={commit:'b'.repeat(40),dirty:''},
  row=(name,shape,integer=false,half=false)=>({file:name+'.raw',shape,dtype:integer?'int32':'float32',
    sourceDtype:integer?'int32':half?'float16':'float32',byteLength:shape.reduce((a,b)=>a*b,4),sha256:'a'.repeat(64)}),
  d={schema:'trellis2.slat-decoder-reference.v0',status:'succeeded',referenceRoute:SLAT_DECODER_REFERENCE_ROUTE,config,
    fixtureKind:'synthetic-operation-conformance',modelCalls:1,convolutionsExecuted:3,outputRows:12,outputResolution:4,subdivisionRows:[[3,8]],
    parameterCount:Object.values(weights).reduce((n,s)=>n+s.reduce((a,b)=>a*b,1),0),source:identity,sourceAfter:identity,producer:identity,producerAfter:identity,
    effectiveBackend:{device:'Device(gpu, 0)',arithmetic:p.arithmetic,weightLayout:p.weightLayout,normEpsilon:1e-6,terminalNormEpsilon:1e-5,
      sourceModel:'actual SLatDecoder.__call__',route:{decoder_linear_backend:'native',sparse_conv_matmul_backend:'native',
        decoder_silu:{backend:'mlx-native'},decoder_layernorm:{backend:'mlx-fast-layer-norm'}}},
    tensors:{sample:row('sample',[3,2]),coordinates:row('coordinates',[3,3],true),silu:row('silu',[65536],false,true),halfInputs:row('halfInputs',[65536]),
      'expected.features':row('expected.features',[12,7]),'expected.coordinates':row('expected.coordinates',[12,3],true),
      'expected.subdivision0':row('expected.subdivision0',[3,8],false,true),
      ...Object.fromEntries(Object.entries(weights).map(([n,s])=>['weight.'+n,row('weight.'+n,s,false,n.startsWith('blocks.'))]))}},
  features=new Float32Array(84),coordinates=new Int32Array([0,0,0,0,0,1,0,1,1,0,1,0,...Array.from({length:8},(_,i)=>[2,Math.floor(i/4),i%4]).flat()]);
features[3]=1;const mesh=extractTrellisDualGridMesh({features,coordinates,resolution:4});
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-mesh-admission-'));
try {
  const dr=path.join(folder,'decoder'),mr=path.join(folder,'mesh');await fs.mkdir(dr);await fs.mkdir(mr);
  for(const [n,a] of [['features',features],['coordinates',coordinates]]){await fs.writeFile(path.join(dr,'expected.'+n+'.raw'),a);d.tensors['expected.'+n].sha256=hash(a);}
  validateSLatDecoderFixture(d);
  const m={schema:'trellis2.mesh-reference.v0',status:'succeeded',effectiveRoute:'pinned-MLX-source-CUDA-exp-sigmoid/NumPy-dual-grid-topology',
    source:identity,sourceAfter:identity,producer:identity,producerAfter:identity,device:'Device(gpu, 0)',modelCalls:0,resolution:4,voxelMargin:.5,
    surfaceEmpty:false,vertexCount:12,triangleCount:2,tensors:{'input.features':{...d.tensors['expected.features'],dtype:'<f4'},
      'input.coordinates':{...d.tensors['expected.coordinates'],dtype:'<i4'}}};
  for(const [n,a,dtype] of [['vertices',mesh.vertices,'float32'],['triangles',mesh.triangles,'uint32']]){
    await fs.writeFile(path.join(mr,n+'.raw'),a);m.tensors[n]={file:n+'.raw',shape:[a.length/3,3],byteLength:a.byteLength,sha256:hash(a),dtype};
  }
  const run=async(name,decoder=d,reference=m)=>{
    const db=JSON.stringify(decoder),mb=JSON.stringify({...reference,decoderReference:{sha256:hash(db)}}),out=path.join(folder,name);
    await fs.writeFile(path.join(dr,'manifest.json'),db);await fs.writeFile(path.join(mr,'manifest.json'),mb);
    const command=spawnSync(process.execPath,[new URL('../compare-trellis-mesh.mjs',import.meta.url).pathname,
      '--decoder-reference',dr,'--mesh-reference',mr,'--out',out],{encoding:'utf8'});
    return {command,report:JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'))};
  };
  assert.equal((await run('valid')).report.status,'succeeded','Local complete valid control must remain admitted.');
  for(const [name,change] of [['dtype',a=>a.tensors['expected.features'].dtype='int32'],['device',a=>a.effectiveBackend.device='Device(cpu, 0)']]){
    const changed=structuredClone(d);change(changed);assert.throws(()=>validateSLatDecoderFixture(changed));
    const result=await run(name,changed);assert.equal(result.report.status,'failed','Actual CLI must reject conflicting '+name+' metadata.');
    assert.notEqual(result.command.status,0);assert.equal(result.report.phase,'reference-admission');assert.ok(result.report.error);
  }
  for(const change of [a=>a.tensors.vertices.dtype='int32',a=>a.tensors.triangles.shape=[1,6],a=>a.tensors.vertices.byteLength-=4]){
    const changed=structuredClone(m);change(changed);assert.equal((await run('mesh-conflict',d,changed)).report.status,'failed');
  }
  const future=structuredClone(m);future.additiveMetadata='compatible';assert.equal((await run('additive',d,future)).report.status,'succeeded');
}finally{await fs.rm(folder,{recursive:true,force:true});}
console.log('Actual conversion CLI rejects conflicting decoder dtype/backend and mesh descriptor semantics; local admission controls, not GPU conformance.');
