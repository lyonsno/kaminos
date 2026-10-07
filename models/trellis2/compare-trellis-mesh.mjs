// Offline conversion conformance, using the same retained source features on
// both sides. This is neither native decoder parity nor a serving handoff.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {extractTrellisDualGridMesh,compareTrellisMeshes} from './trellis-mesh.js';
import {validateSLatDecoderFixture} from './slat-decoder-witness-checks.js';
const {values}=parseArgs({options:Object.fromEntries(['decoder-reference','mesh-reference','out'].map(n=>[n,{type:'string'}]))});
for(const name of ['decoder-reference','mesh-reference','out']) if(!values[name]) throw Error('--'+name+' required');
const out=path.resolve(values.out),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(out,{recursive:true});
const report={schema:'trellis2.mesh-conversion-conformance.v0',status:'failed',phase:'reference-admission',modelCalls:0,
  inputHandoff:'same saved source decoder arrays; offline mesh conversion only',vertexAbsoluteTolerance:1.2e-7,topology:'exact source triangle indices/order'};
try {
  const decoderRoot=await fs.realpath(values['decoder-reference']),meshRoot=await fs.realpath(values['mesh-reference']),
    decoderBytes=await fs.readFile(path.join(decoderRoot,'manifest.json')),meshBytes=await fs.readFile(path.join(meshRoot,'manifest.json')),
    d=JSON.parse(decoderBytes),m=JSON.parse(meshBytes);
  const plan=validateSLatDecoderFixture(d);
  if(d.status!=='succeeded'||d.schema!=='trellis2.slat-decoder-reference.v0'||m.status!=='succeeded'||m.schema!=='trellis2.mesh-reference.v0'||
    m.effectiveRoute!=='pinned-MLX-source-CUDA-exp-sigmoid/NumPy-dual-grid-topology'||m.source?.commit!==d.source?.commit||
    m.source?.dirty!==''||m.sourceAfter?.dirty!==''||m.sourceAfter?.commit!==m.source.commit||m.decoderReference?.sha256!==hash(decoderBytes)||
    plan.mode!=='shape'||m.device!=='Device(gpu, 0)'||m.resolution!==d.outputResolution||m.voxelMargin!==.5||m.modelCalls!==0||m.surfaceEmpty!==false)
    throw Error('complete actual-source matched-input mesh conversion required');
  for(const name of ['source','producer'])if(!/^[a-f0-9]{40}$/.test(m[name]?.commit??'')||m[name].dirty!==''||
    m[name+'After']?.commit!==m[name].commit||m[name+'After'].dirty!=='')throw Error('clean unchanged mesh source/producer required');
  for(const [name,count,dtype] of [['vertices',m.vertexCount,'float32'],['triangles',m.triangleCount,'uint32']]){
    const row=m.tensors?.[name];
    // v0 observed exporter has implicit F32 vertices/U32 triangles. A present
    // dtype may confirm that schema law but may never contradict it.
    if(!Number.isSafeInteger(count)||count<1||!row||JSON.stringify(row.shape)!==JSON.stringify([count,3])||
      row.byteLength!==count*12||!/^[a-f0-9]{64}$/.test(row.sha256??'')||!/^[\w.-]+$/.test(row.file??'')||
      (row.dtype!==undefined&&row.dtype!==dtype))throw Error('complete matching mesh descriptor '+name+' required');
  }
  for(const [name,dtype] of [['features','<f4'],['coordinates','<i4']]){
    const row=m.tensors?.['input.'+name],original=d.tensors['expected.'+name];
    if(row?.sha256!==original.sha256||row.dtype!==dtype||JSON.stringify(row.shape)!==JSON.stringify(original.shape))
      throw Error('identical learned geometry input semantics required');
  }
  report.reference={decoderManifestSha256:hash(decoderBytes),meshManifestSha256:hash(meshBytes),source:m.source,producer:m.producer,resolution:m.resolution};
  const read=async(root,descriptor,type)=>{
    if(!descriptor?.file||path.basename(descriptor.file)!==descriptor.file)throw Error('safe complete tensor path required');
    const bytes=await fs.readFile(path.join(root,descriptor.file));
    if(bytes.byteLength!==descriptor.byteLength||hash(bytes)!==descriptor.sha256)throw Error('complete hash-matched tensor required');
    return new type(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  };
  const features=await read(decoderRoot,d.tensors['expected.features'],Float32Array),coordinates=await read(decoderRoot,d.tensors['expected.coordinates'],Int32Array),
    expected={vertices:await read(meshRoot,m.tensors.vertices,Float32Array),triangles:await read(meshRoot,m.tensors.triangles,Uint32Array)};
  if(m.tensors['input.features'].sha256!==d.tensors['expected.features'].sha256||
    m.tensors['input.coordinates'].sha256!==d.tensors['expected.coordinates'].sha256)throw Error('identical learned geometry inputs required');
  report.phase='javascript-mesh-conversion';const started=performance.now(),
    mesh=extractTrellisDualGridMesh({features,coordinates,resolution:d.outputResolution});
  report.elapsedConversionMs=performance.now()-started;report.geometry=mesh.metadata;
  report.phase='mesh-output-retention';report.outputs={};
  for(const [name,array] of [['vertices',mesh.vertices],['triangles',mesh.triangles]]) {
    const file=path.join(out,name+(name==='vertices'?'.f32':'.u32')),bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
    await fs.writeFile(file,bytes);report.outputs[name]={path:file,byteLength:array.byteLength,sha256:hash(bytes)};
  }
  report.phase='matched-input-conversion-comparison';report.comparison=compareTrellisMeshes(mesh,expected);
  if(!report.comparison.passed)throw Error('matched-input mesh vertex/topology comparison failed');
  report.status='succeeded';report.phase=null;
} catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally {await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,phase:report.phase,comparison:report.comparison,error:report.error?.message,report:path.join(out,'report.json')}));
