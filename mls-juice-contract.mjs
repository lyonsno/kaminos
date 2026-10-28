export const MLS_ROUTE='kaminos/mls-mpm-finger-juice-v1';
export const MLS_SOURCE='matsuoka-601/Splash@3df5d621e6f153d7269037cbd8606bd83796f3fd';
export function mlsConfig(setup={}) {
  const capacity=setup.particleCount??12000,grid=setup.gridSize??64,cell=setup.cellSize??.05;
  if(!Number.isSafeInteger(capacity)||capacity<1)throw Error('Invalid MLS particle capacity');
  if(!Number.isSafeInteger(grid)||grid<8)throw Error('Invalid MLS grid size');
  if(!Number.isFinite(cell)||cell<=0)throw Error('Invalid MLS cell size');
  return {capacity,grid,cell,min:[-grid*cell/2,-2*cell,-grid*cell/2],dt:1/240,
    modelSecondsPerSecond:Math.sqrt(9.81/(.4*cell)),restDensity:3,stiffness:50,viscosity:.1,
    particleRadius:cell*.65,obstacle:{center:[-.35,.24,0],radius:.24}};
}

// Backlog is retained, not clamped away to make presentation FPS look healthy.
export function createMlsClock(dt) {
  let previous=null,accumulator=0,steps=0,elapsed=0;
  return {advance(now,paused=false){
    if(!Number.isFinite(now))throw Error('Invalid MLS clock');
    if(previous!==null&&now<previous)throw Error('MLS clock moved backwards');
    const delta=previous===null?0:(now-previous)/1000;previous=now;
    if(!paused){accumulator+=delta;elapsed+=delta;}
    const count=paused?0:Math.floor((accumulator+1e-10)/dt);
    accumulator-=count*dt;steps+=count;return count;
  },read:()=>({policy:'wall-time-fixed-substeps-no-discard',elapsedSeconds:elapsed,
    simulatedSeconds:steps*dt,backlogSeconds:Math.max(0,accumulator),stepCount:steps,dt})};
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
      const inDomain=origin.every(v=>v>=2&&v<=config.grid-3);
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
        if(position.some(p=>p<1||p>config.grid-2)){expiry[slot]=0;outside++;continue;}
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
