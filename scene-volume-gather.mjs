import {ANGULAR_IMPORTANCE_WGSL} from './scene-angular-importance.mjs';
import {SMOKE_LIGHT_NOISE_WGSL} from './scene-light-noise.mjs';
// Direct distributed emission. Surface irradiance and isotropic smoke mean
// use the same rays; only their angular weighting differs.
import {createPreparedSmoke,preparedSmokePlan} from './scene-prepared-smoke.mjs';
import {createSourceSoftening,validateSourceSoftness} from './scene-source-softening.mjs';
import {surfaceGraph,createSurfaceReconstruction,validateSurfaceReconstruction} from './scene-surface-reconstruction.mjs';
import {progressiveSourcePoint,SOURCE_AWARE_WGSL} from './scene-source-aware.mjs';
import {createScatteredSource} from './scene-volume-scattering.mjs';
import {createBvhReproject} from './scene-bvh-reproject.mjs';
import {normalizeSourceGuide,sourceGuidePoint,SOURCE_GUIDE_WGSL} from './scene-source-guide.mjs';
import {normalizeSourceRegions,regionSample,regionPlan,REGION_SOURCE_WGSL} from './scene-source-regions.mjs';
import {sceneSourceDomain,sceneLightingDomain} from './scene-volume-source.mjs';
import {packSceneSmokeLights} from './scene-smoke-lights.mjs';
export {sourceGuideRaySample,sourceGuidePdf,deriveSourceGuide} from './scene-source-guide.mjs';
export {sourceRaySample,integrateCellRay} from './scene-source-aware.mjs';
export {DISTRIBUTED_SMOKE_WGSL} from './scene-smoke-reconstruction.mjs';
export function lightingDirections(count=24,rotation=0) {
  if(!Number.isInteger(count)||count<2||count%2) throw new Error('even angular sample count required');
  if(!Number.isFinite(rotation))throw new Error('finite angular rotation required');
  const result=[];
  for(let i=0;i<count/2;i++) {
    const y=(i+.5)/(count/2), r=Math.sqrt(1-y*y), phi=i*Math.PI*(3-Math.sqrt(5));
    const x=Math.cos(phi)*r,z=Math.sin(phi)*r,c=Math.cos(rotation),s=Math.sin(rotation);
    const d=[c*x-s*y,s*x+c*y,z];result.push(d,d.map(v=>-v));
  }
  return result;
}
export function integrateVolumeRay(sample,length,step,phase=.5) {
  const result=[0,0,0];let transmission=1;
  const count=Math.ceil(length/step), ds=count ? length/count : 0;
  for(let i=0;i<count;i++) {
    const m=sample((i+phase)*ds), sigma=Math.max(0,m[3]);
    const weight=sigma ? -Math.expm1(-sigma*ds)/sigma : ds;
    for(let c=0;c<3;c++) result[c]+=transmission*m[c]*weight;
    transmission*=Math.exp(-sigma*ds);
  }
  return result;
}
export function receiverDispatch(count,limit) {
  const groups=Math.ceil(count/64);
  if(groups>limit*limit)throw new Error('receiver dispatch exceeds two-dimensional device capacity');
  return [Math.min(groups,limit),Math.ceil(groups/limit)];
}

// Shared allocation-free admission for edits and construction. Direction caches
// can dominate prepared reconstruction storage, especially at refinement one.
export function volumeGatherPlan({volumeGrid=16,sourceDimensions=[volumeGrid,volumeGrid*2,volumeGrid],surfaceCount=0,directions=24,smokeRefinement=4,sceneLightCount=0,angularPattern='fixed'},limits){
  sceneSourceDomain(sourceDimensions);
  const height=volumeGrid*sourceDimensions[1]/sourceDimensions[0];
  if(!Number.isSafeInteger(volumeGrid)||volumeGrid<1||!Number.isSafeInteger(height)||height<1)throw Error('smoke receiver dimensions must exactly represent the source domain');
  if(![surfaceCount,sceneLightCount].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('nonnegative receiver and scene light counts required');
  if(!Number.isSafeInteger(directions)||directions<2||directions%2)throw Error('even angular sample count required');
  const volumeDimensions=[volumeGrid,height,volumeGrid],volumeCount=volumeGrid*height*volumeGrid,total=surfaceCount+volumeCount;
  const prepared=preparedSmokePlan(volumeDimensions,smokeRefinement,limits);
  const bankDirections=directions*(angularPattern==='importance'?2:1),importanceBytes=angularPattern==='importance'?total*bankDirections*8:0;
  for(const [name,size]of [['surface and smoke receivers',total*32],['distributed incident directions',bankDirections*16],['cached first solid distance per receiver ray',total*bankDirections*4],['importance scores and CDF (each)',importanceBytes/2],['scene-light first solid distances',volumeCount*sceneLightCount*4]]){
    if(!Number.isSafeInteger(size)||Math.max(16,size)>limits.maxStorageBufferBindingSize)throw Error(`${name} needs ${Math.max(16,size)} bytes; device supports ${limits.maxStorageBufferBindingSize}`);
  }
  for(const count of [total*bankDirections,volumeCount*sceneLightCount,prepared.sampleCount])receiverDispatch(count,limits.maxComputeWorkgroupsPerDimension);
  const surfaceWidth=surfaceCount?Math.min(1024,limits.maxTextureDimension2D):1;
  if(Math.max(1,Math.ceil(surfaceCount/surfaceWidth))>limits.maxTextureDimension2D)throw Error('surface receiver texture exceeds device capacity');
  return {volumeDimensions,volumeCount,total,bankDirections,importanceBytes};
}

export function createVolumeGather(device,{geometry,receivers,surfaceTriangles=[],volumeGrid=16,sourceDimensions=[volumeGrid,volumeGrid*2,volumeGrid],directions=24,smokeRefinement=4,angularRotation=0,angularPattern='fixed',worldGeometry=false,samplingNoise=null}) {
  if(worldGeometry&&receivers.length)throw new Error('world BVH mode requires smoke-only receivers');
  lightingDirections(directions); // Validate before allocating shared resources.
  const domain=sceneSourceDomain(sourceDimensions);
  const {volumeDimensions,volumeCount,total}=volumeGatherPlan({volumeGrid,sourceDimensions,surfaceCount:receivers.length,directions,smokeRefinement,angularPattern},device.limits);
  const volumeHeight=volumeDimensions[1];
  const receiverValues=new Float32Array(total*8);
  receivers.forEach((r,i)=>receiverValues.set([...r.position,r.twoSided?2:1,...r.normal,0],i*8));
  for(let z=0;z<volumeGrid;z++) for(let y=0;y<volumeHeight;y++) for(let x=0;x<volumeGrid;x++) {
    const id=receivers.length+x+volumeGrid*(y+volumeHeight*z);
    receiverValues.set([-1+(x+.5)*2/volumeGrid,-1+(y+.5)*2/volumeGrid,-1+(z+.5)*2/volumeGrid,0,0,0,0,0],id*8);
  }
  const resources=[];
  function buffer(label,data,usage=GPUBufferUsage.STORAGE,owner=resources) {
    const size=Math.max(16,data.byteLength);
    if(size>device.limits.maxStorageBufferBindingSize) throw new Error(`${label} needs ${size} bytes; device supports ${device.limits.maxStorageBufferBindingSize}`);
    const b=device.createBuffer({label,size,usage:usage|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(b,0,data);owner.push(b);return b;
  }
  const nodes=buffer('static kiln BVH nodes',geometry.nodes);
  const triangles=buffer('static kiln BVH triangles',geometry.triangles);
  const reproject=worldGeometry?createBvhReproject(device,{geometry,nodes,triangles}):null;
  let geometryTransforms=geometry.matrices;
  const receiverBuffer=buffer('surface and smoke receivers',receiverValues,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
  const params=buffer('distributed transport parameters',new Float32Array(4),GPUBufferUsage.UNIFORM);
  const environmentParams=buffer('smoke environment parameters',new Float32Array(4),GPUBufferUsage.UNIFORM);
  const sceneLightParams=buffer('smoke scene-light parameters',new Float32Array(4),GPUBufferUsage.UNIFORM);
  let sceneLightBuffer=buffer('actual smoke scene lights',new Float32Array(16),GPUBufferUsage.STORAGE,[]);
  let sceneLightHits=buffer('scene-light first solid distances',new Float32Array(4),GPUBufferUsage.STORAGE,[]);
  let sceneLightCapacity=0,sceneLightKey=null,sceneLightPipeline=null,sceneLightGroup=null,sceneLightPreparations=0;
  // WebGPU initializes new textures to zero; no upload/readback or sampler.
  const darkEnvironment=device.createTexture({label:'disabled smoke environment',size:[1,1],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING});
  const surfaceParams=buffer('once-scattered surface transport parameters',new Float32Array(4),GPUBufferUsage.UNIFORM);
  let sourceGuide=normalizeSourceGuide({lo:domain.lo,hi:domain.hi},domain),guideBuffer=null;
  let sourceRegions=normalizeSourceRegions([],domain),regionsBuffer=null;
  const guideData=()=>new Float32Array([...sourceGuide.lo,0,...sourceGuide.hi,0]);
  const noiseParams=buffer('smoke light temporal phase',new Float32Array(4),GPUBufferUsage.UNIFORM);
  const noiseEntries=()=>['blue','importance'].includes(angularPattern)?[{binding:18,resource:samplingNoise.createView()},{binding:19,resource:{buffer:noiseParams}}]:[];
  const sourcePattern=()=>['source','guided','regions'].includes(angularPattern);
  const guideEntries=()=>angularPattern==='guided'?[{binding:10,resource:{buffer:guideBuffer}}]:angularPattern==='regions'?[{binding:10,resource:{buffer:regionsBuffer}}]:[];
  const surfaceWidth=receivers.length?Math.min(1024,device.limits.maxTextureDimension2D):1;
  const surfaceHeight=Math.max(1,Math.ceil(receivers.length/surfaceWidth));
  if(surfaceHeight>device.limits.maxTextureDimension2D) throw new Error('surface receiver texture exceeds device capacity');
  const surface=device.createTexture({label:'direct flame surface irradiance',size:[surfaceWidth,surfaceHeight],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const surfaceBack=device.createTexture({label:'direct flame back surface irradiance',size:[surfaceWidth,surfaceHeight],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const smoke=device.createTexture({label:'direct flame mean incident radiance',dimension:'3d',size:volumeDimensions,format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const preparedSmoke=createPreparedSmoke(device,{nodes,triangles,nodeCount:geometry.nodeCount,source:smoke,coarseDimensions:volumeDimensions,factor:smokeRefinement});
  const smokeReconstruction=preparedSmoke.metadata;
  const dispatchLimit=device.limits.maxComputeWorkgroupsPerDimension;
  // Geometry, material bindings, outputs and smoke reconstruction are shared.
  // Only direction-specific pipelines/ray distances change with angular quality.
  const angularStates=new Map();let retainComparisons=false,visibilityPreparations=0,preparedRayDirections=0,lastPreparedDirections=0;
  let softening=null,softeningDimensions=null,reconstruction=null,scatteredSource=null,scatterInputs=null;
  let lastField=null,lastLightingTexture=null,lastOptions=null,lastMetadata=null;
  const family=()=>angularPattern+':'+angularRotation+':'+(angularPattern==='guided'?JSON.stringify([sourceGuide.lo,sourceGuide.hi]):angularPattern==='regions'?JSON.stringify(sourceRegions):'');
  function angularState() {
    if(['blue','importance'].includes(angularPattern)&&!samplingNoise?.createView)throw Error('blue-noise smoke lighting requires the shared sampling atlas');
    const key=family()+directions;
    if(sourcePattern()){
      const existing=[...angularStates.values()].find(s=>s.family===family()&&s.capacity>=directions);
      if(existing)return existing;
    }
    if(angularStates.has(key))return angularStates.get(key);
    const owned=[];
    try {
      const bankDirections=directions*(angularPattern==='importance'?2:1);
      receiverDispatch(total*bankDirections,dispatchLimit);
      const prefix=sourcePattern()?[...angularStates.values()].find(s=>s.family===family()&&s.cacheBuilt):null;
      if(angularPattern==='guided'&&!guideBuffer)guideBuffer=buffer('source guide bounds',guideData(),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_SRC);
      if(angularPattern==='regions'&&!regionsBuffer)regionsBuffer=buffer('stable source region bounds',new Float32Array(sourceRegions.flatMap(g=>[...g.lo,0,...g.hi,0])),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
      const points=sourcePattern()?Array.from({length:directions},(_,i)=>angularPattern==='guided'?sourceGuidePoint(i,sourceGuide,angularRotation,domain):progressiveSourcePoint(i,angularRotation,domain)):lightingDirections(bankDirections,angularRotation);
      const directionData=new Float32Array(points.flatMap(d=>[...d,0]));
      if(angularPattern==='regions')for(let i=0;i<directions;i++){const sample=regionSample(i,sourceRegions,angularRotation,domain);directionData.set(sample.unit,i*4);new Uint32Array(directionData.buffer)[i*4+3]=sample.component+0x40000000;}
      const directionBuffer=buffer('distributed incident directions',directionData,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,owned);
      const distances=buffer('cached first solid distance per receiver ray',new Float32Array(total*bankDirections),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,owned);
      const environmentDirections=sourcePattern()?buffer('uniform environment directions',new Float32Array(lightingDirections(directions,angularRotation).flatMap(d=>[...d,0])),GPUBufferUsage.STORAGE,owned):null;
      const environmentHits=sourcePattern()?buffer('cached environment solid distances',new Float32Array(volumeCount*directions),GPUBufferUsage.STORAGE,owned):null;
      const constants=`const DISPATCH_WIDTH:u32=${dispatchLimit*64}u;const DIRECTION_COUNT:u32=${bankDirections}u;override CACHE_START:u32=0u;const SURFACE_COUNT:u32=${receivers.length}u;const RECEIVER_COUNT:u32=${total}u;const NODE_COUNT:u32=${geometry.nodeCount}u;const VOLUME_GRID:u32=${volumeGrid}u;const VOLUME_HEIGHT:u32=${volumeHeight}u;const SURFACE_WIDTH:u32=${surfaceWidth}u;`;
      const module=device.createShaderModule({label:'distributed volume ray gather',code:`const SOURCE_PATTERN:bool=${sourcePattern()};const SPATIAL_PATTERN:bool=${angularPattern==='spatial'};const BLUE_PATTERN:bool=${['blue','importance'].includes(angularPattern)};const IMPORTANCE_PATTERN:bool=${angularPattern==='importance'};`+constants+(['blue','importance'].includes(angularPattern)?SMOKE_LIGHT_NOISE_WGSL:'fn blueReceiverRotation(p:vec3<f32>)->vec4<f32>{return vec4<f32>(0,0,0,1);}fn blueRayPhase(p:vec3<f32>,a:u32)->f32{return 0.5;}')+GATHER_WGSL_BODY+(angularPattern==='importance'?ANGULAR_IMPORTANCE_WGSL:'fn selectImportance(receiver:u32,u:f32)->u32{return 0u;}fn importanceProbability(receiver:u32,a:u32)->f32{return 1.0;}fn recordImportance(receiver:u32,a:u32,radiance:vec3<f32>){}')+(sourcePattern()?SOURCE_ENVIRONMENT_WGSL:'fn sourceEnvironment(receiver:u32,p:vec3<f32>)->vec3<f32>{return vec3<f32>(0.0);}')+(angularPattern==='regions'?REGION_SOURCE_WGSL:angularPattern==='guided'?SOURCE_GUIDE_WGSL:SOURCE_AWARE_WGSL)});
      if(!sceneLightPipeline)sceneLightPipeline=device.createComputePipeline({label:'cache scene-light smoke visibility',layout:'auto',compute:{module,entryPoint:'cacheSceneLights'}});
      const cache=device.createComputePipeline({label:'cache static solid ray intersections',layout:'auto',compute:{module,entryPoint:'cacheGeometry',constants:{CACHE_START:prefix?.capacity||0}}});
      const cacheGroup=device.createBindGroup({layout:cache.getBindGroupLayout(0),entries:[...[nodes,triangles,receiverBuffer,directionBuffer,distances].map((b,binding)=>({binding,resource:{buffer:b}})),...(angularPattern==='regions'?guideEntries():[]),...(['blue','importance'].includes(angularPattern)?[{binding:18,resource:samplingNoise.createView()}]:[])]});
      const fullCache=prefix?device.createComputePipeline({label:'refresh moving solid ray intersections',layout:'auto',compute:{module,entryPoint:'cacheGeometry'}}):cache;
      const fullCacheGroup=prefix?device.createBindGroup({layout:fullCache.getBindGroupLayout(0),entries:[...[nodes,triangles,receiverBuffer,directionBuffer,distances].map((b,binding)=>({binding,resource:{buffer:b}})),...(angularPattern==='regions'?guideEntries():[]),...(['blue','importance'].includes(angularPattern)?[{binding:18,resource:samplingNoise.createView()}]:[])]}):cacheGroup;
      const gather=device.createComputePipeline({label:'integrate actual flame emission to receivers',layout:'auto',compute:{module,entryPoint:'gatherLight'}});
      const gatherVolume=device.createComputePipeline({label:'direct flame incident on smoke',layout:'auto',compute:{module,entryPoint:'gatherVolume'}});
      const environmentCache=sourcePattern()?device.createComputePipeline({label:'cache full-sphere environment visibility',layout:'auto',compute:{module,entryPoint:'cacheEnvironment'}}):null;
      const environmentCacheGroup=environmentCache?device.createBindGroup({layout:environmentCache.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:nodes}},{binding:1,resource:{buffer:triangles}},{binding:2,resource:{buffer:receiverBuffer}},
        {binding:12,resource:{buffer:environmentParams}},{binding:13,resource:{buffer:environmentDirections}},{binding:14,resource:{buffer:environmentHits}}]}):null;
      const importanceScores=angularPattern==='importance'?buffer('recent angular contribution scores',new Float32Array(total*bankDirections),GPUBufferUsage.STORAGE,owned):null;
      const importanceCdf=angularPattern==='importance'?buffer('angular proposal CDF',new Float32Array(total*bankDirections),GPUBufferUsage.STORAGE,owned):null;
      const importance=importanceScores?device.createComputePipeline({label:'prepare cached angular importance',layout:'auto',compute:{module,entryPoint:'prepareImportance'}}):null;
      const importanceEntries=importanceScores?[{binding:20,resource:{buffer:importanceScores}},{binding:21,resource:{buffer:importanceCdf}}]:[];
      const importanceGroup=importance?device.createBindGroup({layout:importance.getBindGroupLayout(0),entries:importanceEntries}):null;
      const state={importance,importanceGroup,importanceEntries,owned,directionBuffer,distances,cache,cacheGroup,fullCache,fullCacheGroup,gather,gatherVolume,environmentCache,environmentCacheGroup,environmentDirections,environmentHits,environmentCount:directions,environmentCacheBuilt:false,family:family(),capacity:bankDirections,requestedDirections:directions,prefix,sourceTexture:null,gatherGroup:null,cacheBuilt:false};
      angularStates.set(key,state);
      if(!retainComparisons&&!sourcePattern())pruneComparisons();
      return state;
    }catch(error){for(const b of owned)b.destroy();throw error;}
  }
  function pruneComparisons() {
    for(const [key,state] of angularStates)if(state.family!==family()||(!sourcePattern()&&state.requestedDirections!==directions)){for(const b of state.owned)b.destroy();angularStates.delete(key);}
  }
  return {surface,surfaceBack,smoke,surfaceDimensions:[surfaceWidth,surfaceHeight],volumeDimensions,
    setGeometryTransforms(value){geometryTransforms=value;},
    setDirections(value){volumeGatherPlan({volumeGrid,sourceDimensions,surfaceCount:receivers.length,directions:value,smokeRefinement,angularPattern},device.limits);directions=value;},
    setAngularPattern(pattern,rotation=0){
      if(!['fixed','spatial','blue','source','guided','regions','importance'].includes(pattern)||!Number.isFinite(rotation))throw new Error('valid angular pattern and finite rotation required');
      if(pattern===angularPattern&&rotation===angularRotation)return;
      if(['blue','importance'].includes(pattern)&&!samplingNoise?.createView)throw Error('blue-noise smoke lighting requires the shared sampling atlas');
      volumeGatherPlan({volumeGrid,sourceDimensions,surfaceCount:receivers.length,directions,smokeRefinement,angularPattern:pattern},device.limits);
      angularPattern=pattern;angularRotation=rotation;
      if(!retainComparisons)pruneComparisons();
    },
    setSourceRegions(value){
      const next=normalizeSourceRegions(value,domain),bytes=next.length*32;
      if(bytes>device.limits.maxStorageBufferBindingSize)throw Error(`source regions need ${bytes} bytes; device supports ${device.limits.maxStorageBufferBindingSize}`);
      if(JSON.stringify(next)===JSON.stringify(sourceRegions))return;
      for(const [key,state]of angularStates)if(key.startsWith('regions:')){for(const b of state.owned)b.destroy();angularStates.delete(key);}
      regionsBuffer?.destroy();regionsBuffer=null;sourceRegions=next;
    },
    setSourceGuide(value){
      const next=normalizeSourceGuide(value,domain),changed=JSON.stringify([next.lo,next.hi])!==JSON.stringify([sourceGuide.lo,sourceGuide.hi]);
      sourceGuide=next;
      if(changed){if(guideBuffer)device.queue.writeBuffer(guideBuffer,0,guideData());if(!retainComparisons&&angularPattern==='guided')pruneComparisons();}
    },
    setRetainComparisons(value){retainComparisons=!!value;if(!retainComparisons)pruneComparisons();},
    encode(field,{gain=1,stepLength=2/field.dimensions[0],smokeEnabled=true,sourceSoftness=0,surfaceReconstruction=0,surfaceScattering=false,environment=null,sceneLights,samplingFrame=field.frame}={}) {
      if(field.status!=='encoded'||!field.texture) throw new Error('distributed gather needs current raw emission/extinction');
      if(environment&&!environment.texture?.createView)throw Error('smoke environment requires a native GPU texture');
      const environmentTexture=environment?.texture??darkEnvironment;
      const punctual=packSceneSmokeLights(sceneLights);
      if(punctual.count>sceneLightCapacity){
        // Allocate the requested scene, bounded only by the device's capacity.
        const next=buffer('actual smoke scene lights',punctual.data,GPUBufferUsage.STORAGE,[]);
        let hits;try{hits=buffer('scene-light first solid distances',new Float32Array(volumeCount*punctual.count),GPUBufferUsage.STORAGE,[]);}catch(error){next.destroy();throw error;}
        sceneLightBuffer.destroy();sceneLightHits.destroy();sceneLightBuffer=next;sceneLightHits=hits;sceneLightCapacity=punctual.count;sceneLightKey=null;sceneLightGroup=null;
      }
      device.queue.writeBuffer(sceneLightBuffer,0,punctual.data);
      device.queue.writeBuffer(sceneLightParams,0,new Float32Array([punctual.count,punctual.worldScale,0,0]));
      const sceneLightEntries=()=>[{binding:15,resource:{buffer:sceneLightBuffer}},{binding:16,resource:{buffer:sceneLightParams}},{binding:17,resource:{buffer:sceneLightHits}}];
      const environmentEntries=state=>[
        {binding:11,resource:environmentTexture.createView()},{binding:12,resource:{buffer:environmentParams}},
        ...(sourcePattern()?[{binding:13,resource:{buffer:state.environmentDirections}},{binding:14,resource:{buffer:state.environmentHits}}]:[])];
      const currentDomain=sceneLightingDomain(field);
      if(currentDomain.hi.some((x,a)=>x!==domain.hi[a]))throw Error('source domain changed; rebuild smoke receivers before gathering');
      if(surfaceScattering&&(!field.scatteringTexture||field.scatteringGeneration!==field.generation))throw new Error('surface scattering requires same-generation smoke scattering coefficient');
      validateSourceSoftness(sourceSoftness);
      validateSurfaceReconstruction(surfaceReconstruction);
      if(surfaceReconstruction&&!reconstruction)reconstruction=createSurfaceReconstruction(device,{graph:surfaceGraph(receivers,surfaceTriangles),front:surface,back:surfaceBack,dimensions:[surfaceWidth,surfaceHeight]});
      try {
      const encoder=device.createCommandEncoder({label:'same-state distributed flame lighting'});
      if(reproject?.encode(encoder,field.worldTransform,geometryTransforms)){
        for(const state of angularStates.values()){state.cacheBuilt=false;state.environmentCacheBuilt=false;state.prefix=null;state.refreshAll=true;}
        preparedSmoke.invalidateGeometry();softening?.invalidateGeometry();
        sceneLightKey=null;
      }
      const state=angularState();
      device.queue.writeBuffer(noiseParams,0,new Float32Array([samplingFrame%32,0,0,0]));
      if(sourcePattern()&&environment&&state.environmentCount!==directions){
        // Progressive flame samples may reuse a larger cache, but a uniform
        // sphere is not a progressive prefix. Its current constellation and
        // solid distances must describe the requested count after every edit.
        device.queue.writeBuffer(state.environmentDirections,0,new Float32Array(lightingDirections(directions,angularRotation).flatMap(d=>[...d,0])));
        state.environmentCount=directions;state.environmentCacheBuilt=false;
      }
      if(softening&&softeningDimensions!==field.dimensions.join(',')){softening.destroy();softening=null;}
      if(sourceSoftness>0&&!softening){
        softening=createSourceSoftening(device,{nodes,triangles,nodeCount:geometry.nodeCount,dimensions:field.dimensions});
        softeningDimensions=field.dimensions.join(',');
      }
      const lightingTexture=softening?softening.encode(encoder,field.texture,sourceSoftness):field.texture;
      device.queue.writeBuffer(params,0,new Float32Array([gain,stepLength,smokeEnabled||surfaceScattering?total:receivers.length,directions]));
      device.queue.writeBuffer(environmentParams,0,new Float32Array([environment?1:0,directions,0,0]));
      if(state.sourceTexture!==lightingTexture||state.environmentTexture!==environmentTexture||state.sceneLightBuffer!==sceneLightBuffer) {
        const entries=[
          {binding:2,resource:{buffer:receiverBuffer}},{binding:3,resource:{buffer:state.directionBuffer}},
          {binding:4,resource:{buffer:state.distances}},{binding:5,resource:lightingTexture.createView()},
          {binding:6,resource:surface.createView()},{binding:7,resource:smoke.createView()},
          {binding:8,resource:{buffer:params}},{binding:9,resource:surfaceBack.createView()},...guideEntries(),...environmentEntries(state),...sceneLightEntries(),...noiseEntries(),...state.importanceEntries];
        const gatherGroup=device.createBindGroup({layout:state.gather.getBindGroupLayout(0),entries});
        const volumeGroup=device.createBindGroup({layout:state.gatherVolume.getBindGroupLayout(0),entries});
        Object.assign(state,{sourceTexture:lightingTexture,environmentTexture,sceneLightBuffer,gatherGroup,volumeGroup});
      }
      if(environment&&(smokeEnabled||surfaceScattering)&&state.environmentCache&&!state.environmentCacheBuilt){
        const pass=encoder.beginComputePass({label:'cache environment visibility'});
        pass.setPipeline(state.environmentCache);pass.setBindGroup(0,state.environmentCacheGroup);
        pass.dispatchWorkgroups(...receiverDispatch(volumeCount*directions,dispatchLimit));pass.end();state.environmentCacheBuilt=true;
      }
      if(punctual.count&&(smokeEnabled||surfaceScattering)&&sceneLightKey!==punctual.visibilityKey){
        if(!sceneLightGroup)sceneLightGroup=device.createBindGroup({layout:sceneLightPipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:nodes}},{binding:1,resource:{buffer:triangles}},{binding:2,resource:{buffer:receiverBuffer}},...sceneLightEntries()]});
        const pass=encoder.beginComputePass({label:'cache scene-light smoke visibility'});
        pass.setPipeline(sceneLightPipeline);pass.setBindGroup(0,sceneLightGroup);
        pass.dispatchWorkgroups(...receiverDispatch(volumeCount*punctual.count,dispatchLimit));pass.end();sceneLightKey=punctual.visibilityKey;sceneLightPreparations++;
      }
      if(!state.cacheBuilt) {
        if(state.prefix)encoder.copyBufferToBuffer(state.prefix.distances,0,state.distances,0,total*state.prefix.capacity*4);
        const pass=encoder.beginComputePass({label:'static kiln visibility preparation'});
        lastPreparedDirections=state.capacity-(state.prefix?.capacity||0);
        pass.setPipeline(state.refreshAll?state.fullCache:state.cache);pass.setBindGroup(0,state.refreshAll?state.fullCacheGroup:state.cacheGroup);pass.dispatchWorkgroups(...receiverDispatch(total*lastPreparedDirections,dispatchLimit));pass.end();state.cacheBuilt=true;visibilityPreparations++;preparedRayDirections+=lastPreparedDirections;
      }
      if(state.importance){const pass=encoder.beginComputePass({label:'update angular proposal from recent ray contributions'});pass.setPipeline(state.importance);pass.setBindGroup(0,state.importanceGroup);pass.dispatchWorkgroups(...receiverDispatch(total,dispatchLimit));pass.end();}
      if(surfaceScattering){
        const inputs=[lightingTexture,field.scatteringTexture,preparedSmoke.texture];
        if(!scatterInputs||inputs.some((t,i)=>t!==scatterInputs[i])){
          scatteredSource?.destroy();scatteredSource=createScatteredSource(device,{dimensions:field.dimensions,primary:lightingTexture,scattering:field.scatteringTexture,incident:preparedSmoke.texture});scatterInputs=inputs;
        }
        const volume=encoder.beginComputePass({label:'direct light to smoke before surface scattering'});
        volume.setPipeline(state.gatherVolume);volume.setBindGroup(0,state.volumeGroup);volume.dispatchWorkgroups(...receiverDispatch(volumeCount,dispatchLimit));volume.end();
        preparedSmoke.encode(encoder);scatteredSource.encode(encoder,gain);
        if(receivers.length){
        device.queue.writeBuffer(surfaceParams,0,new Float32Array([1,stepLength,receivers.length,directions]));
        const group=device.createBindGroup({layout:state.gather.getBindGroupLayout(0),entries:[
          {binding:2,resource:{buffer:receiverBuffer}},{binding:3,resource:{buffer:state.directionBuffer}},{binding:4,resource:{buffer:state.distances}},
          {binding:5,resource:scatteredSource.texture.createView()},{binding:6,resource:surface.createView()},{binding:7,resource:smoke.createView()},
          {binding:8,resource:{buffer:surfaceParams}},{binding:9,resource:surfaceBack.createView()},...guideEntries(),...environmentEntries(state),...sceneLightEntries(),...noiseEntries(),...state.importanceEntries]});
        const surfacePass=encoder.beginComputePass({label:'primary plus smoke scattered light to surfaces'});
        surfacePass.setPipeline(state.gather);surfacePass.setBindGroup(0,group);surfacePass.dispatchWorkgroups(...receiverDispatch(receivers.length,dispatchLimit));surfacePass.end();
        }
      }else{
        const pass=encoder.beginComputePass({label:'live distributed flame transport'});
        pass.setPipeline(state.gather);pass.setBindGroup(0,state.gatherGroup);pass.dispatchWorkgroups(...receiverDispatch(smokeEnabled?total:receivers.length,dispatchLimit));pass.end();
        if(smokeEnabled)preparedSmoke.encode(encoder);
      }
      if(surfaceReconstruction)reconstruction.encode(encoder,surfaceReconstruction);
      device.queue.submit([encoder.finish()]);
      reproject?.commit();
      if(state.prefix){
        for(const [key,old] of angularStates)if(old!==state&&old.family===state.family){for(const b of old.owned)b.destroy();angularStates.delete(key);}
        state.prefix=null;
      }
      lastField=field;lastLightingTexture=lightingTexture;lastOptions={surfaceScattering,gain};
      lastMetadata={generation:field.generation,frame:field.frame,sourceDomain:{lo:domain.lo.slice(),hi:domain.hi.slice()},surfaceReceivers:receivers.length,volumeReceivers:smokeEnabled?volumeCount:0,transportVolumeReceivers:smokeEnabled||surfaceScattering?volumeCount:0,allocatedVolumeReceivers:volumeCount,directions,stepLength,gain,surfaceScattering:{enabled:surfaceScattering,orders:surfaceScattering?1:0,sourceGeneration:surfaceScattering?field.scatteringGeneration:null},sourceSoftness,sourceSoftening:softening?{...softening.metadata}:null,geometryTriangles:geometry.triangleCount,smokeReconstruction,
        environment:environment?{...environment.metadata,enabled:true}:{enabled:false},
        sceneLights:{...punctual.metadata,visibilityPreparations:sceneLightPreparations},
        angularPattern,angularRotation,sampling:['blue','importance'].includes(angularPattern)?{atlas:'FAST-scalar-128x128x32',directionPhase:0,quadraturePhase:samplingFrame%32,visibility:'stable-angular-cache',temporalAngularResampling:false}:null,sourceGuide:angularPattern==='regions'?{regions:sourceRegions.map(g=>({...g})),counts:regionPlan(sourceRegions,directions,domain).counts,receiverPhases:'complementary-2x2x2-stable-block-shift',effective:sourceRegions.length===1&&sourceRegions[0].id==='@volume'?'full-volume-fallback':'multi-emitter-envelopes'}:angularPattern==='guided'?{...sourceGuide}:null,integration:sourcePattern()?'exact-cell':['blue','importance'].includes(angularPattern)?'blue-noise-stratified':'midpoint',samplingLaw:angularPattern==='importance'?'cached-bank-mixture-25pct-exploration-v1':angularPattern==='regions'?'multi-region-complementary-solid-angle-v1':angularPattern==='guided'?'emitter-envelope-mixture-solid-angle-v1':angularPattern==='source'?'progressive-volume-induced-solid-angle-v1':'uniform-sphere-v1',surfaceReconstruction:{passes:surfaceReconstruction,...reconstruction?.metadata},
        importance:angularPattern==='importance'?{bankDirections:state.capacity,freshRaysPerReceiver:directions,exploration:.25,proposal:'recent-ray-contributions',cachedRadiance:false,scoreAndCdfBytes:total*state.capacity*8}:null,
        angularCache:{retained:retainComparisons,counts:[...angularStates.values()].filter(s=>s.family===family()).map(s=>s.capacity),variants:[...angularStates.keys()],visibilityPreparations,preparedRayDirections,lastPreparedDirections,bytes:[...angularStates.values()].reduce((sum,s)=>sum+s.capacity*(total*4+16)+(s.importance?total*s.capacity*8:0),0)}};
      return lastMetadata;
      }catch(error){
        sceneLightKey=null;
        for(const state of angularStates.values()){state.cacheBuilt=false;state.environmentCacheBuilt=false;state.prefix=null;state.refreshAll=true;}
        preparedSmoke.invalidateGeometry();softening?.invalidateGeometry();lastField=null;
        throw error;
      }
    },
    transportSource(){
      if(!lastField)throw new Error('transport source requires current encoded gather');
      return {...lastField,texture:lastOptions.surfaceScattering?scatteredSource.texture:lastLightingTexture,gain:lastOptions.surfaceScattering?1:lastOptions.gain};
    },
    destroy(){lastField=null;reproject?.destroy();for(const state of angularStates.values())for(const b of state.owned)b.destroy();angularStates.clear();softening?.destroy();scatteredSource?.destroy();reconstruction?.destroy();preparedSmoke.destroy();for(const b of resources)b.destroy();surface.destroy();surfaceBack.destroy();smoke.destroy();darkEnvironment.destroy();sceneLightBuffer.destroy();sceneLightHits.destroy();},
    async inspectRayInputs(ids){
      if(!lastMetadata)throw new Error('inspection requires a current encoded gather');
      if(!Array.isArray(ids)||!ids.length||ids.some(i=>!Number.isInteger(i)||i<0||i>=receivers.length))throw new Error('inspection receiver IDs invalid');
      const state=angularState(),count=angularPattern==='importance'?state.capacity:lastMetadata.directions,header=ids.length*32,pointBytes=count*16,guideOffset=header+pointBytes,hitOffset=guideOffset+32,colorOffset=Math.ceil((hitOffset+ids.length*count*4)/256)*256;
      const staging=device.createBuffer({label:'selected live lighting inputs',size:colorOffset+ids.length*512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      device.pushErrorScope('validation');
      const encoder=device.createCommandEncoder({label:'inspect selected actual receiver rays'});
      for(let i=0;i<ids.length;i++)encoder.copyBufferToBuffer(receiverBuffer,ids[i]*32,staging,i*32,32);
      encoder.copyBufferToBuffer(state.directionBuffer,0,staging,header,pointBytes);
      if(angularPattern==='guided')encoder.copyBufferToBuffer(guideBuffer,0,staging,guideOffset,32);
      for(let i=0;i<ids.length;i++){
        for(let a=0;a<count;a++){const at=sourcePattern()?a*total+ids[i]:ids[i]*state.capacity+a;encoder.copyBufferToBuffer(state.distances,at*4,staging,hitOffset+(i*count+a)*4,4);}
        const origin=[ids[i]%surfaceWidth,Math.floor(ids[i]/surfaceWidth),0];
        for(const [side,texture]of [[0,surface],[1,surfaceBack]])encoder.copyTextureToBuffer({texture,origin},{buffer:staging,offset:colorOffset+i*512+side*256,bytesPerRow:256,rowsPerImage:1},[1,1,1]);
      }
      device.queue.submit([encoder.finish()]);
      try{
        await device.queue.onSubmittedWorkDone();const error=await device.popErrorScope();if(error)throw new Error('lighting inspection GPU copy failed: '+error.message);
        await staging.mapAsync(GPUMapMode.READ);const data=new Float32Array(staging.getMappedRange());
        const points=Array.from({length:count},(_,a)=>Array.from(data.subarray(header/4+a*4,header/4+a*4+3)));
        const rows=ids.map((id,i)=>({id,position:Array.from(data.subarray(i*8,i*8+3)),normal:Array.from(data.subarray(i*8+4,i*8+7)),twoSided:data[i*8+3]>1.5,firstHits:Array.from(data.subarray(hitOffset/4+i*count,hitOffset/4+(i+1)*count)),front:Array.from(data.subarray(colorOffset/4+i*128,colorOffset/4+i*128+3)),back:Array.from(data.subarray(colorOffset/4+i*128+64,colorOffset/4+i*128+67))}));
        if(rows.some(r=>Math.abs(Math.hypot(...r.normal)-1)>.0001||r.firstHits.some(x=>!Number.isFinite(x)||x<=0)))throw new Error('lighting inspection contains unwritten ray inputs');
        const guide=angularPattern==='guided'?{lo:Array.from(data.subarray(guideOffset/4,guideOffset/4+3)),hi:Array.from(data.subarray(guideOffset/4+4,guideOffset/4+7))}:null;
        return {generation:lastMetadata.generation,directions:count,freshDirections:lastMetadata.directions,capacityDirections:state.capacity,sourceGuide:guide,points,rows};
      }finally{staging.destroy();}
    },
    async readback({includeScattering=false,includeSource=false,sourceOnly=false}={}) {
      if(sourceOnly&&!includeSource)throw new Error('source-only inspection requires source output');
      const staging=[];
      const encoder=device.createCommandEncoder({label:'distributed receiver evidence'});
      const fields=sourceOnly?[]:[['surface',surface,[surfaceWidth,surfaceHeight,1]],['surfaceBack',surfaceBack,[surfaceWidth,surfaceHeight,1]],['smoke',smoke,volumeDimensions]];
      if(includeSource){if(!lastField)throw new Error('inspection source not encoded');fields.push(['primarySource',lastField.texture,lastField.dimensions],['gatherSource',lastOptions.surfaceScattering?scatteredSource.texture:lastLightingTexture,lastField.dimensions]);}
      if(includeScattering&&scatteredSource)fields.push(['scatteredSource',scatteredSource.texture,[scatteredSource.texture.width,scatteredSource.texture.height,scatteredSource.texture.depthOrArrayLayers]],['preparedSmoke',preparedSmoke.texture,smokeReconstruction.dimensions]);
      for(const [name,texture,size] of fields) {
        const rowBytes=Math.ceil(size[0]*16/256)*256;
        const b=device.createBuffer({size:rowBytes*size[1]*size[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        encoder.copyTextureToBuffer({texture},{buffer:b,bytesPerRow:rowBytes,rowsPerImage:size[1]},size);
        staging.push({name,b,size,rowBytes});
      }
      device.queue.submit([encoder.finish()]);
      const result={};
      try {
        for(const {name,b,size,rowBytes} of staging){await b.mapAsync(GPUMapMode.READ);const raw=new Float32Array(b.getMappedRange());const data=new Float32Array(size[0]*size[1]*size[2]*4);
          for(let row=0;row<size[1]*size[2];row++)data.set(raw.subarray(row*rowBytes/4,row*rowBytes/4+size[0]*4),row*size[0]*4);
          result[name]={dimensions:size,data};b.unmap();}
        return result;
      }finally{for(const {b} of staging)b.destroy();}
    },
  };
}

const GATHER_WGSL_BODY=`
struct Node {lo:vec4<f32>,hi:vec4<f32>,range:vec4<u32>}
struct Triangle {a:vec4<f32>,e1:vec4<f32>,e2:vec4<f32>}
struct Receiver {position:vec4<f32>,normal:vec4<f32>}
@group(0) @binding(0) var<storage,read> nodes:array<Node>;
@group(0) @binding(1) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(2) var<storage,read> receivers:array<Receiver>;
@group(0) @binding(3) var<storage,read> directions:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> firstHits:array<f32>;
@group(0) @binding(5) var coefficients:texture_3d<f32>;
@group(0) @binding(6) var surfaceOut:texture_storage_2d<rgba32float,write>;
@group(0) @binding(7) var smokeOut:texture_storage_3d<rgba32float,write>;
@group(0) @binding(8) var<uniform> settings:vec4<f32>;
@group(0) @binding(9) var surfaceBackOut:texture_storage_2d<rgba32float,write>;
@group(0) @binding(11) var environment:texture_2d<f32>;
@group(0) @binding(12) var<uniform> environmentSettings:vec4<f32>;
struct SceneLight {positionType:vec4<f32>,colorDecay:vec4<f32>,directionCutoff:vec4<f32>,spot:vec4<f32>}
@group(0) @binding(15) var<storage,read> sceneLights:array<SceneLight>;
@group(0) @binding(16) var<uniform> sceneLightSettings:vec4<f32>;
@group(0) @binding(17) var<storage,read_write> sceneLightHits:array<f32>;
fn sceneLightRay(light:SceneLight,p:vec3<f32>)->vec4<f32>{
  if(light.positionType.w>2.5){return vec4<f32>(-light.directionCutoff.xyz,1e20);}
  let delta=light.positionType.xyz-p;let distance=length(delta);
  return vec4<f32>(delta/max(distance,1e-20),distance);
}
@compute @workgroup_size(64)
fn cacheSceneLights(@builtin(global_invocation_id) global:vec3<u32>){
  let id=global.x+global.y*DISPATCH_WIDTH;let count=u32(sceneLightSettings.x);
  if(id>=(RECEIVER_COUNT-SURFACE_COUNT)*count){return;}
  let p=receivers[SURFACE_COUNT+id/count].position.xyz;let light=sceneLights[id%count];let ray=sceneLightRay(light,p);
  var hit=1e20;if(light.spot.z>0.5&&ray.w>0.00001){hit=firstSolid(p,ray.xyz);}
  sceneLightHits[id]=hit;
}
fn sceneLightIncident(receiver:u32,p:vec3<f32>)->vec3<f32>{
  var sum=vec3<f32>(0.0);let count=u32(sceneLightSettings.x);
  for(var i=0u;i<count;i++){
    let light=sceneLights[i];let ray=sceneLightRay(light,p);
    if(ray.w<=0.00001||sceneLightHits[(receiver-SURFACE_COUNT)*count+i]<ray.w-0.00001){continue;}
    var attenuation=1.0;
    if(light.positionType.w<2.5){
      let distance=ray.w*sceneLightSettings.y;
      attenuation=1.0/max(pow(distance,light.colorDecay.w),0.01);
      let cutoff=light.directionCutoff.w;
      if(cutoff>0.0){let window=clamp(1.0-pow(distance/cutoff,4.0),0.0,1.0);attenuation*=window*window;}
      if(light.positionType.w>1.5){
        let cosine=dot(-ray.xyz,light.directionCutoff.xyz);
        if(light.spot.y-light.spot.x<1e-7){attenuation*=select(0.0,1.0,cosine>=light.spot.x);}
        else {attenuation*=smoothstep(light.spot.x,light.spot.y,cosine);}
      }
    }
    if(attenuation<=0.0){continue;}
    // Isotropic single scattering: punctual irradiance / 4pi. World distance
    // falloff follows the actual Three light, medium integration stays local.
    sum+=light.colorDecay.rgb*(attenuation/12.566370614359172)*integrateRay(p,ray.xyz,ray.w).a;
  }
  return sum;
}
fn environmentAt(d:vec3<f32>)->vec3<f32>{
  let dims=textureDimensions(environment);
  let uv=vec2<f32>(fract(atan2(d.z,d.x)/6.28318530718+0.5),acos(clamp(d.y,-1.0,1.0))/3.14159265359);
  let pixel=clamp(vec2<i32>(floor(uv*vec2<f32>(dims))),vec2<i32>(0),vec2<i32>(dims)-1);
  return textureLoad(environment,pixel,0).rgb;
}
fn receiverRotation(p:vec3<f32>)->vec4<f32> {
  // Same position, same rotation even at duplicated mesh vertices. No frame or
  // receiver-index seed: cache and live rays retain exactly the same geometry.
  if(BLUE_PATTERN){return blueReceiverRotation(p);}
  if(!SPATIAL_PATTERN){return vec4<f32>(0.0,0.0,0.0,1.0);}
  var h=bitcast<vec3<u32>>(p);
  h=(h^(h>>vec3<u32>(16u)))*vec3<u32>(2246822519u);
  var seed=h.x^(h.y*3266489917u)^(h.z*668265263u);
  seed=(seed^(seed>>16u))*2246822519u;
  let a=f32(seed&0x00ffffffu)/16777216.0;
  seed=(seed^(seed>>13u))*3266489917u;
  let b=f32(seed&0x00ffffffu)/16777216.0;
  seed=(seed^(seed>>16u))*668265263u;
  let c=f32(seed&0x00ffffffu)/16777216.0;
  // Uniform quaternion rotation of the complete antipodal constellation.
  return vec4<f32>(sqrt(1.0-a)*sin(6.28318530718*b),sqrt(1.0-a)*cos(6.28318530718*b),sqrt(a)*sin(6.28318530718*c),sqrt(a)*cos(6.28318530718*c));
}
fn angularDirection(q:vec4<f32>,a:u32)->vec3<f32> {
  let d=directions[a].xyz;
  return d+2.0*cross(q.xyz,cross(q.xyz,d)+q.w*d);
}
fn receiverOrigin(r:Receiver,d:vec3<f32>)->vec3<f32> {
  if(SOURCE_PATTERN){return r.position.xyz;}
  // Opaque sides have different ray origins. Cache and live integration must
  // use the same one, including when a source normal is inverted.
  var side=1.0;
  if(r.position.w>1.5&&dot(r.normal.xyz,d)<0.0){side=-1.0;}
  return r.position.xyz+r.normal.xyz*(side*0.0001);
}
fn interval(p:vec3<f32>,d:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>,limit:f32)->vec2<f32> {
  var near=0.0;var far=limit;
  for(var a=0u;a<3u;a++) {
    if(abs(d[a])<1e-20) {if(p[a]<lo[a]||p[a]>hi[a]) {return vec2<f32>(1.0,-1.0);}}
    else {let t0=(lo[a]-p[a])/d[a];let t1=(hi[a]-p[a])/d[a];near=max(near,min(t0,t1));far=min(far,max(t0,t1));}
  }
  return vec2<f32>(near,far);
}
@compute @workgroup_size(64)
fn cacheGeometry(@builtin(global_invocation_id) global:vec3<u32>) {
  let id=vec3<u32>(global.x+global.y*DISPATCH_WIDTH,0u,0u);
  if(id.x>=RECEIVER_COUNT*(DIRECTION_COUNT-CACHE_START)){return;}
  var receiverIndex=id.x/DIRECTION_COUNT;var a=id.x%DIRECTION_COUNT;var address=id.x;
  if(SOURCE_PATTERN){receiverIndex=id.x%RECEIVER_COUNT;a=CACHE_START+id.x/RECEIVER_COUNT;address=a*RECEIVER_COUNT+receiverIndex;}
  let r=receivers[receiverIndex];var d=angularDirection(receiverRotation(r.position.xyz),a);
  if(SOURCE_PATTERN){d=sourceDirection(r.position.xyz,a);}
  let p=receiverOrigin(r,d);
  firstHits[address]=firstSolid(p,d);
}
fn firstSolid(p:vec3<f32>,d:vec3<f32>)->f32 {
  var closest=1e20;var n=0u;
  loop {
    if(n>=NODE_COUNT){break;}
    let node=nodes[n];let span=interval(p,d,node.lo.xyz,node.hi.xyz,closest);
    if(span.y<span.x){n=node.range.x;continue;}
    if(node.range.z==0u){n++;continue;}
    for(var t=node.range.y;t<node.range.y+node.range.z;t++) {
      let tri=triangles[t];let h=cross(d,tri.e2.xyz);let det=dot(tri.e1.xyz,h);
      if(abs(det)<1e-12*length(tri.e1.xyz)*length(tri.e2.xyz)){continue;}
      let s=p-tri.a.xyz;let u=dot(s,h)/det;let q=cross(s,tri.e1.xyz);let v=dot(d,q)/det;
      let distance=dot(tri.e2.xyz,q)/det;
      if(u>=0.0&&v>=0.0&&u+v<=1.0&&distance>0.00001&&distance<closest){closest=distance;}
    }
    n=node.range.x;
  }
  return closest;
}
fn integrateRay(p:vec3<f32>,d:vec3<f32>,limit:f32)->vec4<f32> {return integrateRayPhased(p,d,limit,0.5);}
fn integrateRayPhased(p:vec3<f32>,d:vec3<f32>,limit:f32,phase:f32)->vec4<f32> {
  let span=interval(p,d,vec3<f32>(-1.0),sourceDomainHi(),limit);
  if(span.y<=span.x){return vec4<f32>(0.0,0.0,0.0,1.0);}
  let count=u32(ceil((span.y-span.x)/settings.y));let ds=(span.y-span.x)/f32(count);
  let dims=textureDimensions(coefficients);let pitch=2.0/f32(dims.x);
  var radiance=vec3<f32>(0.0);var transmission=1.0;
  for(var i=0u;i<count;i++) {
    let samplePosition=p+d*(span.x+(f32(i)+phase)*ds);
    let c=clamp(vec3<i32>(floor((samplePosition+vec3<f32>(1.0))/pitch)),vec3<i32>(0),vec3<i32>(dims)-1);
    let m=textureLoad(coefficients,c,0);let sigma=max(0.0,m.a);let tau=sigma*ds;
    var weight=ds*(1.0-tau*0.5+tau*tau/6.0);
    if(tau>=0.001){weight=(1.0-exp(-tau))/sigma;}
    radiance+=transmission*m.rgb*weight;transmission*=exp(-tau);
  }
  return vec4<f32>(radiance,transmission);
}
fn gatherReceiver(receiver:u32) {
  let id=vec3<u32>(receiver,0u,0u);
  if(id.x>=u32(settings.z)){return;}
  let r=receivers[id.x];
  let rotation=receiverRotation(r.position.xyz);
  var sum=vec3<f32>(0.0);var backSum=vec3<f32>(0.0);var sky=vec3<f32>(0.0);
  for(var sampleIndex=0u;sampleIndex<u32(settings.w);sampleIndex++) {
    var a=sampleIndex;var weight=1.0/settings.w;
    if(IMPORTANCE_PATTERN){
      let u=(f32(sampleIndex)+blueRayPhase(r.position.xyz,sampleIndex*2u+103u))/settings.w;
      a=selectImportance(id.x,u);weight/=f32(DIRECTION_COUNT)*importanceProbability(id.x,a);
    }
    var d=angularDirection(rotation,a);
    var address=id.x*DIRECTION_COUNT+a;
    if(SOURCE_PATTERN){
      d=sourceDirection(r.position.xyz,a);
      let pdf=sourcePdf(r.position.xyz,d);
      if(pdf<=0.0){continue;}
      weight/=12.566370614359172*pdf;
      address=a*RECEIVER_COUNT+id.x;
    }
    let cosine=dot(r.normal.xyz,d);
    if(r.position.w>0.5){weight*=12.566370614359172*select(max(0.0,cosine),abs(cosine),r.position.w>1.5);}
    if(weight>0.0){
      var incident=vec3<f32>(0.0);var environmentIncident=vec3<f32>(0.0);
      if(SOURCE_PATTERN){incident=integrateCells(receiverOrigin(r,d),d,firstHits[address]);}
      else {
        let integrated=integrateRayPhased(receiverOrigin(r,d),d,firstHits[address],blueRayPhase(r.position.xyz,a));incident=integrated.rgb;
        // A solid beyond the volume still blocks the sky. Reuse this ray's
        // existing medium transmission; environment is not multiplied by fire gain.
        if(id.x>=SURFACE_COUNT&&environmentSettings.x>0.0&&firstHits[address]>=1e19){environmentIncident=environmentAt(d)*integrated.a;sky+=environmentIncident*weight;}
      }
      if(IMPORTANCE_PATTERN){recordImportance(id.x,a,incident*settings.x+environmentIncident);}
      let contribution=incident*weight;
      if(r.position.w>1.5&&cosine<0.0){backSum+=contribution;}else{sum+=contribution;}
    }
  }
  if(SOURCE_PATTERN&&id.x>=SURFACE_COUNT&&environmentSettings.x>0.0){sky=sourceEnvironment(id.x,r.position.xyz);}
  if(id.x>=SURFACE_COUNT){sky+=sceneLightIncident(id.x,r.position.xyz);}
  let output=vec4<f32>(sum*settings.x+sky,1.0);
  if(id.x<SURFACE_COUNT){
    let pixel=vec2<i32>(i32(id.x%SURFACE_WIDTH),i32(id.x/SURFACE_WIDTH));
    textureStore(surfaceOut,pixel,output);textureStore(surfaceBackOut,pixel,vec4<f32>(backSum*settings.x,1.0));
  }
  else {let index=id.x-SURFACE_COUNT;textureStore(smokeOut,vec3<i32>(i32(index%VOLUME_GRID),i32((index/VOLUME_GRID)%VOLUME_HEIGHT),i32(index/(VOLUME_HEIGHT*VOLUME_GRID))),output);}
}
@compute @workgroup_size(64)
fn gatherLight(@builtin(global_invocation_id) global:vec3<u32>){gatherReceiver(global.x+global.y*DISPATCH_WIDTH);}
@compute @workgroup_size(64)
fn gatherVolume(@builtin(global_invocation_id) global:vec3<u32>){gatherReceiver(SURFACE_COUNT+global.x+global.y*DISPATCH_WIDTH);}
`;
// Source-directed flame quadrature cannot cover sky directions. These modes
// use their own full-sphere constellation; default fixed/spatial modes reuse
// the already evaluated flame rays without another integration loop.
const SOURCE_ENVIRONMENT_WGSL=`
@group(0) @binding(13) var<storage,read> environmentDirections:array<vec4<f32>>;
@group(0) @binding(14) var<storage,read_write> environmentHits:array<f32>;
@compute @workgroup_size(64)
fn cacheEnvironment(@builtin(global_invocation_id) global:vec3<u32>){
  let id=global.x+global.y*DISPATCH_WIDTH;
  let count=u32(environmentSettings.y);
  if(id>=(RECEIVER_COUNT-SURFACE_COUNT)*count){return;}
  let receiver=SURFACE_COUNT+id/count;let a=id%count;
  environmentHits[(receiver-SURFACE_COUNT)*DIRECTION_COUNT+a]=firstSolid(receivers[receiver].position.xyz,environmentDirections[a].xyz);
}
fn sourceEnvironment(receiver:u32,p:vec3<f32>)->vec3<f32>{
  var sky=vec3<f32>(0.0);
  for(var a=0u;a<u32(environmentSettings.y);a++){
    if(environmentHits[(receiver-SURFACE_COUNT)*DIRECTION_COUNT+a]<1e19){continue;}
    let d=environmentDirections[a].xyz;
    sky+=environmentAt(d)*integrateRay(p,d,1e20).a/environmentSettings.y;
  }
  return sky;
}
`;
export const GATHER_WGSL=GATHER_WGSL_BODY+'fn sourceEnvironment(receiver:u32,p:vec3<f32>)->vec3<f32>{return vec3<f32>(0.0);}'+SOURCE_AWARE_WGSL;
