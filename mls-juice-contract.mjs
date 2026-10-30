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
  const min=[-dimensions[0]*cell/2,-2*cell,-dimensions[2]*cell/2];
  const goinPile=setup.goinPile==null?null:{count:24,mass:.25,radius:.22,thickness:.1,particleMass:.001,couplingSteps:1,collisionSides:32,...setup.goinPile};
  if(goinPile&&(!Number.isSafeInteger(goinPile.count)||goinPile.count<1||['mass','radius','thickness','particleMass'].some(k=>!Number.isFinite(goinPile[k])||goinPile[k]<=0)))throw Error('Invalid goin pile');
  if(goinPile&&(!Number.isSafeInteger(goinPile.couplingSteps)||goinPile.couplingSteps<1))throw Error('Invalid goin coupling interval');
  if(goinPile&&(!Number.isSafeInteger(goinPile.collisionSides)||goinPile.collisionSides<6))throw Error('Invalid goin collision geometry');
  return {capacity,grid,dimensions,gridCells,cell,min,
    goinPile,
    bounds:{min:min.map(v=>v+2*cell),max:min.map((v,i)=>v+(dimensions[i]-3)*cell)},dt:1/240,
    modelSecondsPerSecond:Math.sqrt(9.81/(.4*cell)),restDensity:3,stiffness:50,viscosity,
    particleRadius:cell*.65,obstacle:{center:[-.35,.24,0],radius:.24}};
}

// Backlog is retained, not clamped away to make presentation FPS look healthy.
export function createMlsClock(dt) {
  let previous=null,accumulator=0,steps=0,elapsed=0;
  function observe(now,paused=false){
    if(!Number.isFinite(now))throw Error('Invalid MLS clock');
    if(previous!==null&&now<previous)throw Error('MLS clock moved backwards');
    const delta=previous===null?0:(now-previous)/1000;previous=now;
    if(!paused){accumulator+=delta;elapsed+=delta;}
  }
  return {observe,advance(now,paused=false,transactionSteps=Infinity){
    observe(now,paused);
    const count=paused?0:Math.min(transactionSteps,Math.floor((accumulator+1e-10)/dt));
    accumulator-=count*dt;steps+=count;return count;
  },read:()=>({policy:'wall-time-fixed-substeps-no-discard',elapsedSeconds:elapsed,
    simulatedSeconds:steps*dt,timeSeconds:steps*dt,step:steps,backlogSeconds:Math.max(0,accumulator),stepCount:steps,dt})};
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
  let cursor=0,serial=0,totalAdmitted=0,totalRejected=0,last=[];
  return {step(packet,time,epochMs){
    const valid=packet.authority.simulation_safe&&epochMs>=packet.timestamp_ms&&epochMs-packet.timestamp_ms<=750;
    const births=[];last=[];
    for(const e of packet.emitters){
      const rate=valid&&e.active?e.source_flux_particles_per_second:0;
      const credit=rate*config.dt+(fractions.get(e.id)??0),requested=Math.floor(credit+1e-10);
      fractions.set(e.id,credit-requested);
      let admitted=0,outside=0;
      const direction=e.aim_world.map(v=>v/Math.hypot(...e.aim_world));
      const origin=e.origin_world.map((v,i)=>(v-config.min[i])/config.cell);
      const inDomain=origin.every((v,i)=>v>=2&&v<=config.dimensions[i]-3);
      for(let j=0;j<requested;j++){
        if(!inDomain){outside++;continue;}
        let slot=-1;
        for(let n=0;n<config.capacity;n++){
          const index=(cursor+n)%config.capacity;
          if(expiry[index]<=time+1e-10){slot=index;cursor=(index+1)%config.capacity;break;}
        }
        if(slot<0)continue;
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
      last.push({id:e.id,requested,admitted,outside,effective:{releaseSaturated:admitted<requested},rate});
    }
    return births;
  },read(time){return {poolCapacity:config.capacity,activePlanned:expiry.reduce((n,t)=>n+(t>time+1e-10),0),
    expectedParticleReleaseRate:last.reduce((n,e)=>n+(e.requested?e.rate*e.admitted/e.requested:e.rate),0),
    totalAdmitted,totalRejected,inlets:structuredClone(last),authority:'cpu_admission_plan_not_gpu_particle_count'};}};
}
