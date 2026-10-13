export function attachGivenPalettePlayback({THREE,runtime,adapter,source,document,mountRoot,
 now=()=>performance.now(),dirty=()=>globalThis.window?._kaminosDirty?.()}) {
 if(!runtime?.group?.isObject3D||!(runtime.bones instanceof Map)||typeof runtime.update!=='function'||!mountRoot||!document)throw Error('Given motion requires the actual live Bone/deformer runtime and controls mount');
 for(const name of ['motionSha256','frameSha256','caseSha256'])if(!/^[a-f0-9]{64}$/i.test(source?.[name]??''))throw Error('Given motion source identity is incomplete');
 if(adapter.jointNames.length!==runtime.bones.size||adapter.jointNames.some(name=>!runtime.bones.get(name)?.isBone))throw Error('Live Bone inventory differs from given motion');
 const original=runtime.update,group=runtime.group;group.updateMatrix();const base=group.matrix.clone();
 let frame=0,status='paused',startedAt=null,startedFrame=0,expected=null,error=null,disposed=false;
 const panel=document.createElement('section');panel.className='given-motion-instruments';
 const title=document.createElement('h3');title.textContent='Generated trot · whole-body transport';
 const note=document.createElement('p');note.textContent=`${adapter.jointNames.length} given Bones · retained source · no new inference or paint`;
 const output=document.createElement('output'),failure=document.createElement('output');failure.setAttribute('role','alert');
 const range=document.createElement('input');range.type='range';range.min='0';range.max=String(adapter.frames-1);range.step='1';range.setAttribute('aria-label','Whole-body source frame');
 panel.append(title,note,output);
 const active=()=>{if(disposed||!group.parent)throw Error('Whole-body motion runtime is no longer mounted');};
 const matrices=()=>{group.updateMatrix();return {actor:group.matrix.toArray(),bones:adapter.jointNames.map(name=>{const bone=runtime.bones.get(name);bone.updateMatrix();return {name,matrix:bone.matrix.toArray()};})};};
 const differs=(a,b)=>!b||a.some((v,i)=>Math.abs(v-b[i])>1e-8);
 function edited(){if(!expected)return false;const current=matrices();return differs(current.actor,expected.actor)||current.bones.some((b,i)=>differs(b.matrix,expected.bones[i].matrix));}
 function refresh(){output.textContent=`${status} · source frame ${frame+1}/${adapter.frames} · ${(frame/adapter.fps).toFixed(3)} s${edited()?' · edited after source pose':''}`;range.value=String(frame);failure.textContent=error??'';}
 function apply(index){
  active();const pose=adapter.frame(index),before=matrices();
  // Validate all handles/matrices before changing any actual Bone.
  for(const b of pose.bones){const bone=runtime.bones.get(b.name);if(bone.parent?.isBone?bone.parent.name!==b.parent:b.parent!==null)throw Error('Live Bone parent differs from given tree');}
  const assign=(object,matrix)=>new THREE.Matrix4().fromArray(matrix).decompose(object.position,object.quaternion,object.scale);
  try{
   assign(group,base.clone().multiply(new THREE.Matrix4().fromArray(pose.actorMatrix)).elements);
   for(const b of pose.bones)assign(runtime.bones.get(b.name),b.localMatrix);
   group.updateMatrixWorld(true);original.call(runtime);frame=index;expected=matrices();error=null;
  }catch(failure){assign(group,before.actor);for(const b of before.bones)assign(runtime.bones.get(b.name),b.matrix);group.updateMatrixWorld(true);try{original.call(runtime);}catch{}error=failure.message;status='failed';throw failure;}
  refresh();dirty();return read();
 }
 function read(){return {status,frame,time:frame/adapter.fps,frames:adapter.frames,fps:adapter.fps,source:structuredClone(source),
  editedSinceSourcePose:edited(),actualLocalPose:matrices(),error,seamlessLoop:false};}
 function seek(index){active();if(!Number.isInteger(index)||index<0||index>=adapter.frames)throw RangeError('Source frame is outside retained motion');status=index===adapter.frames-1?'held':'paused';startedAt=null;return apply(index);}
 function play(){active();if(status==='held')return read();if(status!=='playing'){startedAt=now();startedFrame=frame;status='playing';refresh();dirty();}return read();}
 function pause(){active();status=frame===adapter.frames-1?'held':'paused';startedAt=null;refresh();dirty();return read();}
 function replay(){seek(0);return play();}
 function tick(timestamp=now()){
  if(disposed)return false;
  if(!group.parent){status='removed';startedAt=null;return false;}
  if(status==='playing'){
   if(!Number.isFinite(timestamp))throw Error('Source playback requires a finite host timestamp');
   const next=Math.min(adapter.frames-1,startedFrame+Math.floor(Math.max(0,timestamp-startedAt)*adapter.fps/1000+1e-6));
   if(next!==frame)apply(next);
   if(next===adapter.frames-1){status='held';startedAt=null;refresh();}
   return status==='playing';
  }
  return false;
 }
 const call=action=>{try{action();refresh();}catch(failure){error=failure.message;refresh();}};
 for(const [label,action] of [['Play source',play],['Pause source',pause],['Replay source',replay],['First source pose',()=>seek(0)],['Midpoint source pose',()=>seek(Math.floor((adapter.frames-1)/2))],['Last source pose',()=>seek(adapter.frames-1)]]){
  const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>call(action);panel.append(button);
 }
 range.oninput=()=>call(()=>seek(Number(range.value)));panel.append(range,failure);mountRoot.prepend?mountRoot.prepend(panel):mountRoot.append(panel);
 try{apply(0);}catch(failure){panel.remove();throw failure;}
 return Object.freeze({read,seek,play,pause,replay,tick,dispose(){if(disposed)return;disposed=true;status='disposed';startedAt=null;panel.remove();}});
}
