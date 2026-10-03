import {validateGenerationInputs} from './generation-inputs.js';
import {buildSparseSamplerPlan} from './sparse-sampler.js';
import {buildSLatSamplerPlan} from './slat-sampler.js';
import {validateNativePrefixBackend} from './sparse-prefix-witness-checks.js';
export const GENERATION_ROUTE='trellis2.image-generation.webgpu.v0';
// This is the producer's finite embedded-asset contract, not a general glTF
// validator or a claim of model fidelity, inspection, placement or persistence.
export async function persistGenerationAsset({report,bytes,outputPath,write,persist}){
  if(!(bytes instanceof Uint8Array)||bytes.length<28)throw Error('complete learned GLB2 asset required');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=view.getUint32(12,true),binStart=28+n;
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length||
    n%4||view.getUint32(16,true)!==0x4e4f534a||binStart>bytes.length||
    view.getUint32(24+n,true)!==0x004e4942||view.getUint32(20+n,true)!==bytes.length-binStart)
    throw Error('complete learned GLB2 document and binary required');
  const doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+n))),info=doc.extras?.trellis,
    provenance=info?.provenance,binLength=bytes.length-binStart,primitive=doc.meshes?.[0]?.primitives?.[0];
  if(info?.stage!=='learned-geometry-and-material'||!report.nativeSessionId||
    provenance?.sessionId!==report.nativeSessionId||provenance?.inputManifestSha256!==report.fixtureSha256||
    provenance?.route!==GENERATION_ROUTE)throw Error('identified current generation PBR asset required');
  if(doc.asset?.version!=='2.0'||doc.buffers?.length!==1||doc.buffers[0].uri!==undefined||
    doc.buffers[0].byteLength!==binLength||!primitive)throw Error('complete embedded PBR surface required');
  const bufferView=index=>{
    const b=Number.isSafeInteger(index)?doc.bufferViews?.[index]:undefined,offset=b?.byteOffset??0;
    if(!b||b.buffer!==0||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(b.byteLength)||
      b.byteLength<1||offset+b.byteLength>binLength)throw Error('complete embedded asset buffer view required');
    return{...b,byteOffset:offset};
  };
  const accessor=(index,type,componentType,width)=>{
    const a=Number.isSafeInteger(index)?doc.accessors?.[index]:undefined,offset=a?.byteOffset??0;
    if(!a||a.type!==type||a.componentType!==componentType||!Number.isSafeInteger(a.count)||a.count<1||
      !Number.isSafeInteger(offset)||offset<0||a.sparse)throw Error('complete PBR geometry accessor required');
    const b=bufferView(a.bufferView),stride=b.byteStride??width;
    if(!Number.isSafeInteger(stride)||stride<width||offset+(a.count-1)*stride+width>b.byteLength)
      throw Error('complete PBR accessor bytes required');
    return a;
  };
  const positions=accessor(primitive.attributes?.POSITION,'VEC3',5126,12),
    normals=accessor(primitive.attributes?.NORMAL,'VEC3',5126,12),uv=accessor(primitive.attributes?.TEXCOORD_0,'VEC2',5126,8),
    indices=accessor(primitive.indices,'SCALAR',5125,4);
  if(positions.count!==normals.count||positions.count!==uv.count||indices.count%3)
    throw Error('complete PBR triangle/UV surface required');
  const material=doc.materials?.[primitive.material],pbr=material?.pbrMetallicRoughness;
  if(material?.alphaMode!=='OPAQUE'||!pbr||doc.images?.length!==2)throw Error('complete learned PBR material required');
  const imageIndices=new Set();
  for(const texture of [pbr.baseColorTexture,pbr.metallicRoughnessTexture]){
    const t=Number.isSafeInteger(texture?.index)?doc.textures?.[texture.index]:undefined,
      image=Number.isSafeInteger(t?.source)?doc.images?.[t.source]:undefined;
    if(!image||image.uri!==undefined||image.mimeType!=='image/png')throw Error('embedded learned PBR PNG required');
    imageIndices.add(t.source);const b=bufferView(image.bufferView),start=binStart+b.byteOffset,end=start+b.byteLength;
    if(b.byteLength<45||!bytes.subarray(start,start+8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]))
      throw Error('complete embedded PNG required');
    let offset=start+8,header=false,data=false,ended=false;
    while(offset+12<=end){
      const length=view.getUint32(offset),type=view.getUint32(offset+4);if(offset+length+12>end)throw Error('complete embedded PNG chunk required');
      if(!header){if(type!==0x49484452||length!==13||!view.getUint32(offset+8)||!view.getUint32(offset+12))
        throw Error('complete embedded PNG header required');header=true;}
      if(type===0x49444154&&length>0)data=true;
      offset+=length+12;if(type===0x49454e44){ended=length===0&&offset===end;break;}
    }
    if(!header||!data||!ended)throw Error('complete embedded PNG data/end required');
  }
  if(imageIndices.size!==2)throw Error('complete distinct base-color and metallic-roughness images required');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  await write(outputPath,bytes);
  report.assetArtifact={path:outputPath,byteLength:bytes.length,sha256,class:'learned-geometry-and-material/PBR-textures'};
  await persist();return report.assetArtifact;
}
// Raw kernel events are append-only and uncapped. The main report carries the
// last observation; it is not rewritten with an ever-growing kernel history.
export async function persistGenerationPhase({report,row,kernelLogPath,append,persist}){
  if(typeof row?.phase!=='string'||!row.phase||row.effectiveRoute!==GENERATION_ROUTE||
    typeof row.sessionId!=='string'||!row.sessionId)throw Error('identified actual generation phase required');
  if(report.nativeSessionId&&report.nativeSessionId!==row.sessionId)throw Error('generation session identity changed');
  if(row.kernel){
    const k=row.kernel;
    if(typeof k.stage!=='string'||!k.stage||!Array.isArray(k.dispatch)||k.dispatch.length<1||k.dispatch.length>3||
      !k.dispatch.every(v=>Number.isSafeInteger(v)&&v>=0)||
      !['before-native-kernel','native-kernel-returned'].includes(k.point))throw Error('complete native kernel event required');
    if(typeof kernelLogPath!=='string'||!kernelLogPath||typeof append!=='function')throw Error('caller-owned kernel journal required');
    await append(kernelLogPath,JSON.stringify({...row,observedAt:new Date().toISOString()})+'\n');
    report.nativeSessionId=row.sessionId;report.lastKernel=k;report.lastBrowserPhase=row.phase;
    report.kernelEvidence={path:kernelLogPath,count:(report.kernelEvidence?.count??0)+1,retention:'complete append-only events; no cap'};
    return;
  }
  if(row.noiseInput){
    const n=row.noiseInput;
    if(typeof n.stage!=='string'||!n.stage||n.dtype!=='f32'||!Array.isArray(n.shape)||!n.shape.length||
      !n.shape.every(v=>Number.isSafeInteger(v)&&v>0)||n.shape.reduce((a,b)=>a*b,4)!==n.byteLength||
      typeof n.sha256!=='string'||!/^[a-f0-9]{64}$/.test(n.sha256))throw Error('complete replay noise input observation required');
  }
  report.nativeSessionId=row.sessionId;report.livePhases??=[];
  report.livePhases.push({...row,observedAt:new Date().toISOString()});report.lastBrowserPhase=row.phase;await persist();
}
export const GENERATION_PHASES=Object.freeze(['sparse-structure-sampling','occupancy-decoding','low-resolution-shape-sampling',
  'learned-cascade-support','high-resolution-shape-sampling','learned-geometry-decoding','shape-conditioned-texture-sampling','shape-guided-material-decoding']);
export const GENERATION_FIELDS=Object.freeze(['conditioning','geometry.features','geometry.coordinates','material.features',
  'material.coordinates','shapeCodes','textureCodes','noise.sparse','noise.lowResolutionShape','noise.highResolutionShape','noise.texture',
  'geometry.subdivision0','geometry.subdivision1','geometry.subdivision2','geometry.subdivision3']);
export function generationModelCallCounts(m){
  const count=p=>p.steps.reduce((n,s)=>n+(s.guided?2:1),0),c=m.models;
  return{[GENERATION_PHASES[0]]:count(buildSparseSamplerPlan(c.sparseFlow.config)),
    [GENERATION_PHASES[2]]:count(buildSLatSamplerPlan({...c.lowResolutionShape.config,tokenRows:1,mode:'shape'})),
    [GENERATION_PHASES[4]]:count(buildSLatSamplerPlan({...c.highResolutionShape.config,tokenRows:1,mode:'shape'})),
    [GENERATION_PHASES[6]]:count(buildSLatSamplerPlan({...c.textureFlow.config,tokenRows:1,mode:'texture'}))};
}
export function validateGenerationResult(result,m){
  validateGenerationInputs(m);validateNativePrefixBackend(result.backend);
  const c=result.composition;
  if(result.status!=='succeeded'||result.effectiveRoute!==GENERATION_ROUTE||result.requestedRoute!==GENERATION_ROUTE||
    result.backend.isFallbackAdapter!==false||result.profileStatus!=='passed'||result.profile?.evidence?.mode!=='live'||
    result.profile?.routeId!==GENERATION_ROUTE||result.numericalStatus!=='not-compared')throw Error('complete native generation route/profile required; not matched-reference fidelity');
  if(c?.dinoBlocksExecuted!==24||c.featureBytesToCPUDuringServing!==0||c.coordinateBytesToCPUDuringServing!==0||
    c.sameInvocation!==true||JSON.stringify(c.phases)!==JSON.stringify(GENERATION_PHASES)||!(c.lowResolutionRows>0)||!(c.highResolutionRows>0))
    throw Error('complete resident image-to-learned-fields composition required');
  for(const [phase,calls]of Object.entries(generationModelCallCounts(m)))
    if(c.stageCounts?.[phase]?.['terminal-output-projection']!==calls||c.stageCounts?.[phase]?.['block-modulation']!==calls*30)
      throw Error('complete actual30block/source schedule execution required '+phase);
  for(const name of GENERATION_FIELDS){
    const row=result.outputs?.[name];if(!row||!Array.isArray(row.shape)||!row.shape.every(n=>Number.isSafeInteger(n)&&n>0)||
      !['f32','i32'].includes(row.dtype)||row.byteLength!==row.shape.reduce((n,x)=>n*x,4)||row.finite!==true||!/^[a-f0-9]{64}$/.test(row.sha256??''))
      throw Error('complete finite retained generation field required '+name);
  }
  const out=result.outputs;
  for(const [name,shape]of Object.entries({conditioning:[1,1029,1024],shapeCodes:[c.highResolutionRows,32],textureCodes:[c.highResolutionRows,32],
    'noise.sparse':[1,8,16,16,16],'noise.lowResolutionShape':[c.lowResolutionRows,32],
    'noise.highResolutionShape':[c.highResolutionRows,32],'noise.texture':[c.highResolutionRows,32]}))
    if(JSON.stringify(out[name].shape)!==JSON.stringify(shape)||out[name].dtype!=='f32')throw Error('complete source field/noise shape required '+name);
  for(const [prefix,channels]of [['geometry',7],['material',6]]){
    const fields=out[prefix+'.features'],coords=out[prefix+'.coordinates'];
    if(fields.dtype!=='f32')throw Error('F32 learned '+prefix+' features required');
    if(fields.shape.length!==2||fields.shape[1]!==channels||coords.dtype!=='i32'||coords.shape.length!==2||
      coords.shape[1]!==3||coords.shape[0]!==fields.shape[0])throw Error('complete learned '+prefix+' fields and coordinates required');
    if(c[prefix+'Resolution']!==m.meshResolution)throw Error('canonical learned '+prefix+' resolution required');
    const levels=c[prefix+'Levels'],config=m.models[prefix==='geometry'?'shapeDecoder':'textureDecoder'].config;
    if(!Array.isArray(levels)||levels.length!==config.channels.length)throw Error('complete actual decoder level metadata required '+prefix);
    for(const [i,level]of levels.entries()){
      const resolution=m.meshResolution/2**(levels.length-1-i);
      if(!Number.isSafeInteger(level.rows)||level.rows<1||level.rows>resolution**3||level.resolution!==resolution||
        level.channels!==config.channels[i]||level.blocksExecuted!==config.numBlocks[i]||
        (i===0?level.rows!==c.highResolutionRows:level.rows>levels[i-1].rows*8)||
        (i===levels.length-1&&level.rows!==fields.shape[0])||
        (prefix==='material'&&level.rows!==c.geometryLevels[i].rows))throw Error('actual decoder level row/resolution/block contract required '+prefix+'.'+i);
      if(prefix==='geometry'&&i<levels.length-1){
        const guide=out['geometry.subdivision'+i];
        if(guide.dtype!=='f32')throw Error('F32 geometry subdivision guide required '+i);
        if(JSON.stringify(guide.shape)!==JSON.stringify([level.rows,8]))throw Error('actual parent-row subdivision guide required '+i);
      }
    }
  }
  if(out['geometry.coordinates'].sha256!==out['material.coordinates'].sha256)throw Error('shape-guided material coordinate identity required');
  return true;
}
