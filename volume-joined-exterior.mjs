// Joined normal-frame owner. Fine predictor -> exterior predictor -> ONE shared
// projection -> both velocity stores/lower planes -> next-step material ghosts.
// Optical texture is the same exterior state, published after correction.
import {createOuterSmoke,outerSmokeConfig,validateOuterSmokeDevice} from './volume-outer-smoke.mjs';
import {createCompositeProducerLayout} from './volume-composite-producer.mjs';
import {createCompositeProducerGPU} from './volume-composite-producer-gpu.mjs';
import {createCompositeStorageLayout} from './volume-composite-storage.mjs';
import {createCompositeStorageGPU,createCompositeLowerFaceGPU} from './volume-composite-storage-gpu.mjs';
import {createCompositePCGGPU} from './volume-composite-pcg-gpu.mjs';
import {createGpuSceneSolidProducer} from './scene-solid-gpu.mjs';
export const JOINED_EXTERIOR_ROUTE='joined-exterior-transport-pressure-v1';
export function resolveJoinedExteriorGeometry({fineDims,pitch,coarseResolution=32,size=2,reactant=false}) {
  try {
    if(!fineDims || fineDims[0]!==fineDims[2] || ![1,2].includes(fineDims[1]/fineDims[0]) || Math.abs(pitch*fineDims[0]-2)>1e-6)
      throw Error('exterior currently supports unit fine cube or double-height box');
    const config=outerSmokeConfig({grid:coarseResolution,extent:size,nearHeightRatio:fineDims[1]/fineDims[0],materialMode:reactant?'reactant-raw':'authored-raw',donorMode:'joined-full',pressureIterations:1});
    validateOuterSmokeDevice(config,{maxTextureDimension3D:Infinity,maxBufferSize:Infinity,maxStorageBufferBindingSize:Infinity,maxComputeWorkgroupsPerDimension:Infinity});
    const ratio=config.cellWidth/pitch,origin=config.min.map(v=>(-1-v)/config.cellWidth);
    const fineMax=[1,2*fineDims[1]/fineDims[0]-1,1];
    const end=fineMax.map((v,a)=>(v-config.min[a])/config.cellWidth);
    if([...origin,...end].some(v=>Math.abs(v-Math.round(v))>1e-9))throw Error('fine box must be coarse-cell aligned');
    if(origin.some((v,a)=>v<0||end[a]>config.shape[a]))throw Error('fine box must fit exterior');
    return {admitted:true,reason:null,config,shape:config.shape,origin,ratio,cellWidth:config.cellWidth,
      geometry:{shape:config.shape,min:config.min,cellWidth:config.cellWidth,fine:{min:[-1,-1,-1],max:[1,2*fineDims[1]/fineDims[0]-1,1],ratio}},
      ghosts:{originFine:config.min.map(v=>(v+1)/pitch),cellWidthFine:ratio,dims:config.shape,finePitchLocal:pitch,oxidizer:reactant?'passive-ambient-boundary':'unavailable'}};
  } catch(e) {return {admitted:false,reason:e.message};}
}
export function resolveJoinedExteriorWall(wall,g){
  if(!wall)return null;
  if(wall.side){
    const axis=wall.side.endsWith('y')?1:wall.side.endsWith('x')?0:2,positive=wall.side.startsWith('+');
    const gap=wall.gap??2,thickness=wall.thickness??1;
    const fineMax=g.geometry.fine.max[axis],fineMin=g.geometry.fine.min[axis],lo=g.geometry.min[axis],h=g.cellWidth;
    const at=positive?Math.ceil((fineMax-lo)/h)+gap:Math.floor((fineMin-lo)/h)-gap-thickness;
    return {axis,at,thickness,side:wall.side,gap,outside:at<0||at+thickness>g.shape[axis]};
  }
  return {...wall,thickness:wall.thickness??1};
}
export function joinedExteriorSolids(shape,wall){
  const cells=new Uint8Array(shape.reduce((a,b)=>a*b,1));
  if(wall){
    if(![0,1,2].includes(wall.axis)||!Number.isInteger(wall.at)||!Number.isInteger(wall.thickness)||wall.thickness<1)throw Error('invalid exterior wall');
    for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)for(let x=0;x<shape[0];x++){
      const q=[x,y,z];if(q[wall.axis]>=wall.at&&q[wall.axis]<wall.at+wall.thickness)cells[x+shape[0]*(y+shape[1]*z)]=1;
    }
  }
  return {shape:[...shape],cells,revision:JSON.stringify(wall)};
}
export function createJoinedExterior(device,{coarseResolution=32,size=2,wall=null,budget=32,tolerance=1e-3,residentSolids=false}={}){
  if(!Number.isInteger(budget)||budget<1)throw Error('positive integer budget required');
  let built=null,destroyed=false,paused=false,lastStep=null,generation=0,topologyGeneration=0;
  let preparationFailure=null;
  const admissionKey=p=>JSON.stringify([p.dims,p.pitch,p.allocation,p.reactant?.allocation,p.reactant?.effective?.admitted===true,revision(p)]);
  const key=p=>JSON.stringify([p.dims,p.pitch,p.allocation,p.reactant?.effective?.admitted===true,p.reactant?.allocation??0]);
  const revision=p=>JSON.stringify([p.solidMask?.revision??'disabled',p.sceneSolids?.revision??'disabled']);
  const clear=()=>{if(built)for(const r of [...built.owned,...(built.projectionOwned??[])])r.destroy?.();built=null;lastStep=null;};
  function projection(g,fineSolids,coarseSolids){
    const owned=[];
    try{
      const layout=createCompositeProducerLayout({geometry:g.geometry,fineSolids,coarseSolids,fixedTopology:residentSolids}),storage=createCompositeStorageLayout(layout.grid);
      const solver=createCompositePCGGPU(device,layout.grid,{tolerance,residentSolids});owned.push(solver);
      const intake=createCompositeProducerGPU(device,layout);owned.push(intake);
      return {layout,storage,solver,intake,projectionOwned:owned,bridges:[],pressureSteps:0};
    }catch(e){for(const r of owned)r.destroy?.();throw e;}
  }
  function maskTexture(shape,cells,owned){
    const t=device.createTexture({label:'joined resident solid mask',size:shape,dimension:'3d',format:'r32uint',mipLevelCount:1,sampleCount:1,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(t);
    writeMask(t,shape,cells);return t;
  }
  function writeMask(t,shape,cells){
    if(!(cells instanceof Uint8Array)||cells.length!==shape.reduce((a,b)=>a*b,1))throw Error('fine solid coverage mismatch');
    device.queue.writeTexture({texture:t},Uint32Array.from(cells,v=>Number(v!==0)),{bytesPerRow:shape[0]*4,rowsPerImage:shape[1]},shape);
  }
  function bindResident(b,p){
    const fine=p.solidMask?.backend==='gpu'?p.solidMask.texture:b.fineMaskTexture;
    const scene=p.sceneSolids;
    let coarse=b.coarseMaskTexture,coarseRevision=b.coarseSolids.revision;
    let sceneReceipt={backend:'configured-wall',status:'host-authored'};
    if(scene?.objects?.length){
      const t=scene.transform,halfWidth=b.g.cellWidth*b.g.shape[0]/2;
      if(!t||!Number.isFinite(t.scale)||t.scale<=0||t.translate?.length!==3||!t.translate.every(Number.isFinite))throw Error('invalid exterior scene transform');
      const transform={scale:t.scale*halfWidth,translate:b.g.config.min.map((v,a)=>t.translate[a]+t.scale*(v+halfWidth))};
      if(!b.sceneProducer){b.sceneProducer=createGpuSceneSolidProducer(device,{grid:b.g.shape[0],gridHeight:b.g.shape[1]});}
      const geometry=b.sceneProducer.update(scene.objects,transform,{grid:b.g.shape[0],gridHeight:b.g.shape[1]},{wallCells:b.wallCells});
      const encoder=device.createCommandEncoder({label:'exterior scene solid GPU rebuild'});
      if(b.sceneProducer.encode(encoder))device.queue.submit([encoder.finish()]);
      coarse=b.sceneProducer.texture;coarseRevision=JSON.stringify([geometry.revision,b.coarseSolids.revision]);
      sceneReceipt={backend:'gpu',status:'submitted-unverified',revision:geometry.revision,members:geometry.members,triangleCount:geometry.triangleCount};
    }
    // Validate before changing any current GPU data or revision identity.
    b.solver.bindSolids({fine,coarse});
    b.outer.bindSolids(coarse,coarseRevision);
    if(!scene?.objects?.length&&b.sceneProducer){b.sceneProducer.destroy();b.sceneProducer=null;}
    b.summary.solids.coarse=coarseRevision;b.summary.solids.scene=sceneReceipt;
    if(p.solidMask?.backend!=='gpu')writeMask(fine,p.dims,p.solidMask?.cells??new Uint8Array(p.dims.reduce((a,b)=>a*b,1)));
  }
  function prepare(p){
    if(destroyed)throw Error('joined exterior destroyed');
    const k=key(p),solidRevision=revision(p);
    if(built?.outer&&built.key===k){
      if(built.solidRevision===solidRevision){preparationFailure=null;return {rebuilt:false,...built.summary};}
      try{
        if(residentSolids){
          bindResident(built,p);built.solidRevision=solidRevision;built.layout.solidRevisions.fine=solidRevision;
          built.summary.solids.fine=solidRevision;preparationFailure=null;
          return {rebuilt:false,topologyRebuilt:false,coefficients:'gpu-next-projection',...built.summary};
        }
        const cells=p.solidMask?.cells??new Uint8Array(p.dims.reduce((a,b)=>a*b,1));
        if(!(cells instanceof Uint8Array)||cells.length!==built.fineCells.length)throw Error('fine solid coverage mismatch');
        const changed=cells.some((v,i)=>(v!==0)!==(built.fineCells[i]!==0));
        if(changed){
          // Only topology depends on collider occupancy. Keep transported
          // material, velocity, optical texture and lower-plane storage alive.
          // Construct first: a failed update must not destroy the live state.
          const next=projection(built.g,{shape:p.dims,cells,revision:solidRevision},built.coarseSolids);
          for(const r of built.projectionOwned)r.destroy?.();
          Object.assign(built,next);built.fineCells=cells.slice();topologyGeneration++;
          built.summary.cells=next.layout.grid.cells.length;built.summary.faces=next.layout.grid.faces.length;
        }
        built.solidRevision=solidRevision;built.layout.solidRevisions.fine=solidRevision;
        built.summary.solids.fine=solidRevision;preparationFailure=null;
        return {rebuilt:false,topologyRebuilt:changed,...built.summary};
      }catch(e){if(residentSolids)preparationFailure={key:admissionKey(p),reason:e.message};return {rebuilt:false,admitted:false,reason:e.message};}
    }
    if(built?.key===k&&!built.outer&&(!preparationFailure||preparationFailure.key===admissionKey(p)))return {rebuilt:false,...built.summary};
    clear();generation++;
    const reactant=p.reactant?.effective?.admitted===true;
    const g=resolveJoinedExteriorGeometry({fineDims:p.dims,pitch:p.pitch,coarseResolution,size,reactant});
    if(!g.admitted){built={key:k,owned:[],summary:g};return g;}
    const owned=[];let projected=null;
    try{
      if(p.fluidBuffers?.length!==2||!p.lowerFaceTexture||!p.burnRateTexture)throw Error('producer-resources-missing');
      const slab=resolveJoinedExteriorWall(wall,g);if(slab?.outside)throw Error('wall-outside-exterior');
      if(p.solidMask?.backend==='gpu'&&!residentSolids)throw Error('compact pressure requires CPU solids; resident pressure required for GPU mask');
      const fineSolids={shape:p.dims,cells:p.solidMask?.cells??new Uint8Array(p.dims.reduce((a,b)=>a*b,1)),revision:String(p.solidMask?.revision??'disabled')};
      const coarseSolids=joinedExteriorSolids(g.shape,slab);
      projected=projection(g,fineSolids,coarseSolids);
      if(residentSolids){
        projected.fineMaskTexture=maskTexture(p.dims,fineSolids.cells,projected.projectionOwned);
        projected.coarseMaskTexture=maskTexture(g.shape,coarseSolids.cells,projected.projectionOwned);
      }
      const {layout,storage}=projected;
      const outer=createOuterSmoke(device,g.config,p.dims[0],p.fluidBuffers,{reactantTextures:p.reactant?.textures,reactantEffective:p.reactant?.effective,physicsAppearance:p.physicsAppearance});owned.push(outer);
      const row=Math.ceil(g.shape[0]/256)*256,packed=new Uint8Array(row*g.shape[1]*g.shape[2]);
      for(let z=0;z<g.shape[2];z++)for(let y=0;y<g.shape[1];y++){
        const i=g.shape[0]*(y+g.shape[1]*z);packed.set(coarseSolids.cells.subarray(i,i+g.shape[0]),row*(y+g.shape[1]*z));
      }
      outer.setSolids({data:packed,bytesPerRow:row,rowsPerImage:g.shape[1]},coarseSolids.revision);
      const lower=device.createBuffer({label:'joined lower faces',size:storage.lowerLength*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(lower);
      const lowerExport=createCompositeLowerFaceGPU(device,{dims:p.dims,lowerBuffer:lower,lowerFaceTexture:p.lowerFaceTexture});
      const summary={admitted:true,route:JOINED_EXTERIOR_ROUTE,shape:g.shape,origin:g.origin,ratio:g.ratio,cellWidth:g.cellWidth,
        bounds:{min:g.config.min,max:g.config.max},cells:layout.grid.cells.length,faces:layout.grid.faces.length,budget,tolerance,
        solids:{fine:fineSolids.revision,coarse:coarseSolids.revision,wall:slab},pressureTopology:residentSolids?'fixed-resident-mask':'compact-cpu-mask',boundaryVelocity:'stationary-zero',materialMode:g.config.materialMode,lighting:'boundary-incident-continuation',reaction:'fine-only',forces:'exterior-linear-heat-lift-not-fine-force-parity'};
      topologyGeneration++;
      built={key:k,owned,g,...projected,outer,lower,lowerExport,steps:0,summary,solidRevision,coarseSolids,fineCells:fineSolids.cells.slice()};
      if(residentSolids){
        built.wallCells=[];
        for(let z=0;z<g.shape[2];z++)for(let y=0;y<g.shape[1];y++)for(let x=0;x<g.shape[0];x++)if(coarseSolids.cells[x+g.shape[0]*(y+g.shape[1]*z)])built.wallCells.push({x,y,z});
        const owner=built;owned.push({destroy(){owner.sceneProducer?.destroy();owner.sceneProducer=null;}});
        bindResident(built,p);
      }
      preparationFailure=null;
      return {rebuilt:true,...summary};
    }catch(e){for(const r of [...owned,...(projected?.projectionOwned??[])])r.destroy?.();built={key:k,owned:[],summary:{admitted:false,reason:e.message}};preparationFailure={key:admissionKey(p),reason:e.message};return {rebuilt:true,...built.summary};}
  }
  function seedGhosts(p){
    if(!built?.outer||!p.ghosts?.textures)return false;
    const e=device.createCommandEncoder({label:'joined initial ghosts'});
    built.outer.encodeGhostSnapshot(e,p.ghosts.textures);device.queue.submit([e.finish()]);return true;
  }
  function step(e,p){
    if(destroyed)throw Error('joined exterior destroyed');
    if(!built?.outer||built.key!==key(p)||built.solidRevision!==revision(p))return lastStep={stepped:false,reason:'exterior-not-prepared-for-current-producer'};
    if(!p.ghosts?.textures)return lastStep={stepped:false,reason:'ghost-textures-missing'};
    built.outer.setReactantEffective(p.reactant?.effective);
    built.outer.setPhysicsAppearance(p.physicsAppearance);
    built.outer.encodeExternalProjection(e,p.fluidReadIndex,p.timeStep,(encoder,coarse)=>{
      let entry=built.bridges.find(b=>b.fine===p.fluidBuffer&&b.coarse===coarse);
      if(!entry){const bridge=createCompositeStorageGPU(device,built.storage,{fine:p.fluidBuffer,coarse,lower:built.lower,flux:built.solver.fluxBuffer});built.projectionOwned.push(bridge);entry={fine:p.fluidBuffer,coarse,bridge};built.bridges.push(entry);}
      entry.bridge.encodeGather(encoder,{interfaceSource:'fine'});
      built.intake.encode(encoder,{targetTexture:p.burnRateTexture,solidRevisions:built.layout.solidRevisions});
      built.solver.encodeGPU(encoder,{targetBuffer:built.intake.targetBuffer,iterations:budget,reset:built.pressureSteps===0});
      entry.bridge.encodeScatter(encoder);built.lowerExport.encode(encoder);
    });
    built.outer.encodeGhostSnapshot(e,p.ghosts.textures);
    built.steps++;built.pressureSteps++;return lastStep={stepped:true,reason:null,steps:built.steps,budget};
  }
  async function probe(){
    if(!built?.solver||!built.pressureSteps)return {status:'no-step-yet'};
    const b=built;paused=true;
    try{const solver=b.solver;await device.queue.onSubmittedWorkDone();if(b!==built||solver!==b.solver)return {status:'generation-changed'};const r=await solver.readback();if(b!==built||solver!==b.solver)return {status:'generation-changed'};
      return {status:'sampled',converged:r.converged,iterations:r.receipt.iterations,budget,maxDivergenceError:r.receipt.maxDivergenceError,steps:b.steps};
    }finally{paused=false;}
  }
  return {prepare,seedGhosts,step,probe,residentSolids,
    async sampleSceneSolids(){
      const b=built,producer=b?.sceneProducer,revision=b?.solidRevision;
      if(!producer)return {status:'not-scene-gpu',scene:b?.summary.solids.scene??null};
      const sampled=await producer.snapshot();
      if(b!==built||producer!==built.sceneProducer||revision!==built.solidRevision)return {status:'stale',revision};
      b.summary.solids.scene={...b.summary.solids.scene,status:sampled.valid?'accepted':'empty',solidCellCount:sampled.counts[0],validation:'explicit-gpu-snapshot'};
      return {status:'sampled',...sampled,scene:b.summary.solids.scene};
    },
    deferRetry(p,reason){preparationFailure={key:admissionKey(p),reason};},
    retryAvailable:p=>Boolean(preparationFailure&&preparationFailure.key!==admissionKey(p)),
    canUpdateSolids:p=>Boolean(residentSolids&&built?.outer&&built.key===key(p)),
    admission:p=>preparationFailure?.key===admissionKey(p)?{admitted:false,reason:preparationFailure.reason}:resolveJoinedExteriorGeometry({fineDims:p.dims,pitch:p.pitch,coarseResolution,size,reactant:p.reactant?.effective?.admitted===true}),
    matches:p=>Boolean(built?.outer&&built.key===key(p)&&built.solidRevision===revision(p)),
    get paused(){return paused;},get ghosts(){return built?.g?.ghosts??null;},get optical(){return built?.outer?.optical??null;},
    receipt(){return {route:JOINED_EXTERIOR_ROUTE,coarseResolution,size,budget,tolerance,generation,topologyGeneration,...structuredClone(built?.summary),steps:built?.steps??0,lastStep,outer:built?.outer?.receipt()??null};},
    async stats(){if(!built?.outer)return {status:'unprepared'};const b=built;paused=true;try{await device.queue.onSubmittedWorkDone();const values=await b.outer.readState();return {status:b===built?'sampled':'generation-changed',steps:b.steps,values:Array.from(values),receipt:b.outer.receipt()};}finally{paused=false;}},
    destroy(){if(!destroyed){clear();destroyed=true;}}
  };
}
