import {runGenerationWitness} from './sparse-generation-witness.js';
// Match the capacity requested by the already exercised full native route.
// This is a device capability requirement, not a RAM allocation or fit claim.
export const sharedGpuBufferRequirements={maxBufferSize:4294967292,maxStorageBufferBindingSize:4294967292};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
export function judgeTrellisSharedComposition(s){
  const errors=[],r=s?.result,release=r?.sharedRelease;
  if(s?.sameDevice!==true||r?.deviceTopology!=='same-device')errors.push('not the authored scene device');
  if(r?.status!=='succeeded')errors.push('complete generation did not succeed');
  if(release?.status!=='released'||release.gpuSettled!==true)errors.push('model resources not settled');
  if(!release?.foreground?.receipts?.some(x=>x.runId===s.runId&&x.phase!=='foreground-run-finish'&&
    x.status==='completed'&&x.submissionCount>0&&x.result?.renderer==='ordinary-volume'&&x.result?.status==='submitted'))
    errors.push('no ordinary foreground submission during model work');
  if(!(s?.after?.frameCount>s?.before?.frameCount&&s.after.simStepCount>s.before.simStepCount))errors.push('live flame did not advance');
  if(!(s?.afterRelease?.frameCount>s?.after?.frameCount))errors.push('ordinary renderer did not continue after release');
  if(s?.presentation?.status!=='registered'||!s.presentation.objectId||s.presentation.sha256!==s.asset?.sha256||
    s.presentation.runId!==s.runId||!(s.asset?.byteLength>0))errors.push('finished current output not registered');
  return errors;
}
export async function mountComposition({sharedGpu,host,prototype}){
  const state={status:'running',phase:'authored-scene-admission',
    scope:'full prepared-image WebGPU TRELLIS on authored scene device; no matched-MLX fidelity or smoothness claim'};
  window.__trellisSharedGeneration=state;
  const snapshot=()=>{const d=prototype.debugState();return{frameCount:d.frameCount,simStepCount:d.simStepCount,
    preset:window.__kaminosVolumeSettingsPresetReceipt,objects:window.kaminosSceneObjectDebugState?.()};};
  try{
    const params=new URLSearchParams(window.location.hash.slice(1)),sha=params.get('trellis_manifest_sha');
    if(!/^[a-f0-9]{64}$/.test(sha??''))throw Error('exact prepared input manifest required');
    for(;;){
      const d=prototype.debugState(),context=prototype.foregroundGpuContext(),objects=window.kaminosSceneObjectDebugState?.()??[];
      if(context.active&&objects.some(o=>o.source?.includes('f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b')))break;
      if(d.error||d.backend==='unavailable'||window.__kaminosCompositionRestore?.status==='failed')throw Error('authored kiln/ordinary renderer failed');
      await wait(100);
    }
    await wait(1500);state.before=snapshot();
    if(state.before.preset?.presetId!=='vsp-13e22642e71f4ac8f758fae803a83110577ecc6d7ef9f233411e096af8e9097b')throw Error('actual authored basin not restored');
    state.sameDevice=host.device===sharedGpu.device&&prototype.foregroundGpuContext().device===sharedGpu.device&&
      prototype.foregroundGpuContext().queue===sharedGpu.queue;
    if(!state.sameDevice)throw Error('scene and model device/queue mismatch');
    state.phase='complete-image-generation';
    state.result=await runGenerationWitness(sha,{sharedComposition:{sharedGpu,host,prototype},memoryMonitor:true});
    if(state.result.status!=='succeeded')throw Error(state.result.error?.message??'full generation failed');
    state.runId=state.result.sharedRelease.runId;state.after=snapshot();
    state.phase='retained-output-finishing';
    const response=await fetch('/__trellis_completed',{method:'POST',body:JSON.stringify(state.result)});
    if(!response.ok)throw Error('retained finishing failed: '+await response.text());
    state.asset=await response.json();
    const assetResponse=await fetch('/__trellis_finished',{cache:'no-store'});
    if(!assetResponse.ok)throw Error('finished output unavailable');
    const glb=await assetResponse.arrayBuffer();
    if(glb.byteLength!==state.asset.byteLength||await hash(glb)!==state.asset.sha256)throw Error('finished output changed or partial');
    state.phase='actual-host-presentation';
    state.presentation=await host.presentGlb(glb,{runId:state.runId,sha256:state.asset.sha256});
    if(!window.renameSceneObject?.(state.presentation.objectId,'TRELLIS sneaker · '+state.runId))throw Error('generated output label not applied');
    await window.kaminosSceneEdits.apply(state.presentation.objectId,{position:[1.2,.1,.3]},'Place TRELLIS beside authored kiln');
    await wait(1500);state.afterRelease=snapshot();
    const errors=judgeTrellisSharedComposition(state);if(errors.length)throw Error(errors.join('; '));
    state.status='succeeded';state.phase=null;
  }catch(e){state.status='failed';state.error={name:e.name,message:e.message,stack:e.stack};}
  finally{state.finishedAt=new Date().toISOString();}
  return state;
}
