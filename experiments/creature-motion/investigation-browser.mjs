import {createInvestigationRecording} from '../../investigation-recording.mjs';
import {createInvestigationGuide} from '../../investigation-guide.mjs';

export async function installCreatureInvestigation({id,source,request,
 entry=globalThis.window?.kaminosWorkbenchExperiments,document=globalThis.document,
 mountRoot=document?.querySelector('.creature-motion-instruments'),
 registry=globalThis.window?(globalThis.window.__kaminosInvestigations??=new Map()):new Map(),
 readScene=()=>window.kaminosSceneAuthoring.read(),viewport=()=>({width:innerWidth,height:innerHeight}),guide={}}) {
 if(!entry||!mountRoot||typeof request!=='function')throw Error('Creature investigation requires its actual entry, instruments and retention binding');
 if(!/^[a-f0-9]{64}$/i.test(source?.rawMotionSha256??''))throw Error('Creature investigation requires its raw motion source identity');
 for(const existing of registry.values())if((existing.isRecording?.()??(await existing.read()).recording.status==='recording'))throw Error('This page already has an active investigation');
 const initialDomain=await entry.read(),rootUuid=initialDomain.rootUuid;
 if(initialDomain.source?.source_sha256!==source.rawMotionSha256)throw Error('Creature investigation source differs from its actual motion');
 let lastObserved,frozen;
 const context=async()=>{
  const state=await entry.state(),domain=await entry.read();
  if(state.id!=='marionette/retained-creature'||domain.rootUuid!==rootUuid||mountRoot.isConnected===false)throw Error('Creature investigation instance changed');
  const inputs={asset:domain.asset.requested,source_sha256:domain.source.source_sha256,clip:domain.clipName,frame:domain.frame,view:structuredClone(domain.view)};
  const scene=await readScene();
  if(!scene?.objects?.some(object=>object.id===domain.asset.id&&object.source===(domain.asset.effective??domain.asset.requested)))throw Error('Creature body is no longer registered in the shared scene');
  const value={entry:state,domain,recipe:{id:state.id,inputs},scene,viewport:viewport()};
  lastObserved=structuredClone(value);return value;
 };
 const initial=await context();
 const recording=createInvestigationRecording({id,source,initial,startingConditions:{kind:'source-clip-runtime',reconstructAfterRestart:false}});
 let component;
 const adapter={
  async read(){const value=await context();return {recording:recording.snapshot(),context:value};},
  isRecording:()=>recording.snapshot().status==='recording',
  async isPresent(){try{await context();return true;}catch{return false;}},
  finish(){
   frozen??=Promise.resolve().then(async()=>{
    const prefix=recording.finish();component.freeze('Recording stopped; saving');
    let value;try{value=await context();}catch(error){value={unavailable:error.message,lastObserved};}
    return {recording:prefix,context:value};
   });return frozen;
  },
  disconnect(message){recording.finish();component?.disconnect(message);},
  saveFailed:message=>component.saveFailed(message),
 };
 try {
  component=createInvestigationGuide({document,
   question:'Keep this creature pose and view',
   tryThis:'Seek a source frame, or capture during playback. Capture holds one source sample while its image and state are retained.',
   whyThisMatters:'Reopen the chosen pose for comparison without regenerating the motion.',...guide,
   onCapture:note=>request({action:'capture',note}),onFinish:note=>request({action:'finish',note})});
  registry.set(id,adapter);mountRoot.append(component.node);return adapter;
 }catch(error){recording.finish();registry.delete(id);component?.node.remove?.();throw error;}
}
