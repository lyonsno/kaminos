import {createInferenceKiln} from '../inference-kiln.mjs';
import {ensureKilnSceneDomain} from '../inference-kiln-scene.mjs';
import {checkedSceneBloom} from '../scene-bloom.mjs';

export default {id:'inference-kiln-material',title:'Inference Kiln · material',async create({host,inputs={},record}){
 const doc=host.controls.document,app=doc.defaultView.kaminosSceneAuthoring;
 const bloom=doc.defaultView.kaminosSceneBloom,bloomSettings=checkedSceneBloom({enabled:true,composeFlame:true,...inputs.bloom});
 let cameraMatch,savedCameraMatch,lastKelvin,restoreBloom,glow=inputs.glow??1,syncFields=()=>{};
 if(!Number.isFinite(glow)||glow<0)throw Error('Invalid incineration glow');
 if(inputs.appearance!==undefined&&!['crust','incineration'].includes(inputs.appearance))throw Error('Unknown kiln appearance');
 if(inputs.prompt!==undefined&&(typeof inputs.prompt!=='string'||!inputs.prompt.trim()))throw Error('Enter a prompt to burn');
 const session=await host.scene.open();
 const applyGlow=()=>{if(kiln.read().appearance==='incineration')app.setBurnAppearance(asset.id,{glow,kelvinPerHeat:Number(doc.getElementById('volume-physical-kelvin-per-heat')?.value??1600)});};
 let restoredPrompt,restoredBurnable,borrowedPrompt=false;
 let kiln,asset,flame,runtime,restore,emitter,emitterPose,paused,ground,groundVisible,stop=()=>{},closed=false,pulse=0,status,mode='lettering',ignitionStart=0;
 const assertOpen=()=>{if(closed)throw Error('Material study is closed');};
 const setFeed=enabled=>flame.setControls({'volume-flow-rate':enabled?2.5:0,'volume-immersed-fuel':enabled?.55:0});
 const settle=()=>app.settleCombustion();
 const activate=async()=>{
  if(flame.read().active)return;
  // Reset, ignition and closing the study restore its initially visible fire.
  // Visibility remains with the native editor and GPU activation with its host.
  doc.defaultView.kaminosSceneVisibility.set('flame-field',true);
  await runtime.setActive(true);await settle();
 };
 const read=()=>({...kiln.read(),objectId:asset.id,ignition:mode,heating:pulse>0,paused:runtime.debugState().simulationPaused,
  combustion:app.burningState(asset.id),bloom:bloom.read(),glow,flame:flame.read().clock,scope:'native-material-study-no-model-inference'});
 const sync=()=>{if(status)status.textContent=pulse>0?'Igniting the lettering…':'Heating is off. The material continues responding.';syncFields();};
 const reset=async()=>{if(closed)throw Error('Material study is closed');runtime.setSimulationPaused(true);await activate();pulse=0;setFeed(false);
  app.setBurnable(asset.id,false);await settle();runtime.resetThermalExperimentFluid();app.setBurnable(asset.id,true);await settle();applyGlow();session.redraw();sync();return read();};
 async function dispose(){if(closed)return;closed=true;stop();
  try{if(runtime&&flame&&!flame.read().active){runtime.setSimulationPaused(true);await activate();}
   if(asset&&host.scene.objects().some(row=>row.id===asset.id)){app.setBurnable(asset.id,borrowedPrompt?restoredBurnable:false);await settle();}}
  finally{try{await session.dispose();}finally{kiln?.dispose();if(restoreBloom)bloom.set(restoreBloom);if(cameraMatch)cameraMatch.checked=savedCameraMatch;if(restore)flame.setControls(restore);if(emitterPose&&host.scene.objects().some(row=>row.id===emitter.id))host.scene.setTransform(emitter.id,emitterPose);if(runtime)runtime.setSimulationPaused(paused);if(ground){ground.checked=groundVisible;ground.onchange({target:ground});}}}
 }
 try{
  cameraMatch=doc.getElementById('rendering-match-flame-camera');savedCameraMatch=cameraMatch?.checked;if(cameraMatch)cameraMatch.checked=true;
  await host.volume.ready;flame=await host.flame.open();if(!flame.read().active)throw Error('Open this material study through inference-kiln-study.html?material=1');
  runtime=host.volume.get();paused=runtime.debugState().simulationPaused===true;runtime.setSimulationPaused(true);
  await ensureKilnSceneDomain(host,flame);
  const original=flame.read().settings;
  restore=Object.fromEntries(['volume-flow-rate','volume-immersed-fuel','volume-ray-start-noise','volume-ray-noise-animated'].map(id=>[id,(original.domControls[id]??original.rendererControls[id]).value]));
  flame.setControls({'volume-ray-start-noise':false,'volume-ray-noise-animated':false});setFeed(false);runtime.resetThermalExperimentFluid();
  restoredPrompt=host.scene.objects().find(row=>row.object?.userData?.kaminosPromptRelief);
  borrowedPrompt=!!restoredPrompt;restoredBurnable=restoredPrompt?.burnable?.enabled===true;
  const savedPrompt=restoredPrompt?.object.userData.kaminosPromptRelief;
  kiln=createInferenceKiln({document:doc,prompt:savedPrompt?.prompt??inputs.prompt??'A weathered bronze lantern',representation:'relief',appearance:inputs.appearance??savedPrompt?.appearance??'incineration',promptMesh:restoredPrompt?.object});
  if(!borrowedPrompt)kiln.text.removeFromParent();await session.attach(kiln.root,{owned:true,presentation:true});
  asset=await session.attach(kiln.text,{owned:!borrowedPrompt,metadata:{type:'pbr',label:'Prompt lettering'}});
  ground=doc.getElementById('composition-ground-visible');groundVisible=ground?.checked;if(ground){ground.checked=false;ground.onchange({target:ground});}
  app.setBurnable(asset.id,true);await settle();applyGlow();restoreBloom=bloom.read().settings;bloom.set(bloomSettings);
  emitter=host.scene.objects().find(entry=>entry.type==='flame-emitter');if(!emitter)throw Error('Scene flame emitter is absent');
  emitterPose={position:emitter.object.position.toArray(),rotation:[emitter.object.rotation.x,emitter.object.rotation.y,emitter.object.rotation.z],scale:emitter.object.scale.toArray()};
  const operations={read,
   async setPrompt(value){if(typeof value!=='string'||!value.trim())throw Error('Enter a prompt to burn');if(closed)throw Error('Material study is closed');runtime.setSimulationPaused(true);await activate();pulse=0;setFeed(false);app.setBurnable(asset.id,false);await settle();kiln.setPrompt(value);app.setBurnable(asset.id,true);await settle();applyGlow();host.scene.refreshPresentation(asset);record({kind:'kiln.material.prompt',effective:read()});return read();},
   setGlow(value){assertOpen();if(!Number.isFinite(value)||value<0)throw Error('Invalid incineration glow');if(kiln.read().appearance==='incineration')app.setBurnAppearance(asset.id,{glow:value});glow=value;session.redraw();sync();record({kind:'kiln.material.glow',effective:read()});return read();},
   setBloom(value){assertOpen();bloom.set(value);sync();record({kind:'kiln.material.bloom',effective:read()});return read();},
   setAppearance(value){assertOpen();if(!['crust','incineration'].includes(value))throw Error('Unknown kiln appearance');app.setBurnAppearance(asset.id,{profile:value,glow});kiln.setAppearance(value);session.redraw();sync();record({kind:'kiln.material.appearance',effective:read()});return read();},
   setIgnition(value){assertOpen();if(!['lettering','below'].includes(value))throw Error('Unknown ignition placement');mode=value;sync();return read();},
   async ignite(){if(closed)throw Error('Material study is closed');await activate();const center=kiln.text.position.toArray();
    const position=[center[0],mode==='below'?center[1]-.4:center[1],mode==='below'?center[2]:center[2]-.1];
    host.scene.setTransform(emitter.id,{position,rotation:mode==='below'?[0,0,0]:[Math.PI/2,0,0],scale:emitterPose.scale});
    ignitionStart=app.burningState(asset.id).state?.fields?.[0]?.referenceSeconds??0;pulse=3;setFeed(true);runtime.setSimulationPaused(false);sync();record({kind:'kiln.material.ignite',effective:read()});return read();},
   stopHeating(){assertOpen();pulse=0;setFeed(false);sync();return read();},reset,
   setPaused(value){assertOpen();if(typeof value!=='boolean')throw Error('Pause must be Boolean');runtime.setSimulationPaused(value);return read();},
   frame(){assertOpen();host.scene.select(asset.id);return session.setView({position:[0,.1,4.5],target:[0,0,0]});},
  };
  stop=session.onFrame(({deltaSeconds})=>{const kelvin=Number(doc.getElementById('volume-physical-kelvin-per-heat')?.value??1600);if(kelvin!==lastKelvin){lastKelvin=kelvin;app.setBurnAppearance(asset.id,{kelvinPerHeat:kelvin});}if(pulse>0){const state=app.burningState(asset.id);pulse=state.status==='resident'?Math.max(0,3-((state.state.fields[0].referenceSeconds??0)-ignitionStart)):0;if(!pulse){setFeed(false);sync();}}});operations.frame();
  return {read,operations,mount({root,document,invoke}){
   const field=document.createElement('textarea');field.rows=3;field.value=kiln.read().prompt;field.setAttribute('aria-label','Material study prompt');field.style.cssText='width:100%;box-sizing:border-box;background:#202327;color:#eee;padding:10px;border:1px solid #42464c;border-radius:6px;';
   field.onchange=()=>invoke('setPrompt',field.value).catch(error=>status.textContent=error.message);
   const label=document.createElement('label');label.textContent='Ignition';const select=document.createElement('select');
   for(const [value,text]of [['lettering','At the lettering'],['below','From below']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.onchange=()=>invoke('setIgnition',select.value);label.append(select);
   const actions=document.createElement('div');actions.className='flame-basin-actions';for(const [text,op]of [['Ignite','ignite'],['Stop heating','stopHeating'],['Reset','reset']]){const button=document.createElement('button');button.className='btn';button.textContent=text;button.onclick=()=>invoke(op).catch(error=>status.textContent=error.message);actions.append(button);}
   const appearanceLabel=document.createElement('label');appearanceLabel.textContent='Surface';const appearance=document.createElement('select');for(const [value,text]of [['incineration','Incineration'],['crust','Original crust']]){const option=document.createElement('option');option.value=value;option.textContent=text;appearance.append(option);}appearance.value=kiln.read().appearance;appearance.onchange=()=>invoke('setAppearance',appearance.value).catch(error=>status.textContent=error.message);appearanceLabel.append(appearance);
   const bloomLabel=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=bloom.read().settings.enabled;enabled.onchange=()=>invoke('setBloom',{enabled:enabled.checked});bloomLabel.append(enabled,document.createTextNode(' Bloom'));
   const tuning=document.createElement('div'),fields=[];for(const [title,value,step,op,key,max]of [['Thermal emission',glow,1,'setGlow',null,null],['Bloom strength',bloom.read().settings.strength,.01,'setBloom','strength',null],['Bloom spread',bloom.read().settings.radius,.01,'setBloom','radius',1]]){
    const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=title+' ';input.type='number';input.min='0';if(max!==null)input.max=String(max);input.step='any';input.value=String(value);input.className='transform-input';input.setAttribute('aria-label',title);input.addEventListener('input',()=>{if(input.value.trim()&&Number.isFinite(Number(input.value)))invoke(op,key?{[key]:Number(input.value)}:Number(input.value)).catch(error=>status.textContent=error.message);});row.append(grip,input);tuning.append(row);host.controls.installNumberDrag({input,grip,step});fields.push({input,key});
   }
   syncFields=()=>{const state=bloom.read().settings;enabled.checked=state.enabled;appearance.value=kiln.read().appearance;select.value=mode;for(const {input,key}of fields)if(document.activeElement!==input||input.readOnly)input.value=String(key?state[key]:glow);};
   status=document.createElement('p');status.setAttribute('role','status');const help=document.createElement('p');help.textContent='Select the lettering to edit its combustion and obstacle properties. Ignition gives a brief heat pulse; retained heat and fuel drive the burn.';root.append(field,label,appearanceLabel,actions,bloomLabel,tuning,status,help);sync();
  },dispose};
 }catch(error){await dispose();throw error;}
}};
