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
