// One-shot source animation playback; this does not retarget or edit a rig.
export function assertNativeAnimationEvidence(first,second){
  if(!first?.native||!second?.native||JSON.stringify(first.native)!==JSON.stringify(second.native))
    throw new Error('Native source identity changed or is missing');
  const native=first.native;
  if(!Number.isInteger(native.frames)||native.frames<2||!Number.isFinite(native.fps)||native.fps<=0||native.retargeted!==false)
    throw new Error('Invalid native source identity');
  const duration=(native.frames-1)/native.fps;
  for(const state of [first,second]){
    if(!Number.isFinite(state.duration)||Math.abs(state.duration-duration)>1e-5)throw new Error('Native duration differs from source');
    if(!state.poses?.length||state.poses.length!==native.joint_names?.length)throw new Error('Native joint count incomplete');
    if(state.poses.some(p=>p.position.length!==3||p.position.some(x=>!Number.isFinite(x))))throw new Error('Nonfinite native joint positions');
  }
  if(!(second.time>first.time))throw new Error('Native animation time did not advance');
  if(!first.poses.some((p,i)=>p.position.some((x,j)=>Math.abs(x-second.poses[i].position[j])>1e-5)))
    throw new Error('Native joint positions did not change');
}
export function createGLBAnimationPreview({THREE,onDirty=()=>{},requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}){
  let mixer=null,action=null,root=null,clips=null,handle=null,last=null,status='idle',ticks=0;
  const state=()=>({status,active:status==='playing',rootUuid:root?.uuid||null,
    clipName:clips?.[0]?.name||null,duration:clips?.[0]?.duration||0,time:action?.time||0,ticks});
  function cancel(){if(handle!==null)cancelFrame(handle);handle=null;last=null;}
  function dispose(nextStatus='stopped'){
    cancel();mixer?.stopAllAction();if(root)mixer?.uncacheRoot(root);
    mixer=null;action=null;status=nextStatus;onDirty();
  }
  function tick(now){
    handle=null;
    if(!root?.parent){dispose('removed');return;}
    const dt=last===null?0:Math.max(0,(now-last)/1000);last=now;
    mixer.update(dt);ticks++;onDirty();
    if(action.time>=clips[0].duration){status='held';last=null;return;}
    handle=requestFrame(tick);
  }
  function play(nextRoot,nextClips){
    if(!nextRoot||!Array.isArray(nextClips)||!nextClips.length||!Number.isFinite(nextClips[0].duration)||nextClips[0].duration<=0)
      throw new Error('Requested GLB has no usable animation clip');
    dispose();root=nextRoot;clips=nextClips;ticks=0;
    mixer=new THREE.AnimationMixer(root);
    action=mixer.clipAction(clips[0]).setLoop(THREE.LoopOnce,1);
    action.clampWhenFinished=true;action.play();status='playing';
    handle=requestFrame(tick);onDirty();return state();
  }
  function pause(){cancel();if(action)action.paused=true;status='paused';onDirty();return state();}
  function replay(){return play(root,clips);}
  return {play,pause,replay,dispose,state};
}
