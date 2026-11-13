export async function shoveProbe(device){
 const {createVolumeGPU}=await import(new URL('/experiments/hill-terrain/volume-gpu.mjs',location.href).href);
 const {volumeConfig,rockMoments,PARTICLE_WORDS}=await import(new URL('/experiments/hill-terrain/volume-model.mjs',location.href).href);
 const {buildConvexRock}=await import(new URL('/experiments/hill-terrain/rock-geometry.mjs',location.href).href);
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


// A grab made against one pose, then a free body translates/rotates before
// release. A body-local arm must agree with a specimen arm from the release pose.
export async function movingShoveProbe(device){
 const {createVolumeGPU}=await import('/experiments/hill-terrain/volume-gpu.mjs');
 const {volumeConfig,rockMoments,PARTICLE_WORDS}=await import('/experiments/hill-terrain/volume-model.mjs');
 const {buildConvexRock}=await import('/experiments/hill-terrain/rock-geometry.mjs');
 const {Vector3,Quaternion}=await import('/lib/three.core.js');
 const solid=buildConvexRock([[1,0,0,.15],[-1,0,0,.15],[0,1,0,.15],[0,-1,0,.15],[0,0,1,.15],[0,0,-1,.15]]),m=rockMoments(solid);
 const trial=async mode=>{
  const particles=new Float32Array(PARTICLE_WORDS);particles.set([.6,.2,.6,.01,0,0,0,.01/1600]);
  const body={id:'moving-probe',bed:0,solid,mass:m.mass,volume:m.volume,inertia:m.inertia,position:[0,1.2,0],rotation:[0,0,0,1],velocity:[1,0,0],omega:[0,5,0],anchored:false};
  const solver=await createVolumeGPU({device,model:{source:'moving-point-impulse-probe',config:volumeConfig({dimensions:[12,16,12],origin:[-.72,-.24,-.72],gravity:0}),particles,weatheredMass:0,bodies:[body]}});
  try{
   const hit=await solver.pickRay([0,1.2,2],[0,0,-1]);if(!hit?.released)throw Error('Moving probe did not hit the source body');
   await solver.advance(10);const before=Array.from((await solver.snapshot()).bodies);
   const local=new Vector3(...(hit.localPoint??[0,0,.15])),current=local.clone().applyQuaternion(new Quaternion(...before.slice(4,8))).add(new Vector3(...before.slice(0,3))).toArray();
   solver.pushRock(0,[0,1,0],mode==='local'?local.toArray():mode==='current'?current:hit.point,{bodyLocal:mode==='local'});
   await solver.advance(1);const after=Array.from((await solver.snapshot()).bodies);
   return{hit,before,current,velocity:after.slice(8,11),omega:after.slice(12,15)};
  }finally{await solver.done();solver.dispose();}
 };
 return{local:await trial('local'),current:await trial('current'),stale:await trial('stale')};
}
