import * as THREE from 'three';
import { ArchGpuEngine, ENGINE_REVISION } from './dist/structural-material-arch-gpu-engine.js';
import { buildGpuArchFixture } from './structural-material-arch-gpu-fixture.js';
import { ARCH_GPU_KERNELS } from './structural-material-arch-gpu-kernels.js';

export const ARCH_GPU_ROUTE='kaminos.structural-material.arch-gravity-collapse.webgpu-avbd.v0';
const xyz=values=>({x:values[0],y:values[1],z:values[2]});
const v=value=>new THREE.Vector3(value.x,value.y,value.z);
const q=value=>new THREE.Quaternion(value.x,value.y,value.z,value.w);
const finitePoint=point=>['x','y','z'].every(axis=>Number.isFinite(point?.[axis]));
const faceNormals=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(value=>new THREE.Vector3(...value));

export function coarsenGpuArchProfile(source, columns=14, rows=10) {
  return {...source,columns,rows,occupancy:Array.from({length:columns*rows},(_,index)=>{
    const x=Math.min(source.columns-1,Math.floor((index%columns+.5)*source.columns/columns));
    const y=Math.min(source.rows-1,Math.floor((Math.floor(index/columns)+.5)*source.rows/rows));
    return source.occupancy[y*source.columns+x];
  }),constructionSource:{kind:'source-raster-center-resampling-v0',columns:source.columns,rows:source.rows}};
}

export async function createGpuArchCollapse(profile, renderer, options={}) {
  return createGpuStructuralFixture(buildGpuArchFixture(profile,options),renderer);
}

export async function createGpuStructuralFixture(fixture, renderer) {
  if(!renderer.backend.isWebGPUBackend)throw new Error('GPU collapse requires a native WebGPU renderer');
  const {cells,bonds,config,dimensions,floorY}=fixture;
  const {dx,dy,dz}=dimensions,device=renderer.backend.device,n=cells.length+1;
  if(cells.length===0)throw new Error('GPU arch requires occupied cells');
  let engine,disposed=false;
  const ownedBuffers=[];
  const acquire=descriptor=>{const buffer=device.createBuffer(descriptor);ownedBuffers.push(buffer);return buffer;};
  function dispose(){if(disposed)return;disposed=true;const errors=[];
    for(const buffer of ownedBuffers)try{buffer.destroy();}catch(error){errors.push(error);}
    try{engine?.dispose(renderer);}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'GPU arch resource cleanup failed');
  }
  try {
  engine=new ArchGpuEngine(device,{maxBodies:n,gravity:[0,-config.gravity,0],deltaTime:config.timeStep,
    substeps:config.substeps,solverIterations:config.solverIterations,maxFixedStepsPerFrame:1,
    enableBvhBuild:false,maxPairsPerBodyBroadphase:n-1,maxContactsPerBodySolver:(n-1)*4,
    pairManifoldSlots:4,avbdFriction:config.friction,avbdPenaltyDecayGamma:1});
  engine.setAvbdPreventPenetratingNormalDropout(config.preventPenetratingNormalDropout);
  for(const cell of cells)engine.addBody({position:cell.position,halfExtents:cell.halfExtents,mass:cell.mass,friction:config.friction});
  engine.addBody({position:[0,floorY-.2,0],halfExtents:[100,.2,100],mass:0,friction:config.friction});
  for(const bond of bonds)engine.addFixedJoint(bond.a,bond.b,bond.anchorA,bond.anchorB,config.stiffness,false);
  for(const cell of cells){const j=engine.addSphericalJoint(null,cell.index,cell.position,[0,0,0],config.gripStiffness,false);engine.setInitialJointActive(j,false);}
  const counts=cells.map(()=>0);for(const bond of bonds){counts[bond.a]++;counts[bond.b]++;}
  if(counts.some(count=>count+1>8))throw new Error('Fixture exceeds observed engine joint-per-body capacity');
  for(let j=0;j<bonds.length;j++){const data=engine.jointRecordsData;for(let axis=0;axis<3;axis++){data[j*44+36+axis]=config.initialJointPenalty;data[j*44+40+axis]=config.initialJointPenalty;}}
  const gravityScale=step=>config.gravityRampSeconds===0?1:Math.min(1,step*config.timeStep/config.gravityRampSeconds);
  engine.setGravity([0,-config.gravity*gravityScale(1),0]);
  engine.step(config.timeStep,renderer);
  const attrs=engine.getResidentAttributes();
  const resident=name=>{const buffer=renderer.backend.get(attrs[name]).buffer;if(!buffer)throw new Error(`Resident ${name} buffer missing`);return buffer;};
  const allocate=(label,data,usage)=>{const buffer=acquire({label,size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,data);return buffer;};
  const geometry=new Float32Array(Math.max(1,bonds.length)*12);
  bonds.forEach((bond,i)=>{geometry.set([bond.area,...bond.normal],i*12);geometry.set([...bond.anchorA,0],i*12+4);geometry.set([...bond.anchorB,0],i*12+8);});
  const buffers={geometry:allocate('Arch contact geometry',geometry,GPUBufferUsage.STORAGE),damage:allocate('Arch persistent damage',new Float32Array(Math.max(1,bonds.length)*12),GPUBufferUsage.STORAGE),
    grip:allocate('Arch hand commands',new Float32Array(cells.length*12),GPUBufferUsage.STORAGE),parameters:allocate('Arch parameters',new Float32Array(16),GPUBufferUsage.UNIFORM),
    output:acquire({label:'Arch pose and damage mirror',size:(cells.length*5+bonds.length*4)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),
    readback:acquire({label:'Arch operator pose readback',size:(cells.length*5+bonds.length*4)*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})};
  const shader=device.createShaderModule({label:'Arch resident interaction and fracture',code:ARCH_GPU_KERNELS});
  const compilation=await shader.getCompilationInfo();if(compilation.messages.some(message=>message.type==='error'))throw new Error(compilation.messages.map(message=>message.message).join('\n'));
  const layout=device.createBindGroupLayout({entries:Array.from({length:10},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===8?'uniform':[0,1,2,3,5,7].includes(binding)?'read-only-storage':'storage'}}))});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const pipelines={};for(const entryPoint of ['commands','fracture','pack'])pipelines[entryPoint]=await device.createComputePipelineAsync({label:`Arch ${entryPoint}`,layout:pipelineLayout,compute:{module:shader,entryPoint}});
  const resources=[resident('positions'),resident('quaternions'),resident('velocities'),resident('angularVelocities'),resident('joints'),buffers.geometry,buffers.damage,buffers.grip,buffers.parameters,buffers.output];
  const group=device.createBindGroup({layout,entries:resources.map((buffer,binding)=>({binding,resource:{buffer}}))});
  let stepIndex=1,epoch=0,hand=null,gripGeneration=0,bindRequest=null;
  const events=[],samples=[];
  const state={bodies:cells.map(cell=>({...cell,position:xyz(cell.position),rest:xyz(cell.position),quaternion:{x:0,y:0,z:0,w:1},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}})),
    bonds:bonds.map(bond=>({...bond,alive:true,reaction:0,bendingReaction:0,stress:0,lastBreakStep:null}))};
  const gripData=new Float32Array(cells.length*12);
  function parameters(){const buffer=new ArrayBuffer(64),f=new Float32Array(buffer),u=new Uint32Array(buffer);
    f.set([hand?.target.x??0,hand?.target.y??0,hand?.target.z??0,Math.min(dx,dy,dz)*.15]);u.set([cells.length,bonds.length,stepIndex,0],4);f[7]=config.initialJointPenalty;
    f.set([config.strength,config.timeStep,config.gripStiffness,bindRequest?.radius??Math.max(dx,dy)*2],8);
    u.set([bindRequest?1:0,bindRequest?.index??0,hand?1:0,0],12);device.queue.writeBuffer(buffers.parameters,0,buffer);}
  function dispatch(name){const encoder=device.createCommandEncoder({label:`Arch ${name}`}),pass=encoder.beginComputePass();pass.setPipeline(pipelines[name]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(Math.max(cells.length,bonds.length)/64));pass.end();device.queue.submit([encoder.finish()]);}
  async function read(){dispatch('pack');const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffers.output,0,buffers.readback,0,buffers.output.size);device.queue.submit([encoder.finish()]);await buffers.readback.mapAsync(GPUMapMode.READ);
    const data=new Float32Array(buffers.readback.getMappedRange()).slice();buffers.readback.unmap();
    if(!data.every(Number.isFinite))throw new Error('Non-finite GPU physical state');
    state.bodies.forEach((body,i)=>{const start=i*20;body.position=xyz(data.slice(start,start+3));body.quaternion={...xyz(data.slice(start+4,start+7)),w:data[start+7]};body.velocity=xyz(data.slice(start+8,start+11));body.angularVelocity=xyz(data.slice(start+12,start+15));});
    const changed=[];
    state.bonds.forEach((bond,i)=>{const start=cells.length*20+i*16;bond.reaction=data[start];bond.bendingReaction=data[start+1];bond.stress=data[start+2];bond.lastBreakStep=data[start+3]||null;bond.alive=data[start+12]===1;bond.linearPenaltyMaximum=data[start+13];bond.angularPenaltyMaximum=data[start+14];bond.penaltyMinimum=data[start+15];
      for(const offset of [8,4]){const eventStep=data[start+offset+1],kind=data[start+offset+2];if(kind&&eventStep===stepIndex)changed.push({kind:kind===1?'crack':'bind',id:bond.id,step:eventStep,time:eventStep*config.timeStep,reaction:bond.reaction,bendingReaction:bond.bendingReaction,stress:bond.stress,area:bond.area,energyProxy:data[start+offset],handActive:data[start+offset+3]===1});}});
    if(changed.length)epoch++;for(const event of changed)events.push({...event,epoch});
    if(hand){hand.force={x:0,y:0,z:0};for(const member of hand.members){const start=member.index*20+16;for(let axis=0;axis<3;axis++)hand.force[['x','y','z'][axis]]+=data[start+axis];}}
  }
  function components(){const adjacency=cells.map(()=>[]);for(const bond of state.bonds)if(bond.alive){adjacency[bond.a].push(bond.b);adjacency[bond.b].push(bond.a);}const labels=cells.map(()=>-1),result=[];
    for(const cell of cells){if(labels[cell.index]>=0)continue;const queue=[cell.index],label=result.length;labels[cell.index]=label;let pinned=false,mass=0;for(let i=0;i<queue.length;i++){const current=queue[i];pinned||=cells[current].pinned;mass+=cells[current].mass;for(const next of adjacency[current])if(labels[next]<0){labels[next]=label;queue.push(next);}}result.push({id:label,count:queue.length,pinned,mass});}return{labels,components:result};}
  function isExposedFace(index,normal){if(!cells[index]||!faceNormals.some(face=>face.distanceTo(v(normal))<1e-8))return false;return!state.bonds.some(bond=>bond.alive&&(bond.a===index&&new THREE.Vector3(...bond.normal).dot(v(normal))>.99||bond.b===index&&new THREE.Vector3(...bond.normal).dot(v(normal))<-.99));}
  const worldPoint=(index,point)=>v(point).applyQuaternion(q(state.bodies[index].quaternion)).add(v(state.bodies[index].position));
  function release(){hand=null;gripData.fill(0);device.queue.writeBuffer(buffers.grip,0,gripData);}
  function setSurfaceHand(index,target,localPoint,normal,contactSurface='box-face'){if(![target,localPoint,normal].every(finitePoint))throw new Error('Hand coordinates must contain finite x, y and z');
    if(!['box-face','embedded-visual'].includes(contactSurface))throw new Error('Unknown contact surface');
    const cell=cells[index];if(!cell||cell.pinned||!isExposedFace(index,normal))throw new Error('Surface hand requires unpinned exposed face');
    const h=xyz(cell.halfExtents),expected=Math.abs(normal.x)*h.x+Math.abs(normal.y)*h.y+Math.abs(normal.z)*h.z;
    if(['x','y','z'].some(axis=>Math.abs(localPoint[axis])>h[axis]+1e-6))throw new Error('Hand point must lie inside body envelope');
    if(contactSurface==='box-face'&&Math.abs(v(localPoint).dot(v(normal))-expected)>1e-6)throw new Error('Hand point must lie on selected face');
    release();gripGeneration++;const contact=worldPoint(index,localPoint),worldNormal=v(normal).applyQuaternion(q(state.bodies[index].quaternion)),members=[];
    for(const other of cells){if(other.pinned)continue;let point,offset;if(other.index===index){point=v(localPoint);offset=new THREE.Vector3();}else{const face=faceNormals.find(direction=>isExposedFace(other.index,xyz(direction.toArray()))&&direction.clone().applyQuaternion(q(state.bodies[other.index].quaternion)).dot(worldNormal)>.97);if(!face)continue;point=face.clone().multiply(new THREE.Vector3(...other.halfExtents));offset=worldPoint(other.index,xyz(point.toArray())).sub(contact);if(offset.length()>=config.gripRadius||Math.abs(offset.dot(worldNormal))>Math.min(dx,dy,dz)*.5)continue;}
      members.push({index:other.index,weight:other.index===index?1:1-offset.length()/config.gripRadius,point:xyz(point.toArray()),offset:xyz(offset.toArray())});}
    const total=members.reduce((sum,member)=>sum+member.weight,0);for(const member of members){member.weight/=total;const start=member.index*12;gripData.set([1,member.weight,gripGeneration,0,member.point.x,member.point.y,member.point.z,0,member.offset.x,member.offset.y,member.offset.z,0],start);}
    hand={index,target:{...target},localPoint:{...localPoint},normal:{...normal},contactSurface,members,layers:[...new Set(members.map(member=>cells[member.index].layer))],force:{x:0,y:0,z:0}};device.queue.writeBuffer(buffers.grip,0,gripData);
  }
  function moveHand(target){if(!hand||!finitePoint(target))throw new Error('Move requires active hand and finite x, y and z');hand.target={...target};}
  function bind(index,radius=Math.max(dx,dy)*2){if(!cells[index]||!Number.isFinite(radius)||radius<=0)throw new Error('Bind requires known cell and positive finite radius');bindRequest={index,radius};}
  async function step(){if(disposed)throw new Error('GPU arch is disposed');const started=performance.now();stepIndex++;parameters();dispatch('commands');bindRequest=null;engine.setGravity([0,-config.gravity*gravityScale(stepIndex),0]);engine.step(config.timeStep,renderer);dispatch('fracture');await read();if(engine.stats.pairDispatchTruncated)throw new Error('GPU collision dispatch truncated');samples.push({step:stepIndex,milliseconds:performance.now()-started,handActive:Boolean(hand),gravityScale:gravityScale(stepIndex),cracks:events.filter(event=>event.step===stepIndex&&event.kind==='crack').length,maximumStress:Math.max(...state.bonds.map(bond=>bond.stress))});}
  parameters();dispatch('fracture');await read();
  while(gravityScale(stepIndex)<1)await step();
  return {cells:cells.map(cell=>({...cell,half:xyz(cell.halfExtents)})),bonds:state.bonds,step,setSurfaceHand,moveHand,release,isExposedFace,bind,
    worldToLocalPoint:(index,point)=>{if(!cells[index]||!finitePoint(point))throw new Error('World point requires known cell and finite x, y and z');return v(point).sub(v(state.bodies[index].position)).applyQuaternion(q(state.bodies[index].quaternion).invert());},
    setStrength:value=>{if(!Number.isFinite(value)||value<=0)throw new Error('Cohesion must be positive and finite');config.strength=value;},
    snapshot:()=>{const graph=components();return{route:ARCH_GPU_ROUTE,backend:'webgpu-avbd',engineVersion:ENGINE_REVISION,config:{...config},step:stepIndex,time:stepIndex*config.timeStep,connectivityEpoch:epoch,floorY,dimensions,constructionLoad:{duration:config.gravityRampSeconds,gravityScale:gravityScale(stepIndex),complete:gravityScale(stepIndex)===1,effectiveGravity:engine.getGravity()},
      hand:hand?{index:hand.index,indices:hand.members.map(member=>member.index),weights:hand.members.map(member=>member.weight),radius:config.gripRadius,layers:hand.layers,normal:hand.normal,contactSurface:hand.contactSurface,localPoint:{...hand.localPoint},target:{...hand.target},force:{...hand.force}}:null,
      bodies:state.bodies.map(body=>({...body,component:graph.labels[body.index],stress:Math.max(0,...state.bonds.filter(bond=>bond.alive&&(bond.a===body.index||bond.b===body.index)).map(bond=>bond.stress))})),
      bonds:state.bonds.map(bond=>({...bond,normal:xyz(bond.normal),anchorA:xyz(bond.anchorA),anchorB:xyz(bond.anchorB)})),broken:state.bonds.filter(bond=>!bond.alive).length,components:graph.components,events:events.map(event=>({...event})),samples:samples.map(sample=>({...sample})),
      residency:{bodyPose:'gpu-authoritative',connectivity:'gpu-authoritative',collision:'gpu-avbd',consumer:'single-pose-readback-for-current-frame-render-and-pick',allPairsCapacity:engine.maxCandidatePairs,allPairsRequired:n*(n-1)/2,contactsPerBody:(n-1)*4,jointsPerBody:8,substeps:engine.getSubsteps(),preventPenetratingNormalDropout:engine.getAvbdPreventPenetratingNormalDropout(),stats:engine.getStats()}};},
    dispose};
  }catch(error){try{dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'GPU arch construction and cleanup failed');}throw error;}
}
