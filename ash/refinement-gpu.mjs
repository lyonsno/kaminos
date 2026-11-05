import {adaptiveView} from './adaptive-plan.mjs';
import {createAdaptiveCollision} from './adaptive-collision.mjs';
import {sameAshCollisionPoses} from './collision-checkpoint.mjs';
import * as THREE from '../lib/three.webgpu.js';
import {releaseAshAttributes} from './gpu-disposal.mjs';
import {createGpuAshFall} from './fall-gpu.mjs';
import {createAshSceneSolids} from './scene-gpu.mjs';
import {createRefinementLayout, refinementCell} from './refinement-plan.mjs';
import {refinementArena, refinementShader} from './refinement-shader.mjs';
import {refinementVertexWGSL, refinementNormalWGSL, refinementOpacityWGSL} from './refinement-surface.mjs';
import {seedRefinedLayer} from './refinement-seed.mjs';
import {checkedSliding} from './sliding.mjs';

export async function createGpuRefinedAsh({renderer,cellSize,bounds,tileSize=16,refinement,sceneRecords=null,sliding:initialSliding={}}) {
  if(!renderer?.backend?.isWebGPUBackend)throw Error('Refined ash requires shared WebGPU renderer');
  const device=renderer.backend.device;
  const p=createRefinementLayout({cellSize,bounds,tileSize,refinement});
  const arena=refinementArena(p);
  const owned=[],attributes=[],colliders=[];
  let mesh,wire,fall,fineCollision,disposed=false,steps=0,seededVolume=0,readbacks=0,lastContact=null,restoredCollision=null;
  let sliding=checkedSliding(initialSliding);
  function buffer(label,size,extra=0) {
    if(size>device.limits.maxBufferSize||size>device.limits.maxStorageBufferBindingSize)throw Error(`Refined ash ${label} exceeds effective GPU capacity`);
    const result=device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST|extra});
    owned.push(result);return result;
  }
  function attribute(array,indirect=false) {
    const a=indirect?new THREE.IndirectStorageBufferAttribute(array,1):new THREE.StorageBufferAttribute(array,1);
    attributes.push(a);
    if(indirect)renderer.backend.createIndirectStorageAttribute(a);else renderer.backend.createStorageAttribute(a);
    return {attribute:a,buffer:renderer.backend.get(a).buffer};
  }
  function cleanup() {
    if(disposed)return;disposed=true;
    for(const collider of colliders)collider.dispose();
    fineCollision?.dispose();fall?.dispose();wire?.geometry.dispose();wire?.material.dispose();mesh?.removeFromParent();mesh?.geometry.dispose();mesh?.material.dispose();
    releaseAshAttributes(renderer,attributes);for(const b of owned)b.destroy();
  }
  try {
    for(const size of [p.count*4,p.faceWords*4,arena.words.byteLength]) {
      if(size>device.limits.maxStorageBufferBindingSize||size>device.limits.maxBufferSize)throw Error('Refined ash exceeds effective GPU buffer capacity');
    }
    const mass=attribute(new Float32Array(p.count));
    const solid=attribute(new Uint32Array(p.count));
    const faces=attribute(new Uint32Array(p.faceWords));
    const work=attribute(arena.words);
    const draw=attribute(new Uint32Array([6,0,0,0,0]),true);
    const next=buffer('refined ash next mass',p.count*4);
    const limits=buffer('refined ash capacity limits',p.count*8);
    const headers=buffer('refined ash region tile state',p.tiles.count*32);
    const uniform=buffer('refined ash parameters',64,GPUBufferUsage.UNIFORM);
    const activeArgs=buffer('refined ash active dispatch',16,GPUBufferUsage.INDIRECT);
    const surfaceArgs=buffer('refined ash surface dispatch',16,GPUBufferUsage.INDIRECT);
    const unusedWake=buffer('refined ash compatibility wake',16);
    const module=device.createShaderModule({label:'conservative coarse fine ash',code:refinementShader(p,arena,device.limits.maxComputeWorkgroupsPerDimension)});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('; '));
    const layout=device.createBindGroupLayout({entries:Array.from({length:8},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===7?'uniform':binding===2?'read-only-storage':'storage'}}))});
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
    const names=[...(p.adaptive?['adaptive_reset','adaptive_release','adaptive_allocate_detail','adaptive_allocate_halo','adaptive_prolong','adaptive_collision_list','adaptive_collision_args','adaptive_recount']:[]),'reset','admit','clear_wake','pack_dispatch','limit_flux','gather_flux','commit_mass','admit_surface','build_surface','finish_surface','draw_prefix','wake_all'];
    const pipelines=Object.fromEntries(await Promise.all(names.map(async name=>[name,await device.createComputePipelineAsync({label:'refined ash '+name,layout:pipelineLayout,compute:{module,entryPoint:name}})])));
    const group=device.createBindGroup({layout,entries:[mass.buffer,next,solid.buffer,limits,headers,work.buffer,faces.buffer,uniform].map((b,binding)=>({binding,resource:{buffer:b}}))});
    function dispatch(encoder,name,count=1,indirect=null) {
      const pass=encoder.beginComputePass({label:'refined ash '+name});
      pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);
      if(indirect)pass.dispatchWorkgroupsIndirect(indirect,0);else pass.dispatchWorkgroups(count);
      pass.end();
    }
    function parameters(contact=null,previous=contact,moved=false,geometryChanged=false) {
      const bytes=new ArrayBuffer(64),floats=new Float32Array(bytes),ints=new Uint32Array(bytes);
      floats.set(contact??[0,0,0,0]);floats.set(previous??contact??[0,0,0,0],4);
      floats.set([sliding.variation,sliding.scale,sliding.release,0],8);ints[12]=moved?1:0;ints[13]=geometryChanged?1:0;
      device.queue.writeBuffer(uniform,0,bytes);
    }
    function surfaces(encoder) {
      dispatch(encoder,'admit_surface',Math.ceil(p.tiles.count/64));dispatch(encoder,'pack_dispatch');
      encoder.copyBufferToBuffer(work.buffer,(arena.stats+12)*4,surfaceArgs,0,12);
      dispatch(encoder,'build_surface',0,surfaceArgs);dispatch(encoder,'finish_surface',Math.ceil(p.tiles.count/64));dispatch(encoder,'draw_prefix');
      encoder.copyBufferToBuffer(work.buffer,(arena.stats+4)*4,draw.buffer,4,4);
    }
    function rebuild(geometryChanged=false) {
      parameters(null,null,false,geometryChanged);const encoder=device.createCommandEncoder();adapt(encoder);dispatch(encoder,'reset');surfaces(encoder);device.queue.submit([encoder.finish()]);
    }
    if(sceneRecords) {
      for(const region of p.regions)colliders.push(createAshSceneSolids({device,layout:region.layout,collision:solid.buffer,headers,collisionOffset:region.offset*4,headersOffset:region.tileOffset*32,samplingCellSize:p.adaptive?p.cellSize:region.layout.cellSize,adaptive:p.adaptive?{layout:p,arena:work.buffer}:null}));
    }
    function syncCollision(checkpointIdentity=restoredCollision) {
      const records=sceneRecords?.()??[];let changed=false;
      for(const [region,collider]of colliders.entries()){const prefix=`${region}/`;const local=Array.isArray(checkpointIdentity)?checkpointIdentity.filter(row=>row.key?.startsWith(prefix)).map(row=>({...row,key:row.key.slice(prefix.length)})):null;if(collider.update(records,{checkpointIdentity:local}))changed=true;}
      return changed;
    }
    if(p.adaptive&&colliders.length)fineCollision=createAdaptiveCollision({device,p,arena:work.buffer,collision:solid.buffer,headers,shapes:colliders[0]});
    function adapt(encoder){
      if(!p.adaptive)return;
      dispatch(encoder,'adaptive_reset');dispatch(encoder,'adaptive_release',Math.ceil(p.pool.capacity/64));
      dispatch(encoder,'adaptive_allocate_detail',Math.ceil(p.pool.pages/64));dispatch(encoder,'adaptive_allocate_halo',Math.ceil(p.pool.pages/64));
      dispatch(encoder,'adaptive_prolong',Math.ceil(p.pool.capacity/64));dispatch(encoder,'adaptive_collision_list',Math.ceil(p.pool.capacity/64));dispatch(encoder,'adaptive_collision_args');
      fineCollision?.encode(encoder);
    }
    const fallLayout={...p,tiles:{...p.tiles,dims:p.dims.map(n=>Math.ceil(n/tileSize))}};
    fall=await createGpuAshFall({renderer,layout:fallLayout,density:mass.buffer,collision:solid.buffer,wake:unusedWake,tileHeaders:headers,adaptiveMap:p.adaptive?{buffer:work.buffer,offset:p.adaptiveArena.map*4,size:(p.adaptiveArena.slots+p.pool.capacity-p.adaptiveArena.map)*4}:null});
    const {storage,instanceIndex,positionGeometry,vec3,transformNormalToView}=THREE.TSL;
    const readMass=storage(mass.attribute,'float',p.count).toReadOnly();
    const readSolid=storage(solid.attribute,'uint',p.count).toReadOnly();
    const readFaces=storage(faces.attribute,'uint',p.faceWords).toReadOnly();
    const readArena=storage(work.attribute,'uint',arena.words.length).toReadOnly();
    const softNormals=THREE.TSL.uniform(1);
    const vertex=THREE.TSL.wgslFn(refinementVertexWGSL(p,arena));
    const normal=THREE.TSL.wgslFn(refinementNormalWGSL);
    const cover=THREE.TSL.wgslFn('fn ash_refined_cover(packed:f32)->f32{return f32(u32(round(packed))&255u)/255.0;}');
    const opacity=THREE.TSL.wgslFn(refinementOpacityWGSL);
    const vertexState=vertex({rank:instanceIndex,uv:positionGeometry.xy.add(.5),soft:softNormals,density:readMass,solid:readSolid,faces:readFaces,arena:readArena}).toVar('ash_refined_vertex_state');
    const material=new THREE.MeshStandardNodeMaterial({color:0xb9b3a8,roughness:1,alphaTest:.5});
    material.positionNode=vertexState.xyz;
    material.normalNode=transformNormalToView(normal({packed:vertexState.w}).toVarying('ash_refined_normal'));
    material.opacityNode=opacity({cover:cover({packed:vertexState.w}).toVarying('ash_refined_cover'),point:vertexState.xyz.toVarying('ash_refined_world'),origin:vec3(...p.origin),size:THREE.TSL.float(cellSize)});
    const geometry=new THREE.PlaneGeometry(1,1);geometry.setIndirect(draw.attribute);
    mesh=new THREE.Mesh(geometry,material);mesh.name='Coarse and fine retained ash';mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;mesh.add(fall.root);
    if(p.adaptive){
      const geometry=new THREE.BoxGeometry(1,1,1),drawFine=attribute(new Uint32Array([72,p.pool.capacity,0,0,0]),true);geometry.setIndirect(drawFine.attribute);
      const position=THREE.TSL.wgslFn(`fn adaptive_ash_brick(slot:u32,point:vec3<f32>,map:ptr<storage,array<u32>,read>)->vec3<f32>{
        let page=(*map)[${p.adaptiveArena.slots}u+slot];if(page==0u){return vec3<f32>(-100000.0);}
        let n=page-1u;let c=vec3<u32>(n%${p.pool.pageDims[0]}u,(n/${p.pool.pageDims[0]}u)%${p.pool.pageDims[1]}u,n/${p.pool.pageDims[0]*p.pool.pageDims[1]}u);
        return vec3<f32>(${p.origin.join(',')})+(vec3<f32>(c)*8.0+(point+.5)*8.0)*${p.cellSize};
      }`);
      const material=new THREE.MeshBasicNodeMaterial({color:0xd7b866,wireframe:true,transparent:true,opacity:.65,depthWrite:false});
      material.positionNode=position({slot:instanceIndex,point:positionGeometry,map:readArena});
      wire=new THREE.Mesh(geometry,material);wire.name='Automatic fine ash bricks';wire.userData.kaminosEditorHelper=true;wire.frustumCulled=false;wire.visible=false;mesh.add(wire);
    }

    function check() {if(disposed)throw Error('Refined ash disposed');}
    function collisionIdentity() {return colliders.flatMap((c,region)=>c.read().members.map(({key,geometry,matrix})=>({key:`${region}/${key}`,geometry,matrix}))).sort((a,b)=>a.key.localeCompare(b.key));}
    function upload(values,pending=null) {
      device.queue.writeBuffer(mass.buffer,0,values);
      const flags=new Uint32Array(p.tiles.count*8);
      for(let tile=0;tile<p.tiles.count;tile++){flags[tile*8]=pending?Number(pending.has(tile)):1;flags[tile*8+2]=1;}
      device.queue.writeBuffer(headers,0,flags);rebuild();
    }
    async function capture() {
      check();if(syncCollision())rebuild(true);readbacks++;
      const countBytes=p.count*4,headerBytes=p.tiles.count*32;
      const topologyBytes=p.adaptive?(p.adaptiveArena.slots+p.pool.capacity-p.adaptiveArena.map)*4:0;
      const read=device.createBuffer({size:countBytes*2+headerBytes+64+topologyBytes+(p.adaptive?64:0),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try {
        const encoder=device.createCommandEncoder();
        encoder.copyBufferToBuffer(mass.buffer,0,read,0,countBytes);
        encoder.copyBufferToBuffer(solid.buffer,0,read,countBytes,countBytes);
        encoder.copyBufferToBuffer(headers,0,read,countBytes*2,headerBytes);
        encoder.copyBufferToBuffer(work.buffer,arena.stats*4,read,countBytes*2+headerBytes,64);
        if(topologyBytes){encoder.copyBufferToBuffer(work.buffer,p.adaptiveArena.map*4,read,countBytes*2+headerBytes+64,topologyBytes);encoder.copyBufferToBuffer(work.buffer,p.adaptiveArena.state*4,read,countBytes*2+headerBytes+64+topologyBytes,64);}
        device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
        const data=read.getMappedRange();
        const topology=topologyBytes?new Uint32Array(data.slice(countBytes*2+headerBytes+64,countBytes*2+headerBytes+64+topologyBytes)):null;
        const residency=topology?{map:Array.from(topology.slice(0,p.pool.pages)),slots:Array.from(topology.slice(p.pool.pages))}:null;
        const allocation=p.adaptive?Array.from(new Uint32Array(data.slice(countBytes*2+headerBytes+64+topologyBytes))):null;
        return {residency,allocation,view:residency?adaptiveView(p,residency):p,values:new Float32Array(data.slice(0,countBytes)),solid:new Uint32Array(data.slice(countBytes,countBytes*2)),headers:new Uint32Array(data.slice(countBytes*2,countBytes*2+headerBytes)),stats:new Uint32Array(data.slice(countBytes*2+headerBytes,countBytes*2+headerBytes+64))};
      }finally{read.unmap();read.destroy();}
    }
    function retained(values,air) {
      const pending=new Float32Array(new Uint32Array(air.state).buffer)[0];
      let total=values.reduce((sum,value)=>sum+value,0)+pending;
      for(let i=3;i<air.particles.length;i+=8)total+=air.particles[i];
      return total*cellSize**3+air.queuedVolume;
    }
    return {root:mesh,layout:p,
      step(contact=null,source=null) {
        check();const geometryChanged=syncCollision();
        if(contact&&(!Array.isArray(contact)||contact.length!==4||contact.some(v=>!Number.isFinite(v))||contact[3]<=0))throw Error('Invalid contact');
        parameters(contact,lastContact,JSON.stringify(contact)!==JSON.stringify(lastContact),geometryChanged);lastContact=contact?.slice()??null;
        const encoder=device.createCommandEncoder();adapt(encoder);
        if(source)fall.encode(encoder,{...source,contact});
        dispatch(encoder,'reset');dispatch(encoder,'admit',Math.ceil(p.tiles.count/64));dispatch(encoder,'clear_wake',Math.ceil(p.tiles.count/64));dispatch(encoder,'pack_dispatch');
        encoder.copyBufferToBuffer(work.buffer,(arena.stats+8)*4,activeArgs,0,12);
        dispatch(encoder,'limit_flux',0,activeArgs);dispatch(encoder,'gather_flux',0,activeArgs);dispatch(encoder,'commit_mass',0,activeArgs);
        surfaces(encoder);device.queue.submit([encoder.finish()]);steps++;
      },
      syncScene(){check();if(syncCollision())rebuild(true);},
      setSliding(value) {
        check();const next=checkedSliding(value);if(JSON.stringify(next)===JSON.stringify(sliding))return;sliding=next;parameters();const encoder=device.createCommandEncoder();dispatch(encoder,'wake_all',Math.ceil(p.tiles.count/64));device.queue.submit([encoder.finish()]);
      },
      setSoftNormals(value){check();softNormals.value=value?1:0;},
      setShowRefinement(value){if(wire)wire.visible=!!value;},
      burst(volume){check();fall.request(volume);},
      async deposit(input) {
        const state=await capture(),values=input.blanketDepth===undefined?state.values.slice():seedRefinedLayer(state.view,state.solid,input,state.values);
        const cells=[];
        for(let i=0;i<p.count;i++) {
          const c=refinementCell(state.view,i);if(!c.owned||state.solid[i])continue;
          if(input.blanketDepth!==undefined)continue;
          {
            if(!Number.isFinite(input.volume)||input.volume<=0||!Number.isFinite(input.radius)||input.radius<=0||!input.center?.every(Number.isFinite))throw Error('Invalid deposit');
            const x=p.origin[0]+(c.coord[0]+c.size*.5)*cellSize,z=p.origin[2]+(c.coord[2]+c.size*.5)*cellSize;
            if(Math.hypot(x-input.center[0],z-input.center[2])<=input.radius)cells.push({i,c});
          }
        }
        if(input.blanketDepth===undefined) {
          let remaining=input.volume/cellSize**3;
          const capacity=cells.reduce((sum,{i,c})=>sum+c.size**3-values[i],0);
          if(remaining>capacity+1e-7)throw Error('Deposit exceeds refined ash capacity');
          cells.sort((a,b)=>a.c.coord[1]-b.c.coord[1]||a.i-b.i);
          for(const {i,c}of cells){const amount=Math.min(remaining,c.size**3-values[i]);values[i]+=amount;remaining-=amount;if(remaining<=0)break;}
        }
        seededVolume+=values.reduce((sum,value,i)=>sum+value-state.values[i],0)*cellSize**3;upload(values);
      },
      async diagnostics({fields=false}={}) {
        const state=await capture();
        return {...(fields?{values:Array.from(state.values),solid:Array.from(state.solid)}:{}),stats:{activeTiles:state.stats[0],rebuiltTiles:state.stats[1],changedPairs:state.stats[2],exchangeCellVisits:state.stats[3],visibleFaces:state.stats[4],surfaceOverflow:state.stats[5]},tiles:p.tileRecords.map((r,id)=>({id,pending:state.headers[id*8],awake:state.headers[id*8+1],dirty:state.headers[id*8+2],faces:state.headers[id*8+3]})),residency:state.residency,allocation:state.allocation?{capacity:p.pool.capacity,resident:state.residency.slots.filter(Boolean).length,requested:state.allocation[1],allocated:state.allocation[2],released:state.allocation[3],unmet:state.allocation[4],pinned:state.residency.slots.reduce((n,page,slot)=>n+Number(!!page&&state.values.subarray(p.pool.offset+slot*p.pool.cells,p.pool.offset+(slot+1)*p.pool.cells).some(v=>v>0)),0),collisionBricks:state.allocation[6],maintenanceRan:!!state.allocation[7]}:null,transport:await fall.schedulingSnapshot()};
      },
      async snapshot() {
        const state=await capture(),air=await fall.snapshot();
        if(state.stats[5])throw Error('Refined ash surface capacity contract failed');
        return {schema:p.adaptive?'kaminos.adaptive-ash.v1':'kaminos.refined-ash.v1',residency:state.residency,layout:p,collisionIdentity:collisionIdentity(),values:Array.from(state.values),pendingTiles:p.tileRecords.flatMap((_,i)=>state.headers[i*8]?[i]:[]),steps,sliding:{...sliding},lastContact,seededVolume,volume:seededVolume+fall.read().requestedVolume,retainedVolume:retained(state.values,air),falling:air};
      },
      restore(state,{allowCollisionUpgrade=false}={}) {
        check();syncCollision(state?.collisionIdentity);
        const view=p.adaptive?adaptiveView(p,state?.residency):p;
        if(state?.schema!==(p.adaptive?'kaminos.adaptive-ash.v1':'kaminos.refined-ash.v1')||JSON.stringify(state.layout)!==JSON.stringify(p)||!Array.isArray(state.values)||state.values.length!==p.count||state.values.some((value,i)=>!Number.isFinite(value)||value<0||value>refinementCell(view,i).size**3+1e-6||(!refinementCell(view,i).owned&&value!==0)))throw Error('Invalid refined ash checkpoint');
        const exactCollision=JSON.stringify(state.collisionIdentity)===JSON.stringify(collisionIdentity());
        if(!exactCollision&&!(allowCollisionUpgrade&&sameAshCollisionPoses(state.collisionIdentity,collisionIdentity())))throw Object.assign(Error('Checkpoint scene geometry or poses differ; restore the scene first'),{code:'ASH_CHECKPOINT_COLLISION_MISMATCH'});
        fall.validate(state.falling);const values=Float32Array.from(state.values);
        const actual=retained(values,state.falling),introduced=state.seededVolume+state.falling.requestedVolume;
        if(!Number.isFinite(state.volume)||state.volume<0||!Number.isFinite(state.seededVolume)||state.seededVolume<0||!Number.isFinite(state.retainedVolume)||Math.abs(state.retainedVolume-actual)>Math.max(1e-9,actual*1e-4)||!Number.isFinite(introduced)||Math.abs(actual-introduced)>Math.max(1e-9,introduced*1e-4)||Math.abs(state.volume-introduced)>1e-8)throw Error('Checkpoint volume differs from retained material');
        if(!(state.lastContact===null||Array.isArray(state.lastContact)&&state.lastContact.length===4&&state.lastContact.every(Number.isFinite)&&state.lastContact[3]>0))throw Error('Invalid refined ash contact');
        if(!Array.isArray(state.pendingTiles)||state.pendingTiles.some(i=>!Number.isSafeInteger(i)||i<0||i>=p.tiles.count)||!Number.isSafeInteger(state.steps)||state.steps<0)throw Error('Invalid refined ash continuation');
        if(p.adaptive){const a=p.adaptiveArena;device.queue.writeBuffer(work.buffer,a.state*4,new Uint32Array(16));device.queue.writeBuffer(work.buffer,a.map*4,Uint32Array.from(view.residency.map));device.queue.writeBuffer(work.buffer,a.slots*4,Uint32Array.from(view.residency.slots));device.queue.writeBuffer(work.buffer,a.flags*4,Uint32Array.from(view.residency.slots,n=>n?2:0));}
        restoredCollision=state.collisionIdentity;sliding=checkedSliding(state.sliding);parameters();upload(values,exactCollision?new Set(state.pendingTiles):null);fall.restore(state.falling);steps=state.steps;seededVolume=state.seededVolume;lastContact=state.lastContact?.slice()??null;
        if(p.adaptive){const e=device.createCommandEncoder();dispatch(e,'adaptive_recount',Math.ceil(p.pool.pages/64));device.queue.submit([e.finish()]);}
      },
      read:()=>({backend:p.adaptive?'webgpu-adaptive-ash':'webgpu-coarse-fine-ash',surface:'joined-cached-refined-faces',surfaceMode:'refined',layout:p,steps,volume:seededVolume+fall.read().requestedVolume,falling:fall.read(),sliding:{...sliding},sceneCollision:{route:'regional-cached-collision',members:colliders.flatMap(c=>c.read().members),allocatedBytes:colliders.reduce((sum,c)=>sum+c.read().allocatedBytes,0)},runtimeReadbacks:0,explicitReadbacks:readbacks,allocatedBytes:owned.reduce((sum,b)=>sum+b.size,0)+attributes.reduce((sum,a)=>sum+a.array.byteLength,0)+(fineCollision?.read().allocatedBytes??0)+fall.read().allocatedBytes+colliders.reduce((sum,c)=>sum+c.read().allocatedBytes,0),allocationMeaning:p.adaptive?'resident coarse covering and reusable fine pool; occupied fine history pinned':'resident coarse volume and explicit fine regions, including cached surface capacity',boundary:'single material owner and conservative coarse-fine exchange',lastContact}),
      dispose:cleanup,
    };
  }catch(error){cleanup();throw error;}
}
