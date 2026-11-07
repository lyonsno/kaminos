export async function shoveProbe(device){
 const {createVolumeGPU}=await import('/experiments/hill-terrain/volume-gpu.mjs');
 const {volumeConfig,rockMoments,PARTICLE_WORDS}=await import('/experiments/hill-terrain/volume-model.mjs');
 const {buildConvexRock}=await import('/experiments/hill-terrain/rock-geometry.mjs');
 const solid=buildConvexRock([[1,0,0,.15],[-1,0,0,.15],[0,1,0,.15],[0,-1,0,.15],[0,0,1,.15],[0,0,-1,.15]]),m=rockMoments(solid),particles=new Float32Array(PARTICLE_WORDS);particles.set([.6,.2,.6,.01,0,0,0,.01/1600]);
 const body={id:'probe',bed:0,solid,mass:m.mass,volume:m.volume,inertia:m.inertia,position:[0,1.2,0],rotation:[0,0,0,1],velocity:[0,0,0],omega:[0,0,0],anchored:false};
 const solver=await createVolumeGPU({device,model:{source:'point-impulse-probe',config:volumeConfig({dimensions:[16,24,16],origin:[-.96,-.24,-.96],gravity:0}),particles,weatheredMass:0,bodies:[body]}});
 try{
  const beforePick=typeof solver.pickRay==='function'?await solver.pickRay([0,1.2,2],[0,0,-1]):null;
  solver.pushRock(0,[1,0,0],[0,1.35,0]);await solver.advance(1);const state=await solver.snapshot();
  const afterPick=typeof solver.pickRay==='function'?await solver.pickRay([state.bodies[0],state.bodies[1],2],[0,0,-1]):null;
  return{beforePick,afterPick,bodies:Array.from(state.bodies),particles:Array.from(state.particles),expectedOmegaZ:-.15*m.mass/m.inertia[8]};
 }finally{await solver.done();solver.dispose();}
}
