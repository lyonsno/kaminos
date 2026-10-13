import {createCreatureMotionPlayback} from './playback.mjs';
import * as THREE from '../../lib/three.core.js';
import {acquireCreatureBody,validateCreatureTransform} from './body-source.mjs';
export {withHeldCreatureFrame} from './held-capture.mjs';
export {installCreatureInvestigation} from './investigation-browser.mjs';

// Owner contribution. Scene-session spelling follows the current shared join
// proposal; native host conformance must be exercised after that join lands.
export default {
 id:'marionette/retained-creature',title:'Creature · retained generated motion',
 async create({host,inputs={},record=()=>{}}){
  if(typeof inputs.asset!=='string'||!inputs.asset.trim())throw Error('Retained creature requires an asset URL');
  if(!/^[a-f0-9]{64}$/i.test(inputs.source_sha256??''))throw Error('Retained creature requires its expected motion source identity');
  if(typeof host?.scene?.open!=='function')throw Error('Shared Workbench scene session is unavailable');
  if(inputs.transform!==undefined)validateCreatureTransform(inputs.transform);
  const session=await host.scene.open();let player,unsubscribe=null,mounted=null,disposed=false,disposal;
  let refresh=()=>{};
  const callbacks=new Map();let nextCallback=0,clockMs=0;
  const cancelFrame=id=>{
   callbacks.delete(id);
   if(!callbacks.size&&unsubscribe){const stop=unsubscribe;unsubscribe=null;stop();}
  };
  const requestFrame=callback=>{
   const id=++nextCallback;callbacks.set(id,callback);
   if(!unsubscribe)unsubscribe=session.onFrame(({deltaSeconds})=>{
    if(disposed)return;
    if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Shared scene frame requires finite nonnegative deltaSeconds');
    clockMs+=deltaSeconds*1000;
    // Adapt the host's shared frame subscription to the controller's one-shot
    // clock. No renderer, independent RAF pump or per-frame recording is added.
    const due=[...callbacks.values()];callbacks.clear();
    for(const tick of due)tick(clockMs);
    if(!callbacks.size&&unsubscribe){const stop=unsubscribe;unsubscribe=null;stop();}
   });
   return id;
  };
  async function releaseResources(){
   const errors=[];
   const attempt=fn=>{try{fn();}catch(error){errors.push(error);}};
   refresh=()=>{};const panel=mounted;mounted=null;
   attempt(()=>panel?.remove());
   attempt(()=>player?.dispose());
   callbacks.clear();const stop=unsubscribe;unsubscribe=null;attempt(()=>stop?.());
   // A controller/notification failure must not prevent owned scene release.
   try{await session?.dispose?.();}catch(error){errors.push(error);}
   return errors;
  }
  try {
   for(const name of ['loadAsset','onFrame','redraw','readView','setView','dispose'])
    if(typeof session?.[name]!=='function')throw Error(`Shared scene session lacks ${name}`);
   const body=await acquireCreatureBody(inputs);let asset;
   try{asset=await session.loadAsset({url:body.url,metadata:{source:inputs.asset}});}
   finally{body.release();}
   const identities=[];asset.root?.traverse(object=>{if(object.userData?.native_motion)identities.push(object.userData.native_motion);});
   if(identities.length!==1||identities[0].source_sha256?.toLowerCase()!==inputs.source_sha256.toLowerCase())
    throw Error('Loaded creature motion source identity differs from the requested retained source');
   const clips=asset.clips??[];
   const clip=inputs.clip?clips.find(candidate=>candidate.name===inputs.clip):clips.length===1?clips[0]:null;
   if(!clip)throw Error('Select one actual retained creature animation clip');
   player=createCreatureMotionPlayback({THREE,root:asset.root,clip,source:identities[0],
    requestFrame,cancelFrame,onDirty:()=>{session.redraw();refresh();}});
   player.seek(inputs.frame??0);
   if(inputs.transform!==undefined){
    asset.root.position.fromArray(inputs.transform.position);asset.root.quaternion.fromArray(inputs.transform.quaternion);asset.root.scale.fromArray(inputs.transform.scale);
    asset.root.updateMatrixWorld(true);session.redraw();
   }
   if(inputs.view!==undefined)await session.setView(inputs.view);
   const read=()=>({...player.read(),asset:{requested:inputs.asset,effective:asset.source,id:asset.id,bodySha256:body.bodySha256},
    transform:{position:asset.root.position.toArray(),quaternion:asset.root.quaternion.toArray(),scale:asset.root.scale.toArray()},view:session.readView()});
   const active=()=>{if(disposed)throw Error('Creature experiment is disposed');};
   const observed=()=>{try{return {effective:read()};}catch(error){return {effective:null,effectiveError:error.message};}};
   const operation=(name,apply)=>input=>{
    active();record({kind:`creature.${name}`,phase:'requested',target:asset.id,requested:input??null,...observed()});
    try{const result=apply(input);record({kind:`creature.${name}`,phase:'applied',target:asset.id,effective:result});return result;}
    catch(error){record({kind:`creature.${name}`,phase:'failed',target:asset.id,error:error.message,...observed()});throw error;}
   };
   const operations={
    replay:operation('replay',()=>player.replay()),pause:operation('pause',()=>player.pause()),
    resume:operation('resume',()=>player.resume()),seek:operation('seek',input=>player.seek(input?.frame)),
    hold:operation('hold',input=>{
     const priorStatus=player.read().status;
     // Hold an exact native source sample for shared Capture and reconstruction.
     player.seek(input?.frame??player.read().frame);
     const state=read();
     return {priorStatus,state,inputs:{asset:inputs.asset,body_sha256:body.bodySha256,source_sha256:inputs.source_sha256,
      clip:clip.name,frame:state.frame,transform:structuredClone(state.transform),view:structuredClone(state.view)}};
    }),
   };
   const dispose=()=>{
    if(disposal)return disposal;disposed=true;
    // Publish completion before cleanup: a synchronous host callback can close
    // again, and every caller must await the same pending or failed removal.
    let resolve,reject;disposal=new Promise((yes,no)=>{resolve=yes;reject=no;});
    releaseResources().then(errors=>{
     if(errors.length===1)throw errors[0];
     if(errors.length)throw new AggregateError(errors,'Creature cleanup failed');
    }).then(resolve,reject);
    return disposal;
   };
   return {read,operations,dispose,mount({root,document=host.controls?.document,invoke}){
    active();if(!document)throw Error('Creature controls require the shared document');
    mounted?.remove();const panel=document.createElement('section');panel.className='creature-motion-instruments';mounted=panel;
    const title=document.createElement('h3');title.textContent=clip.name;panel.append(title);
    const details=document.createElement('p');details.textContent=identities[0].front_surface??'Retained source-native motion';panel.append(details);
    const status=document.createElement('output');status.setAttribute('aria-live','off');panel.append(status);
    const error=document.createElement('output');error.setAttribute('role','alert');
    const call=async(name,input)=>{try{error.textContent='';await invoke(name,input);refresh();}catch(e){error.textContent=e.message;}};
    for(const [name,label] of [['replay','Replay'],['pause','Pause'],['resume','Resume'],['hold','Hold frame for Capture']]){
     const button=document.createElement('button');button.textContent=label;button.type='button';button.onclick=()=>call(name);panel.append(button);
    }
    for(const [label,sourceFrame] of [['First source pose',0],['Midpoint source pose',Math.floor((identities[0].frames-1)/2)],['Last source pose',identities[0].frames-1]]){
     const button=document.createElement('button');button.textContent=label;button.type='button';button.onclick=()=>call('seek',{frame:sourceFrame});panel.append(button);
    }
    const label=document.createElement('label');label.textContent='Source frame ';
    const frame=document.createElement('input');frame.type='range';frame.min='0';frame.max=String(identities[0].frames-1);frame.step='1';
    frame.setAttribute('aria-label','Creature source frame');frame.oninput=()=>call('seek',{frame:Number(frame.value)});label.append(frame);panel.append(label,error);
    refresh=()=>{const state=player.read();status.textContent=`${state.status} · frame ${state.frame+1}/${state.source.frames} · ${state.time.toFixed(3)} s`;frame.value=String(state.frame);};
    root.append(panel);refresh();return {dispose(){if(mounted===panel){refresh=()=>{};mounted=null;}panel.remove();}};
   }};
  }catch(error){
   disposed=true;const errors=await releaseResources();
   if(errors.length)throw new AggregateError([error,...errors],'Creature creation failed and cleanup reported errors',{cause:error});
   throw error;
  }
 },
};
