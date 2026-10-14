// Joined normal-frame owner. Fine predictor -> exterior predictor -> ONE shared
// projection -> both velocity stores/lower planes -> next-step material ghosts.
// Optical texture is the same exterior state, published after correction.
import {createOuterSmoke,outerSmokeConfig,validateOuterSmokeDevice} from './volume-outer-smoke.mjs';
import {createCompositeProducerLayout} from './volume-composite-producer.mjs';
import {createCompositeProducerGPU} from './volume-composite-producer-gpu.mjs';
import {createCompositeStorageLayout} from './volume-composite-storage.mjs';
import {createCompositeStorageGPU,createCompositeLowerFaceGPU} from './volume-composite-storage-gpu.mjs';
import {createCompositePCGGPU} from './volume-composite-pcg-gpu.mjs';
export const JOINED_EXTERIOR_ROUTE='joined-exterior-transport-pressure-v1';
export function resolveJoinedExteriorGeometry({fineDims,pitch,coarseResolution=32,size=2,reactant=false}) {
  try {
    if(!fineDims || fineDims[0]!==fineDims[2] || ![1,2].includes(fineDims[1]/fineDims[0]) || Math.abs(pitch*fineDims[0]-2)>1e-6)
      throw Error('exterior currently supports unit fine cube or double-height box');
    const config=outerSmokeConfig({grid:coarseResolution,extent:size,nearHeightRatio:fineDims[1]/fineDims[0],materialMode:reactant?'reactant-raw':'authored-raw',donorMode:'joined-full',pressureIterations:1});
    validateOuterSmokeDevice(config,{maxTextureDimension3D:Infinity,maxBufferSize:Infinity,maxStorageBufferBindingSize:Infinity,maxComputeWorkgroupsPerDimension:Infinity});
    const ratio=config.cellWidth/pitch,origin=config.min.map(v=>(-1-v)/config.cellWidth);
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
export function createJoinedExterior(device,{coarseResolution=32,size=2,wall=null,budget=32,tolerance=1e-3}={}){
  if(!Number.isInteger(budget)||budget<1)throw Error('positive integer budget required');
  let built=null,destroyed=false,paused=false,lastStep=null,generation=0;
  const key=p=>JSON.stringify([p.dims,p.pitch,p.allocation,p.solidMask?.revision??'disabled',p.reactant?.effective?.admitted===true,p.reactant?.allocation??0]);
  const clear=()=>{if(built)for(const r of built.owned)r.destroy?.();built=null;lastStep=null;};
  function prepare(p){
    if(destroyed)throw Error('joined exterior destroyed');
    const k=key(p);if(built?.key===k)return {rebuilt:false,...built.summary};
    clear();generation++;
    const reactant=p.reactant?.effective?.admitted===true;
    const g=resolveJoinedExteriorGeometry({fineDims:p.dims,pitch:p.pitch,coarseResolution,size,reactant});
    if(!g.admitted){built={key:k,owned:[],summary:g};return g;}
    const owned=[];
    try{
      if(p.fluidBuffers?.length!==2||!p.lowerFaceTexture||!p.burnRateTexture)throw Error('producer-resources-missing');
      const slab=resolveJoinedExteriorWall(wall,g);if(slab?.outside)throw Error('wall-outside-exterior');
      const fineSolids={shape:p.dims,cells:p.solidMask?.cells??new Uint8Array(p.dims.reduce((a,b)=>a*b,1)),revision:String(p.solidMask?.revision??'disabled')};
      const coarseSolids=joinedExteriorSolids(g.shape,slab);
      const layout=createCompositeProducerLayout({geometry:g.geometry,fineSolids,coarseSolids}),storage=createCompositeStorageLayout(layout.grid);
      const outer=createOuterSmoke(device,g.config,p.dims[0],p.fluidBuffers,{reactantTextures:p.reactant?.textures,reactantEffective:p.reactant?.effective});owned.push(outer);
      const row=Math.ceil(g.shape[0]/256)*256,packed=new Uint8Array(row*g.shape[1]*g.shape[2]);
      for(let z=0;z<g.shape[2];z++)for(let y=0;y<g.shape[1];y++){
        const i=g.shape[0]*(y+g.shape[1]*z);packed.set(coarseSolids.cells.subarray(i,i+g.shape[0]),row*(y+g.shape[1]*z));
      }
      outer.setSolids({data:packed,bytesPerRow:row,rowsPerImage:g.shape[1]},coarseSolids.revision);
      const solver=createCompositePCGGPU(device,layout.grid,{tolerance});owned.push(solver);
      const intake=createCompositeProducerGPU(device,layout);owned.push(intake);
      const lower=device.createBuffer({label:'joined lower faces',size:storage.lowerLength*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(lower);
      const lowerExport=createCompositeLowerFaceGPU(device,{dims:p.dims,lowerBuffer:lower,lowerFaceTexture:p.lowerFaceTexture});
      const summary={admitted:true,route:JOINED_EXTERIOR_ROUTE,shape:g.shape,origin:g.origin,ratio:g.ratio,cellWidth:g.cellWidth,
        bounds:{min:g.config.min,max:g.config.max},cells:layout.grid.cells.length,faces:layout.grid.faces.length,budget,tolerance,
        solids:{fine:fineSolids.revision,coarse:coarseSolids.revision,wall:slab},materialMode:g.config.materialMode,lighting:'boundary-incident-continuation',reaction:'fine-only',forces:'exterior-linear-heat-lift-not-fine-force-parity'};
      built={key:k,owned,g,layout,storage,outer,solver,intake,lower,lowerExport,bridges:[],steps:0,summary};
      return {rebuilt:true,...summary};
    }catch(e){for(const r of owned)r.destroy?.();built={key:k,owned:[],summary:{admitted:false,reason:e.message}};return {rebuilt:true,...built.summary};}
  }
  function seedGhosts(p){
    if(!built?.outer||!p.ghosts?.textures)return false;
    const e=device.createCommandEncoder({label:'joined initial ghosts'});
    built.outer.encodeGhostSnapshot(e,p.ghosts.textures);device.queue.submit([e.finish()]);return true;
  }
  function step(e,p){
    if(destroyed)throw Error('joined exterior destroyed');
    if(!built?.outer||built.key!==key(p))return lastStep={stepped:false,reason:'exterior-not-prepared-for-current-producer'};
    if(!p.ghosts?.textures)return lastStep={stepped:false,reason:'ghost-textures-missing'};
    built.outer.setReactantEffective(p.reactant?.effective);
    built.outer.encodeExternalProjection(e,p.fluidReadIndex,p.timeStep,(encoder,coarse)=>{
      let entry=built.bridges.find(b=>b.fine===p.fluidBuffer&&b.coarse===coarse);
      if(!entry){const bridge=createCompositeStorageGPU(device,built.storage,{fine:p.fluidBuffer,coarse,lower:built.lower,flux:built.solver.fluxBuffer});built.owned.push(bridge);entry={fine:p.fluidBuffer,coarse,bridge};built.bridges.push(entry);}
      entry.bridge.encodeGather(encoder,{interfaceSource:'fine'});
      built.intake.encode(encoder,{targetTexture:p.burnRateTexture,solidRevisions:built.layout.solidRevisions});
      built.solver.encodeGPU(encoder,{targetBuffer:built.intake.targetBuffer,iterations:budget,reset:built.steps===0});
      entry.bridge.encodeScatter(encoder);built.lowerExport.encode(encoder);
    });
    built.outer.encodeGhostSnapshot(e,p.ghosts.textures);
    built.steps++;return lastStep={stepped:true,reason:null,steps:built.steps,budget};
  }
  async function probe(){
    if(!built?.solver||!built.steps)return {status:'no-step-yet'};
    const b=built;paused=true;
    try{await device.queue.onSubmittedWorkDone();const r=await b.solver.readback();if(b!==built)return {status:'generation-changed'};
      return {status:'sampled',converged:r.converged,iterations:r.receipt.iterations,budget,maxDivergenceError:r.receipt.maxDivergenceError,steps:b.steps};
    }finally{paused=false;}
  }
  return {prepare,seedGhosts,step,probe,matches:p=>Boolean(built?.outer&&built.key===key(p)),
    get paused(){return paused;},get ghosts(){return built?.g?.ghosts??null;},get optical(){return built?.outer?.optical??null;},
    receipt(){return {route:JOINED_EXTERIOR_ROUTE,coarseResolution,size,budget,tolerance,generation,...built?.summary,steps:built?.steps??0,lastStep,outer:built?.outer?.receipt()??null};},
    async stats(){if(!built?.outer)return {status:'unprepared'};const b=built;paused=true;try{await device.queue.onSubmittedWorkDone();const values=await b.outer.readState();return {status:b===built?'sampled':'generation-changed',steps:b.steps,values:Array.from(values),receipt:b.outer.receipt()};}finally{paused=false;}},
    destroy(){if(!destroyed){clear();destroyed=true;}}
  };
}
