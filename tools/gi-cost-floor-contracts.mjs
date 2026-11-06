// Cost evidence for an actual fresh ordinary scene draw. Pass durations may overlap.
export function summarizeGiCostFrame(record, expected) {
  if(record.backend!=='webgpu')throw Error('Native WebGPU required');
  const {before,after,frame,passes}=record;
  if(!frame?.drawn||frame.sceneFrameCount!==after?.sceneFrames||after.sceneFrames!==before?.sceneFrames+1)throw Error('Missing fresh scene draw');
  if(after.frames!==before.frames+1)throw Error('Estimator did not perform fresh work');
  for(const key of ['resolutionScale','slices','steps','denoise','temporal'])if(after[key]!==expected[key])throw Error('Effective '+key+' differs');
  if(after.estimator?.mipSampling!==expected.mipSampling||after.optimizations?.mipSampling?.effective!==expected.mipSampling)throw Error('Effective mipSampling differs');
  const mipDelta=after.optimizations.mipSampling.frames-before.optimizations.mipSampling.frames;
  if(mipDelta!==(expected.mipSampling?1:0))throw Error('Source pyramid freshness differs');
  if(expected.temporal&&after.history?.frames!==before.history?.frames+1)throw Error('Missing fresh history');
  if(after.filterFrames?.ao-before.filterFrames?.ao!==(expected.denoise>0?1:0))throw Error('Filter scheduling differs');
  if(!Array.isArray(after.resolution)||after.resolution.length!==2||after.resolution.some(n=>!Number.isSafeInteger(n)||n<=0))throw Error('Missing estimator extent');
  if(!passes?.length)throw Error('Missing GPU passes');
  const intervals=passes.map(pass=>{
    if(!Array.isArray(pass.timestamps)||pass.timestamps.length!==2||!pass.timestamps.every(t=>typeof t==='string'&&/^\d+$/.test(t)))throw Error('Invalid GPU timestamp');
    const [a,b]=pass.timestamps.map(BigInt);if(a<=0n||b<a)throw Error('Invalid GPU timestamp interval');return [a,b];
  }).sort((x,y)=>x[0]<y[0]?-1:x[0]>y[0]?1:0);
  let start=intervals[0][0],end=intervals[0][1],union=0n,sum=0n;
  for(const [a,b] of intervals){sum+=b-a;if(a>end){union+=end-start;start=a;end=b;}else if(b>end)end=b;}union+=end-start;
  const span=intervals.reduce((end,row)=>row[1]>end?row[1]:end,0n)-intervals[0][0];
  if(span<=0n)throw Error('Unresolved zero-duration GPU span');
  return {gpuSpanMs:Number(span)/1e6,gpuUnionMs:Number(union)/1e6,passDurationSumMs:Number(sum)/1e6,passCount:passes.length};
}

// Runs before each navigation, including the Workbench witness's about:blank.
export function installGiCostDeviceCapture(scope=globalThis){
 if(!scope.GPUAdapter)return false;
 const request=scope.GPUAdapter.prototype.requestDevice;scope.__costDevices=[];scope.__costViews=new WeakMap();
 scope.GPUAdapter.prototype.requestDevice=async function(...args){
  const device=await request.apply(this,args);scope.__costDevices.push(device);device.addEventListener('uncapturederror',e=>scope.__costGpuError(e.error.message));
  const create=device.createTexture;device.createTexture=function(descriptor){const texture=create.call(this,descriptor),view=texture.createView;texture.createView=function(desc={}){const result=view.call(this,desc);scope.__costViews.set(result,{label:()=>texture.label,width:texture.width,height:texture.height,format:texture.format,mipLevels:texture.mipLevelCount,baseMipLevel:desc.baseMipLevel??0});return result;};return texture;};
  return device;
 };
 return true;
}
