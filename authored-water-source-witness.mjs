// Runs inside the shared scene witness's isolated browser and failure reporter.
export async function runWaterSourceWitness({evaluate,ws,capture,out}) {
 const evidence=await evaluate(ws,`(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  while(!window.kaminosWaterSources||!window.kaminosWorkbenchExperiments||!document.querySelector('[data-mode]')){
   if(window.kaminosWorkbenchExperimentError)throw Error(window.kaminosWorkbenchExperimentError);await wait(100);
  }
  const api=window.kaminosWaterSources,sceneApi=window.kaminosSceneAuthoring;
  const bowl=sceneApi.addMesh('bowl',{radius:.4,thickness:.06});sceneApi.setMaterial(bowl,{color:'#bb4422'});
  window.kaminosSetSceneObjectTransform(bowl,{position:[0,.35,0],rotation:[0,0,0],scale:[1,1,1]});
  const id=await api.add({mode:'continuous'}),defaults=api.read().selected.settings;
  window.kaminosSetSceneObjectTransform(id,{position:[0,.6,0],rotation:[Math.PI/2,0,0],scale:[1,1,1]});
  api.edit(id,{rate:240,baseRadius:.035,strength:.5});
  api.editSimulation({particleCount:64,waterSampling:{...api.read().simulation.sampling,container:{min:[-.6,-.2,-.6],max:[.6,.9,.6]}}});
  const take=async()=>{await wait(50);return {state:window.kaminosLocalLiquidState(),particles:await api.requestParticleState()};};
  await api.release();window.kaminosPauseLocalLiquid(true);await api.advanceTo(12);const before=await take();
  window.kaminosSetSceneObjectTransform(id,{position:[.25,.6,0]});await api.advanceTo(24);const moved=await take();
  const newPositions=[];for(let i=before.state.solver.liveInlets.totalAdmitted;i<moved.state.solver.liveInlets.totalAdmitted;i++){
   const p=moved.particles;newPositions.push(p.originWorld.map((v,a)=>v+p.words[i*20+a]*p.cellSize));
  }
  if(newPositions.length!==12||newPositions.some(p=>Math.abs(p[0]-.25)>.06))throw Error('Live births did not follow the moved source');
  await api.advanceTo(96);const full=await take();
  window.kaminosSetSceneObjectTransform(id,{position:[-.25,.6,0]});await api.advanceTo(120);const fullMoved=await take();
  if(full.state.solver.liveInlets.totalAdmitted!==64||fullMoved.state.solver.liveInlets.totalAdmitted!==64)throw Error('Full pool silently added or replaced retained water');
  window.selectSceneObject(id);window.kaminosSetCameraDebugPose({position:[1.1,.9,1.2],target:[0,.3,0]});await wait(150);
  const status=document.querySelector('[data-source-status]');status.scrollIntoView({block:'center'});
  const ui=status.textContent;
  const inlet=fullMoved.state.solver.liveInlets.inlets.find(e=>e.id===id);
  if(inlet.blockedReason!=='capacity'||Math.abs(inlet.originWorld[0]+.25)>1e-8||!ui.includes('capacity is full'))throw Error('Full moved source is not explained: '+JSON.stringify({inlet,ui}));
  return {id,bowl,defaults,before,moved,newPositions,full,fullMoved,ui,source:await(await fetch('/api/runtime-config')).json()};
 })()`,{timeoutMs:60000});
 await capture(ws,out);
 return evidence;
}

export async function runWaterCadenceWitness({evaluate,ws,capture,out}) {
 const evidence=await evaluate(ws,`(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  while(!window.kaminosWaterSources||!window.kaminosWorkbenchExperiments){if(window.kaminosWorkbenchExperimentError)throw Error(window.kaminosWorkbenchExperimentError);await wait(100);}
  const api=window.kaminosWaterSources,sceneApi=window.kaminosSceneAuthoring;
  const bowl=sceneApi.addMesh('bowl',{radius:.6,thickness:.08});sceneApi.setMaterial(bowl,{color:'#bb4422',roughness:.6});
  window.kaminosSetSceneObjectTransform(bowl,{position:[0,.45,0],rotation:[0,0,0],scale:[1,1,1]});
  const id=await api.add({mode:'continuous'});window.kaminosSetSceneObjectTransform(id,{position:[0,.8,0],rotation:[Math.PI/2,0,0],scale:[1,1,1]});
  api.edit(id,{volumeRate:.05,baseRadius:.04,strength:1.15});api.editSimulation({particleCount:32000,waterSampling:{...api.read().simulation.sampling,container:{min:[-.7,-.2,-.7],max:[.7,1,.7]}}});
  window.kaminosSetCameraDebugPose({position:[1.7,1.4,1.7],target:[0,.25,0]});
  await api.release();window.kaminosPauseLocalLiquid(true);await api.advanceTo(240);
  const before=window.kaminosLocalLiquidState();window.kaminosPauseLocalLiquid(false);
  const frames=[],start=performance.now();await new Promise(resolve=>{const sample=now=>{
   const s=window.kaminosLocalLiquidState();frames.push({now,sceneFrame:s.frameCount,step:s.solver.clock.step,completedStep:s.solver.clock.completedStep,backlogSeconds:s.solver.clock.backlogSeconds,pending:s.solver.pending,cadence:s.solver.cadence});
   if(now-start<3000)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);});
  window.kaminosPauseLocalLiquid(true);await api.advanceTo(window.kaminosLocalLiquidState().solver.clock.step);
  const after=window.kaminosLocalLiquidState();
  if(before.effectiveRoute!=='kaminos/mls-mpm-finger-juice-v1'||after.fallbackRoute!==null||after.failure||after.solver.failure||before.solver.capacity!==32000||frames.length<2||frames.at(-1).completedStep<=frames[0].completedStep)throw Error('Invalid effective cadence run');
  return {id,bowl,before,after,frames,source:await(await fetch('/api/runtime-config')).json()};
 })()`,{timeoutMs:60000});
 await capture(ws,out);return evidence;
}
