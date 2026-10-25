import {createInferenceKiln} from '../inference-kiln.mjs';
import {ensureKilnSceneDomain} from '../inference-kiln-scene.mjs';

export default {id:'inference-kiln-material',title:'Inference Kiln · material',async create({host,inputs={},record}){
 const session=await host.scene.open(),doc=host.controls.document,app=doc.defaultView.kaminosSceneAuthoring;
 let kiln,asset,flame,runtime,restore,emitter,emitterPose,paused,ground,groundVisible,stop=()=>{},closed=false,pulse=0,status,mode='lettering',ignitionStart=0;
 const setFeed=enabled=>flame.setControls({'volume-flow-rate':enabled?2.5:0,'volume-immersed-fuel':enabled?.55:0});
 const settle=()=>app.settleCombustion();
 const read=()=>({...kiln.read(),objectId:asset.id,ignition:mode,heating:pulse>0,paused:runtime.debugState().simulationPaused,
  combustion:app.burningState(asset.id),flame:flame.read().clock,scope:'native-material-study-no-model-inference'});
 const sync=()=>{if(status)status.textContent=pulse>0?'Igniting the lettering…':'Heating is off. The material continues responding.';};
 const reset=async()=>{if(closed)throw Error('Material study is closed');runtime.setSimulationPaused(true);pulse=0;setFeed(false);
  app.setBurnable(asset.id,false);await settle();runtime.resetThermalExperimentFluid();app.setBurnable(asset.id,true);await settle();session.redraw();sync();return read();};
 async function dispose(){if(closed)return;closed=true;stop();
  try{if(asset&&host.scene.objects().some(row=>row.id===asset.id)){app.setBurnable(asset.id,false);await settle();}}
  finally{try{await session.dispose();}finally{kiln?.dispose();if(restore)flame.setControls(restore);if(emitterPose&&host.scene.objects().some(row=>row.id===emitter.id))host.scene.setTransform(emitter.id,emitterPose);if(runtime)runtime.setSimulationPaused(paused);if(ground){ground.checked=groundVisible;ground.onchange({target:ground});}}}
 }
 try{
  await host.volume.ready;flame=await host.flame.open();if(!flame.read().active)throw Error('Open this material study through inference-kiln-study.html?material=1');
  runtime=host.volume.get();paused=runtime.debugState().simulationPaused===true;runtime.setSimulationPaused(true);
  await ensureKilnSceneDomain(host,flame);
  const original=flame.read().settings;
  restore=Object.fromEntries(['volume-flow-rate','volume-immersed-fuel','volume-ray-start-noise','volume-ray-noise-animated'].map(id=>[id,(original.domControls[id]??original.rendererControls[id]).value]));
  flame.setControls({'volume-ray-start-noise':false,'volume-ray-noise-animated':false});setFeed(false);runtime.resetThermalExperimentFluid();
  kiln=createInferenceKiln({document:doc,prompt:inputs.prompt??'A weathered bronze lantern',representation:'relief'});
  kiln.text.removeFromParent();await session.attach(kiln.root,{owned:true,presentation:true});
  asset=await session.attach(kiln.text,{owned:true,metadata:{type:'pbr',label:'Prompt lettering'}});
  ground=doc.getElementById('composition-ground-visible');groundVisible=ground?.checked;if(ground){ground.checked=false;ground.onchange({target:ground});}
  app.setBurnable(asset.id,true);await settle();
  emitter=host.scene.objects().find(entry=>entry.type==='flame-emitter');if(!emitter)throw Error('Scene flame emitter is absent');
  emitterPose={position:emitter.object.position.toArray(),rotation:[emitter.object.rotation.x,emitter.object.rotation.y,emitter.object.rotation.z],scale:emitter.object.scale.toArray()};
  const operations={read,
   async setPrompt(value){if(typeof value!=='string'||!value.trim())throw Error('Enter a prompt to burn');if(closed)throw Error('Material study is closed');runtime.setSimulationPaused(true);pulse=0;setFeed(false);app.setBurnable(asset.id,false);await settle();kiln.setPrompt(value);app.setBurnable(asset.id,true);await settle();host.scene.refreshPresentation(asset);record({kind:'kiln.material.prompt',effective:read()});return read();},
   setIgnition(value){if(!['lettering','below'].includes(value))throw Error('Unknown ignition placement');mode=value;return read();},
   ignite(){if(closed)throw Error('Material study is closed');const center=kiln.text.position.toArray();
    const position=[center[0],mode==='below'?center[1]-.4:center[1],mode==='below'?center[2]:center[2]-.1];
    host.scene.setTransform(emitter.id,{position,rotation:mode==='below'?[0,0,0]:[Math.PI/2,0,0],scale:emitterPose.scale});
    ignitionStart=app.burningState(asset.id).state?.fields?.[0]?.referenceSeconds??0;pulse=3;setFeed(true);runtime.setSimulationPaused(false);sync();record({kind:'kiln.material.ignite',effective:read()});return read();},
   stopHeating(){pulse=0;setFeed(false);sync();return read();},reset,
   setPaused(value){if(typeof value!=='boolean')throw Error('Pause must be Boolean');runtime.setSimulationPaused(value);return read();},
   frame(){host.scene.select(asset.id);return session.setView({position:[0,.1,4.5],target:[0,0,0]});},
  };
  stop=session.onFrame(({deltaSeconds})=>{if(pulse>0){const state=app.burningState(asset.id);pulse=state.status==='resident'?Math.max(0,3-((state.state.fields[0].referenceSeconds??0)-ignitionStart)):0;if(!pulse){setFeed(false);sync();}}});operations.frame();
  return {read,operations,mount({root,document,invoke}){
   const field=document.createElement('textarea');field.rows=3;field.value=kiln.read().prompt;field.setAttribute('aria-label','Material study prompt');field.style.cssText='width:100%;box-sizing:border-box;background:#202327;color:#eee;padding:10px;border:1px solid #42464c;border-radius:6px;';
   field.onchange=()=>invoke('setPrompt',field.value).catch(error=>status.textContent=error.message);
   const label=document.createElement('label');label.textContent='Ignition';const select=document.createElement('select');
   for(const [value,text]of [['lettering','At the lettering'],['below','From below']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.onchange=()=>invoke('setIgnition',select.value);label.append(select);
   const actions=document.createElement('div');actions.className='flame-basin-actions';for(const [text,op]of [['Ignite','ignite'],['Stop heating','stopHeating'],['Reset','reset']]){const button=document.createElement('button');button.className='btn';button.textContent=text;button.onclick=()=>invoke(op).catch(error=>status.textContent=error.message);actions.append(button);}
   status=document.createElement('p');status.setAttribute('role','status');const help=document.createElement('p');help.textContent='Select the lettering to edit its combustion and obstacle properties. Ignition gives a brief heat pulse; retained heat and fuel drive the burn.';root.append(field,label,actions,status,help);sync();
  },dispose};
 }catch(error){await dispose();throw error;}
}};
