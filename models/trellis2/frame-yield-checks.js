// Offline evidence admission; a successful subprocess alone cannot close the comparison.
export function validateFrameYieldState(state,{shape,frameBudgetMs,maxTaskYieldsPerFrame,scene}){
 const need=(ok,message)=>{if(!ok)throw Error(message);};
 need(state?.status==='completed'&&state.phase==='complete','complete retained-block report required');
 need(state.backend?.vendor==='apple'&&state.backend.architecture?.includes('metal')&&state.backend.isFallbackAdapter===false,'actual nonfallback Apple Metal required');
 need(state.effectiveRoute==='trellis2.image-generation.webgpu.v0','actual app model route required');
 if(scene){
  const observed=state.scene,link=observed?.state,object=observed?.objects?.find(o=>o.id===link?.registeredObjectId);
  const url=new URL(link?.effectiveUrl??'/','http://assay.invalid');
  need(link?.schema==='kaminos.asset-smoke-link.v0'&&link.status==='loaded'&&link.assetType==='mesh'&&link.requestedRoot===scene.root&&link.requestedPath===scene.path&&observed.sha256===scene.sha256&&url.pathname==='/api/read'&&url.searchParams.get('root')===scene.root&&url.searchParams.get('path')===scene.path&&object?.type==='glb'&&object.source===link.effectiveUrl,'actual requested scene asset and registration required');
 }
 need(state.release?.status==='released'&&!state.cleanupError&&Array.isArray(state.errors)&&!state.errors.length,'released error-free route required');
 need(Array.isArray(state.runs)&&state.runs.length===3,'warmup and complete matched pair required');
 for(const [i,mode]of ['warmup','baseline','frame-aware'].entries()){
  const run=state.runs[i];need(run.mode===mode,'run order/identity mismatch');
  need(Number.isFinite(run.wallMs)&&run.wallMs>0&&run.endMs>run.startMs,'positive completed wall interval required');
  need(JSON.stringify(run.output?.shape)===JSON.stringify(shape)&&run.output.byteLength===shape.reduce((a,b)=>a*b,4)&&/^[a-f0-9]{64}$/.test(run.output.sha256),'complete output identity required');
  need(Array.isArray(run.frames)&&run.frames.every((t,j)=>Number.isFinite(t)&&t>=run.startMs&&t<=run.endMs&&(!j||t>=run.frames[j-1])),'complete frame timeline required');
 }
 const a=state.runs[1],b=state.runs[2];need(a.output.sha256===b.output.sha256,'scheduling changed final output');
 need(b.policy?.frameBudgetMs===frameBudgetMs&&b.policy.maxTaskYieldsPerFrame===maxTaskYieldsPerFrame&&b.policy.frameYields>0&&b.policy.gpuDrains>0&&b.frames.length>0,'effective frame-aware policy required');
 need(Number.isFinite(b.sceneFramesBefore)&&b.sceneFramesAfter>b.sceneFramesBefore,'actual foreground render progress required');
 need(Number.isFinite(state.stop?.requestedAt)&&state.stop.observedAt>=state.stop.requestedAt&&state.stop.status!=='succeeded'&&state.stop.failure?.name==='AbortError','observed route Stop required');
 return true;
}
