// Domain-side operations for an already loaded retained creature clip. The
// shared Workbench owns scene loading, camera, controls and observation storage.
export function createCreatureMotionPlayback({THREE,root,clip,source,onDirty=()=>{},
  requestFrame=globalThis.requestAnimationFrame,cancelFrame=globalThis.cancelAnimationFrame}={}) {
  if(!root?.isObject3D||!(clip instanceof THREE.AnimationClip)||!Number.isFinite(clip.duration)||clip.duration<=0)
    throw new Error('Creature playback requires an actual scene object and animation clip');
  if(!Number.isInteger(source?.frames)||source.frames<2||!Number.isFinite(source.fps)||source.fps<=0
    ||source.retargeted!==false||!/^[a-f0-9]{64}$/i.test(source.source_sha256??''))
    throw new Error('Creature playback requires retained source identity');
  const duration=(source.frames-1)/source.fps;
  if(Math.abs(clip.duration-duration)>1e-5)throw new Error('Creature clip duration differs from source');
  if(typeof requestFrame!=='function'||typeof cancelFrame!=='function')throw new Error('Creature playback requires a frame clock');
  const identity=structuredClone(source),mixer=new THREE.AnimationMixer(root);
  const action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);
  action.clampWhenFinished=true;action.play();action.paused=true;mixer.update(0);
  let status='paused',handle=null,last=null,generation=0,disposed=false;
  const active=()=>{if(disposed)throw new Error('Creature playback is disposed');};
  const read=()=>({status,time:action.time,frame:Math.min(identity.frames-1,Math.floor(action.time*identity.fps+1e-5)),
    duration:clip.duration,clipName:clip.name,rootUuid:root.uuid,source:structuredClone(identity),seamlessLoop:false});
  function cancel(){generation++;if(handle!==null)cancelFrame(handle);handle=null;last=null;}
  function pause(){active();cancel();action.paused=true;status='paused';onDirty();return read();}
  function seek(frame){
    active();
    if(!Number.isInteger(frame)||frame<0||frame>=identity.frames)throw new RangeError('Creature frame is outside the retained source');
    pause();action.enabled=true;action.time=frame/identity.fps;mixer.update(0);
    status=frame===identity.frames-1?'held':'paused';onDirty();return read();
  }
  function resume(){
    active();if(status==='playing'||status==='held')return read();
    cancel();action.paused=false;status='playing';const token=generation;
    const tick=now=>{
      if(disposed||token!==generation)return;
      handle=null;
      if(!root.parent){pause();status='removed';return;}
      const dt=last===null?0:Math.max(0,(now-last)/1000);last=now;
      mixer.update(dt);onDirty();
      if(action.time>=clip.duration){status='held';last=null;return;}
      handle=requestFrame(tick);
    };
    handle=requestFrame(tick);onDirty();return read();
  }
  function replay(){seek(0);return resume();}
  function dispose(){if(disposed)return;cancel();mixer.stopAllAction();mixer.uncacheRoot(root);disposed=true;status='disposed';onDirty();}
  return Object.freeze({read,pause,seek,resume,replay,dispose});
}
