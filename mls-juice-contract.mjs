export const MLS_ROUTE='kaminos/mls-mpm-finger-juice-v1';
export const MLS_SOURCE='matsuoka-601/Splash@3df5d621e6f153d7269037cbd8606bd83796f3fd';
function gridDimensions(size){
  const dimensions=Array.isArray(size)?[...size]:[size,size,size];
  if(dimensions.length!==3||dimensions.some(v=>!Number.isSafeInteger(v)||v<8)||!Number.isSafeInteger(dimensions.reduce((n,v)=>n*v,1)))throw Error('Invalid MLS grid size');
  return dimensions;
}
export function analyzeMlsParticles(words,{capacity,grid=64,cell=.05,modelSecondsPerSecond=Math.sqrt(9.81/(.4*cell)),minActive=1}){
  if(!Number.isSafeInteger(capacity)||capacity<1||words?.length!==capacity*20)throw Error('Incomplete native MLS particle layout');
  if(!Number.isSafeInteger(minActive)||minActive<0||minActive>capacity)throw Error('Invalid native population target');
  const dimensions=gridDimensions(grid),speeds=[];
  for(let i=0;i<words.length;i++)if(!Number.isFinite(words[i]))throw Error('Nonfinite native MLS particle state');
  for(let i=0;i<words.length;i+=20)if(words[i+3]>0){
    if([words[i],words[i+1],words[i+2]].some((v,axis)=>v<1.999||v>dimensions[axis]-2.999))throw Error('Native MLS particle escaped supported domain');
    speeds.push(Math.hypot(words[i+4],words[i+5],words[i+6])*cell*modelSecondsPerSecond);
  }
  if(speeds.length<minActive)throw Error(`Underpopulated native MLS state: ${speeds.length} < ${minActive}`);
  speeds.sort((a,b)=>a-b);
  const percentile=q=>speeds.length?speeds[Math.min(speeds.length-1,Math.floor(q*speeds.length))]:null;
  return {capacity,active:speeds.length,nonfinite:0,outside:0,minActive,
    worldSpeed:{p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:speeds.at(-1)??null},authority:'complete_native_gpu_snapshot'};
}
export function mlsConfig(setup={}) {
  const capacity=setup.particleCount??12000,grid=setup.gridSize??64,cell=setup.cellSize??.05,viscosity=setup.viscosity??.1;
  if(!Number.isSafeInteger(capacity)||capacity<1)throw Error('Invalid MLS particle capacity');
  const dimensions=gridDimensions(grid),gridCells=dimensions.reduce((n,v)=>n*v,1);
  if(!Number.isFinite(cell)||cell<=0)throw Error('Invalid MLS cell size');
  if(!Number.isFinite(viscosity)||viscosity<0)throw Error('Invalid MLS viscosity');
  const dt=setup.timeStepSeconds??1/240,stiffness=setup.stiffness??50;
  if(!Number.isFinite(dt)||dt<=0)throw Error('Invalid MLS physical timestep');
  if(!Number.isFinite(stiffness)||stiffness<0)throw Error('Invalid MLS stiffness');
  const maxSubstepsPerBatch=setup.maxSubstepsPerBatch??24;
  if(maxSubstepsPerBatch!==Infinity&&(!Number.isSafeInteger(maxSubstepsPerBatch)||maxSubstepsPerBatch<1))throw Error('Invalid MLS max substeps per batch');
  const maxBacklogSeconds=setup.maxBacklogSeconds??(Number.isFinite(maxSubstepsPerBatch)?Math.max(24,maxSubstepsPerBatch*2)*dt:Infinity);
  if(maxBacklogSeconds!==Infinity&&(!Number.isFinite(maxBacklogSeconds)||maxBacklogSeconds<dt))throw Error('Invalid MLS max backlog seconds');
  const min=setup.originWorld??[-dimensions[0]*cell/2,-2*cell,-dimensions[2]*cell/2];
  if(!Array.isArray(min)||min.length!==3||!min.every(Number.isFinite))throw Error('Invalid MLS domain origin');
  const obstacle=setup.obstacle===null?null:(setup.obstacle??{center:[-.35,.24,0],radius:.24});
  return {capacity,grid,dimensions,gridCells,cell,min,
    bounds:{min:min.map(v=>v+2*cell),max:min.map((v,i)=>v+(dimensions[i]-3)*cell)},dt,
    maxSubstepsPerBatch,maxBacklogSeconds,
    modelSecondsPerSecond:Math.sqrt(9.81/(.4*cell)),restDensity:3,stiffness,viscosity,
    particleRadius:cell*.65,obstacle,boundaryWalls:setup.boundaryWalls!==false};
}

// Backlog is retained across brief frame-time jitter; when configured with
// finite batch/backlog bounds, severe stalls shed excess backlog explicitly.
export function createMlsClock(dt,{maxSubstepsPerBatch=Infinity,maxBacklogSeconds=Infinity}={}) {
  if(maxSubstepsPerBatch!==Infinity&&(!Number.isSafeInteger(maxSubstepsPerBatch)||maxSubstepsPerBatch<1))throw Error('Invalid MLS max substeps per batch');
  if(maxBacklogSeconds!==Infinity&&(!Number.isFinite(maxBacklogSeconds)||maxBacklogSeconds<dt))throw Error('Invalid MLS max backlog seconds');
  let previous=null,accumulator=0,steps=0,elapsed=0,droppedSeconds=0,droppedSteps=0;
  function observe(now,paused=false){
    if(!Number.isFinite(now))throw Error('Invalid MLS clock');
    if(previous!==null&&now<previous)throw Error('MLS clock moved backwards');
    const delta=previous===null?0:(now-previous)/1000;previous=now;
    if(!paused){
      accumulator+=delta;elapsed+=delta;
      if(accumulator>maxBacklogSeconds+1e-10){
        const availableSteps=Math.floor((accumulator+1e-10)/dt);
        const retainedSteps=Math.floor((maxBacklogSeconds+1e-10)/dt);
        const shedSteps=Math.max(0,availableSteps-retainedSteps);
        const shedSeconds=accumulator-maxBacklogSeconds;
        accumulator=maxBacklogSeconds;
        droppedSteps+=shedSteps;droppedSeconds+=shedSeconds;
      }
    }
  }
  return {observe,advanceSteps(count){
    if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid MLS step count');
    steps+=count;elapsed+=count*dt;return count;
  },advance(now,paused=false,maxSteps=maxSubstepsPerBatch){
    if(maxSteps!==Infinity&&(!Number.isSafeInteger(maxSteps)||maxSteps<1))throw Error('Invalid MLS step cap');
    observe(now,paused);
    const cap=Math.min(maxSteps,maxSubstepsPerBatch);
    const available=paused?0:Math.floor((accumulator+1e-10)/dt);
    const count=Math.min(cap,available);
    accumulator=Math.max(0,accumulator-count*dt);steps+=count;return count;
  },read:()=>({policy:Number.isFinite(maxBacklogSeconds)?'wall-time-fixed-substeps-bounded-backlog':'wall-time-fixed-substeps-no-discard',elapsedSeconds:elapsed,
    simulatedSeconds:steps*dt,timeSeconds:steps*dt,step:steps,backlogSeconds:Math.max(0,accumulator),
    droppedSeconds,droppedSteps,maxSubstepsPerBatch,maxBacklogSeconds,stepCount:steps,dt})};
}

export function createSimFrameCoordinator({
  targetFrameMs=1000/60,
  waterBaseMaxSubsteps=12,
  waterSteadyContendedMaxSubsteps=8,
  waterContendedMaxSubsteps=6,
}={}){
  if(!Number.isFinite(targetFrameMs)||targetFrameMs<=0)throw Error('Invalid simulator frame budget target');
  if(!Number.isSafeInteger(waterBaseMaxSubsteps)||waterBaseMaxSubsteps<1)throw Error('Invalid water base substep cap');
  if(!Number.isSafeInteger(waterContendedMaxSubsteps)||waterContendedMaxSubsteps<1||waterContendedMaxSubsteps>waterBaseMaxSubsteps)throw Error('Invalid water contended substep cap');
  if(!Number.isSafeInteger(waterSteadyContendedMaxSubsteps)||waterSteadyContendedMaxSubsteps<waterContendedMaxSubsteps||waterSteadyContendedMaxSubsteps>waterBaseMaxSubsteps)throw Error('Invalid water steady contended substep cap');
  let lastNowMs=null,lastFrameDurationMs=0,secondaryTurn=0;
  let frames=0,contendedFrames=0,waterFramesAdmitted=0,waterFramesDeferred=0,ashFramesAdmitted=0,ashFramesDeferred=0;
  let lastPlan=null;
  function planFrame({nowMs,flame={},water={},ash={}}={}){
    if(!Number.isFinite(nowMs))throw Error('Invalid simulator coordinator timestamp');
    lastFrameDurationMs=lastNowMs===null?0:Math.max(0,nowMs-lastNowMs);
    lastNowMs=nowMs;
    frames++;
    const flameActive=Boolean(flame?.active);
    const waterActive=Boolean(water?.active);
    const waterReady=waterActive&&!water?.pending;
    const accruedSeconds=lastFrameDurationMs>0?lastFrameDurationMs/1000:0;
    const effectiveBacklogSeconds=water?.backlogSeconds===undefined?Infinity:water.backlogSeconds+accruedSeconds;
    const waterNeedsStep=waterReady&&effectiveBacklogSeconds+1e-10>=(water?.dt??1/240);
    const ashActive=Boolean(ash?.active);
    const ashReady=ashActive&&ash?.due!==false;
    const activeCount=(flameActive?1:0)+(waterActive?1:0)+(ashActive?1:0);
    const contended=activeCount>=2&&lastFrameDurationMs>targetFrameMs*1.15;
    if(contended)contendedFrames++;
    let waterAdvance=waterReady;
    let ashAdvance=ashReady;
    let waterMaxSteps=waterBaseMaxSubsteps;
    if(contended){
      if(waterNeedsStep&&ashReady){
        // Alternate secondary simulator priority across consecutive contended frames:
        // when Ash steps, tighten Water to waterContendedMaxSubsteps (6) so both do not
        // stack full catch-up batches; on the alternate contended frame, defer Ash and
        // allow Water up to waterBaseMaxSubsteps (12) so 30 FPS (8 substeps/frame) drains
        // with zero dropped steps ((6 + 12) / 2 = 9 >= 8 substeps/frame capacity).
        if(secondaryTurn%2===0){
          ashAdvance=true;
          waterMaxSteps=waterContendedMaxSubsteps;
        }else{
          ashAdvance=false;
          waterMaxSteps=waterBaseMaxSubsteps;
        }
        secondaryTurn++;
      }else{
        waterMaxSteps=lastFrameDurationMs>1000/25?waterContendedMaxSubsteps:waterSteadyContendedMaxSubsteps;
      }
    }
    // An authored work budget is an explicit operator choice. Keep the
    // cooperative legacy budget when no such choice was made.
    if(water.requestedMaxSteps!=null){
      if(!Number.isSafeInteger(water.requestedMaxSteps)||water.requestedMaxSteps<1)throw Error('Invalid requested water step budget');
      waterMaxSteps=water.requestedMaxSteps;
    }
    if(waterActive){if(waterAdvance)waterFramesAdmitted++;else if(waterNeedsStep)waterFramesDeferred++;}
    if(ashActive){if(ashAdvance)ashFramesAdmitted++;else if(ashReady)ashFramesDeferred++;}
    lastPlan={
      nowMs,
      frameDurationMs:lastFrameDurationMs,
      targetFrameMs,
      contended,
      activeCount,
      flame:{active:flameActive,advance:flameActive},
      water:{active:waterActive,advance:waterAdvance,maxSteps:waterMaxSteps},
      ash:{active:ashActive,advance:ashAdvance},
    };
    return lastPlan;
  }
  return {
    planFrame,
    read:()=>({
      targetFrameMs,
      waterBaseMaxSubsteps,
      waterSteadyContendedMaxSubsteps,
      waterContendedMaxSubsteps,
      frames,
      contendedFrames,
      lastFrameDurationMs,
      waterFramesAdmitted,
      waterFramesDeferred,
      ashFramesAdmitted,
      ashFramesDeferred,
      lastPlan:lastPlan?structuredClone(lastPlan):null,
    }),
  };
}

export function validateMlsPacket(packet) {
  if(!packet||!Array.isArray(packet.emitters)||typeof packet.authority?.simulation_safe!=='boolean')throw Error('Invalid MLS inlet authority');
  if(packet.authority.simulation_safe&&!Number.isFinite(packet.timestamp_ms))throw Error('Missing live inlet timestamp');
  const ids=new Set();
  for(const e of packet.emitters){
    if(typeof e.id!=='string'||ids.has(e.id))throw Error('Invalid or duplicate MLS emitter');ids.add(e.id);
    if(!Array.isArray(e.origin_world)||e.origin_world.length!==3||!e.origin_world.every(Number.isFinite)||
      !Array.isArray(e.aim_world)||e.aim_world.length!==3||!e.aim_world.every(Number.isFinite)||Math.hypot(...e.aim_world)<1e-8||
      !Number.isFinite(e.source_flux_particles_per_second)||e.source_flux_particles_per_second<0||
      !Number.isFinite(e.radius)||e.radius<=0||!Number.isFinite(e.strength)||e.strength<0||
      !Number.isFinite(e.lifetime_seconds)||e.lifetime_seconds<=0)throw Error('Invalid MLS emitter geometry or economics');
  }
  return structuredClone(packet);
}

export function createMlsEmissionPlan(config) {
  const expiry=new Float64Array(config.capacity),fractions=new Map();
  let cursor=0,serial=0,totalAdmitted=0,totalRejected=0,last=[],slotSearches=0;
  return {reserveInitial(count){
    if(!Number.isSafeInteger(count)||count<0||count>config.capacity)throw Error('Initial MLS population exceeds capacity');
    for(let i=0;i<count;i++)expiry[i]=Infinity;
    cursor=count%config.capacity;
  },reconcileOccupancy(words){
    if(!(words instanceof Uint32Array)||words.length!==Math.ceil(config.capacity/32))throw Error('Incomplete MLS occupancy readback');
    for(let i=0;i<config.capacity;i++)if(!(words[i>>>5]&(1<<(i&31))))expiry[i]=0;
  },step(packet,time,epochMs){
    const valid=packet.authority.simulation_safe&&epochMs>=packet.timestamp_ms&&epochMs-packet.timestamp_ms<=750;
    const births=[];last=[];slotSearches=0;
    // Expiry cannot change while this step is planning births. Once a full
    // scan finds no slot, later births/sources cannot make one available.
    let poolFull=false;
    for(const e of packet.emitters){
      const rate=valid&&e.active?e.source_flux_particles_per_second:0;
      const credit=rate*config.dt+(fractions.get(e.id)??0),requested=Math.floor(credit+1e-10);
      fractions.set(e.id,credit-requested);
      let admitted=0,outside=0,capacityBlocked=0;
      const direction=e.aim_world.map(v=>v/Math.hypot(...e.aim_world));
      const origin=e.origin_world.map((v,i)=>(v-config.min[i])/config.cell);
      const inDomain=origin.every((v,i)=>v>=2&&v<=config.dimensions[i]-3);
      for(let j=0;j<requested;j++){
        if(!inDomain){outside+=requested-j;break;}
        if(poolFull){capacityBlocked+=requested-j;break;}
        let slot=-1;
        for(let n=0;n<config.capacity;n++){
          const index=(cursor+n)%config.capacity;
          slotSearches++;
          if(expiry[index]<=time+1e-10){slot=index;cursor=(index+1)%config.capacity;break;}
        }
        if(slot<0){poolFull=true;capacityBlocked+=requested-j;break;}
        expiry[slot]=time+e.lifetime_seconds;
        const axis=Math.abs(direction[1])<.9?[0,1,0]:[1,0,0];
        const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
        let u=cross(direction,axis);u=u.map(v=>v/Math.hypot(...u));const v=cross(direction,u);
        const phi=++serial*2.399963229728653,r=e.radius*Math.sqrt((serial*.618033988749895)%1)/config.cell;
        const position=origin.map((p,i)=>p+r*(u[i]*Math.cos(phi)+v[i]*Math.sin(phi)));
        if(position.some((p,i)=>p<1||p>config.dimensions[i]-2)){expiry[slot]=0;outside++;continue;}
        births.push({slot,position,velocity:direction.map(d=>d*e.strength/config.cell/config.modelSecondsPerSecond),life:e.lifetime_seconds});admitted++;
      }
      totalAdmitted+=admitted;totalRejected+=requested-admitted;
      const blockedReason=!valid?'stale_input':!e.active||rate===0?'stopped':!inDomain?'outside_domain':capacityBlocked?'capacity':outside?'aperture_outside_domain':null;
      last.push({id:e.id,requested,admitted,outside,capacityBlocked,blockedReason,originWorld:[...e.origin_world],effective:{releaseSaturated:admitted<requested},rate});
    }
    return births;
  },read(time){const activePlanned=expiry.reduce((n,t)=>n+(t>time+1e-10),0);return {poolCapacity:config.capacity,activePlanned,
    expectedParticleReleaseRate:last.reduce((n,e)=>n+(e.requested?e.rate*e.admitted/e.requested:e.rate),0),
    totalAdmitted,totalRejected,slotSearches,inlets:structuredClone(last).map(e=>({...e,blockedReason:e.blockedReason??(e.rate>0&&activePlanned===config.capacity?'capacity':null)})),authority:'cpu_admission_plan_not_gpu_particle_count'};}};
}
