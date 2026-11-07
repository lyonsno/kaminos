// Runs in the real browser device. Uses the production solver, not a CPU stand-in.
export async function couplingProbe(device){
 const {createVolumeGPU}=await import('/experiments/hill-terrain/volume-gpu.mjs');
 const {volumeConfig,rockMoments,PARTICLE_WORDS}=await import('/experiments/hill-terrain/volume-model.mjs');
 const {buildConvexRock}=await import('/experiments/hill-terrain/rock-geometry.mjs');
 const solid=buildConvexRock([[1,0,0,.15],[-1,0,0,.15],[0,1,0,.15],[0,-1,0,.15],[0,0,1,.15],[0,0,-1,.15]]),m=rockMoments(solid);
 const result=[];
 for(const vx of [1,-1]){
  const particles=new Float32Array(PARTICLE_WORDS);particles.set([-.18,.72,.04,1,vx,0,0,1/1600]);
  const model={source:'controlled-rigid-contact',config:volumeConfig({dimensions:[16,16,16],origin:[-.96,-.24,-.96],gravity:0}),particles,weatheredMass:0,bodies:[{id:'controlled-rock',bed:0,solid,mass:m.mass,volume:m.volume,inertia:m.inertia,position:[0,.72,0],rotation:[0,0,0,1],velocity:[0,0,0],omega:[0,0,0],anchored:false}]};
  const solver=await createVolumeGPU({device,model});
  try{await solver.advance(1);const state=await solver.snapshot();const p=state.particles,b=state.bodies;const px=p[3]*p[4]+m.mass*b[8];result.push({vx,particleVelocity:Array.from(p.slice(4,7)),rockVelocity:Array.from(b.slice(8,11)),rockOmega:Array.from(b.slice(12,15)),momentum:px,error:Math.abs(px-vx)});}
  finally{solver.dispose();}
 }
 return result;
}

export async function stackProbe(device){
 const {createVolumeGPU}=await import('/experiments/hill-terrain/volume-gpu.mjs');
 const {volumeConfig,rockMoments,PARTICLE_WORDS}=await import('/experiments/hill-terrain/volume-model.mjs');
 const {buildConvexRock}=await import('/experiments/hill-terrain/rock-geometry.mjs');
 const solid=buildConvexRock([[1,0,0,.15],[-1,0,0,.15],[0,1,0,.15],[0,-1,0,.15],[0,0,1,.15],[0,0,-1,.15]]),m=rockMoments(solid),particles=new Float32Array(PARTICLE_WORDS);particles.set([.6,.1,.6,.01,0,0,0,.01/1600]);
 const body=(y,anchored)=>({id:anchored?'support':'released',bed:0,solid,mass:m.mass,volume:m.volume,inertia:m.inertia,position:[0,y,0],rotation:[0,0,0,1],velocity:[0,0,0],omega:[0,0,0],anchored});
 const model={source:'aligned convex support',config:volumeConfig({dimensions:[16,16,16],origin:[-.96,-.24,-.96]}),particles,weatheredMass:0,bodies:[body(.15,true),body(.45,false)]};
 const solver=await createVolumeGPU({device,model});
 try{await solver.advance(100);const s=await solver.snapshot();return{bodyY:s.bodies[41],velocityY:s.bodies[49],rotation:Array.from(s.bodies.slice(44,48)),steps:s.identity.completedSteps};}finally{solver.dispose();}
}

// Independent geometric oracle: intersect source halfspaces and integrate the
// resulting closed volume, rather than reusing the runtime SAT decision.
export async function releasedOverlap(snapshot,index=7){
 const {makeVolumeSpecimen,rotate,rockMoments}=await import('/experiments/hill-terrain/volume-model.mjs');const {buildConvexRock}=await import('/experiments/hill-terrain/rock-geometry.mjs');
 const model=makeVolumeSpecimen(snapshot.identity.config),v=snapshot.bodies;
 const all=model.bodies.map((b,i)=>b.solid.planes.map(p=>{const n=rotate(Array.from(v.slice(i*40+4,i*40+8)),p.slice(0,3));return [...n,p[3]+n.reduce((s,x,k)=>s+x*v[i*40+k],0)];}));let volume=0;const overlaps=[];
 for(let i=0;i<all.length;i++){if(i===index)continue;const unique=[];for(const p of [...all[index],...all[i]]){const q=unique.find(q=>Math.hypot(...p.slice(0,3).map((x,k)=>x-q[k]))<1e-6);if(q)q[3]=Math.min(q[3],p[3]);else unique.push([...p]);}
  try{const result=rockMoments(buildConvexRock(unique),1).volume;volume+=result;if(result>1e-8)overlaps.push({body:i,volume:result});}catch(e){if(!e.message.includes('empty or unbounded'))throw e;}
 }return{volume,overlaps,bodyVolume:model.bodies[index].volume};
}
