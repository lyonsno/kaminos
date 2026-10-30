import {ensureKilnSceneDomain} from '../inference-kiln-scene.mjs';

export default {id:'inference-kiln-material',title:'Inference Kiln · material',async create({host,inputs={},record}){
 const doc=host.controls.document,app=doc.defaultView.kaminosSceneAuthoring,session=await host.scene.open();
 let closed=false,sync=()=>{};
 const target=()=>{const id=doc.defaultView.kaminosSelection?.read().activeId;return host.scene.objects().find(row=>row.id===id);};
 const lettering=()=>{const row=target();if(!row?.object?.userData?.kaminosPromptRelief)throw Error('Select prompt lettering in the scene');return row;};
 const active=()=>{if(closed)throw Error('Material tool is closed');};
 const read=()=>{const row=target();return {objectId:row?.id??null,prompt:row?.object?.userData?.kaminosPromptRelief?.prompt??null,burnerSeconds:row?.object?.userData?.kaminosPromptRelief?.burnerSeconds??5,burnAuthority:'scene-owned-thermal',combustion:row?app.burningState(row.id):null,bloom:doc.defaultView.kaminosSceneBloom?.read(),scope:'authored-scene-material-tool'};};
 const operations={read,
  setBurnerSeconds(value){active();const row=lettering();app.setPrompt(row.id,row.object.userData.kaminosPromptRelief.prompt,{burnerSeconds:value});record({kind:'kiln.burner.duration',target:row.id,seconds:value});sync();return read();},
  async saveForGenerate(){active();const selected=target(),prompts=host.scene.objects().filter(row=>row.object?.userData?.kaminosPromptRelief),row=selected?.object?.userData?.kaminosPromptRelief?selected:prompts.length===1?prompts[0]:null;
   if(!row)throw Error('Select the prompt lettering to use in Generate');
   const result=await doc.defaultView.saveScene({result:true});const recipe=await doc.defaultView.kaminosInferenceKiln.useSaved(result,row.id);record({kind:'kiln.generate.select',sceneFile:recipe.selection.sceneFile,promptObjectId:row.id});return recipe.selection;
  },
  async addPrompt(value=inputs.prompt??'INFERENCE KILN EATS YOUR MOM'){active();const id=await app.addPrompt(value);record({kind:'kiln.prompt.add',target:id});sync();return read();},
  setPrompt(value){active();const row=lettering();app.setPrompt(row.id,value);record({kind:'kiln.prompt.edit',target:row.id,effective:read()});sync();return read();},
  setAppearance(profile){active();const row=target();if(!row)throw Error('Select a burnable mesh');app.setBurnAppearance(row.id,{profile});sync();return read();},
  setGlow(glow){active();const row=target();if(!row)throw Error('Select a burnable mesh');app.setBurnAppearance(row.id,{glow});sync();return read();},
  setBloom(value){active();doc.defaultView.kaminosSceneBloom.set(value);return read();},
  frame(){active();const row=target();if(!row)throw Error('Select a scene object');host.scene.frame([row.object]);return read();},
 };
 try{
  // The launcher explicitly asks for initial content. Reopening a saved scene
  // or choosing the tool in an existing workspace does not rebuild its setup.
  if(inputs.prompt!==undefined&&(typeof inputs.prompt!=='string'||!inputs.prompt.trim()))throw Error('Enter a prompt to burn');
  const savedScene=new URLSearchParams(doc.defaultView.location?.search??'').has('scene')||new URLSearchParams((doc.defaultView.location?.hash??'').slice(1)).has('scene');
  if(inputs.setup===true&&!savedScene&&!host.scene.objects().some(row=>row.object?.userData?.kaminosPromptRelief)){
   const fresh=host.scene.objects().every(row=>['flame-emitter','simulation-domain'].includes(row.type));
   await host.volume.ready;
   const flame=await host.flame.open();if(!flame.read().active)throw Error('Kiln flame runtime did not initialize');await ensureKilnSceneDomain(host,flame);
   if(host.scene.objects().every(row=>['flame-emitter','simulation-domain'].includes(row.type))){
    for(const [label,parameters,position]of [['Kiln floor',{width:8,height:.02,depth:8},[0,-.85,0]],['Kiln backdrop',{width:8,height:6,depth:.05},[0,1,-2.5]]]){const id=app.addMesh('box',parameters);doc.defaultView.renameSceneObject(id,label);host.scene.setTransform(id,{position});app.setMaterial(id,{color:'#181a1e',roughness:.97,metalness:0});}
   }
   await operations.addPrompt();if(fresh){const row=target();if(row)host.scene.frame([row.object]);}
  }
  const stop=session.onFrame(()=>sync());
  return {read,operations,mount({root,document,invoke}){
   const field=document.createElement('textarea');field.rows=3;field.setAttribute('aria-label','Sample prompt');field.style.cssText='width:100%;box-sizing:border-box;background:#202327;color:#eee;padding:10px;border:1px solid #42464c;border-radius:6px;';
   const status=document.createElement('p');status.setAttribute('role','status');
   const fail=error=>{status.textContent=error.message;sync(true);};
   field.addEventListener('change',()=>{if(field.dataset.target!==target()?.id){sync(true);return;}invoke('setPrompt',field.value).catch(fail);});
   const add=document.createElement('button');add.className='btn';add.textContent='Add lettering';add.onclick=()=>invoke('addPrompt',field.value||inputs.prompt).catch(fail);
   const help=document.createElement('p');help.textContent='Select a mesh to tune its Combustion properties in the inspector. Position and enable the flame source using its native controls. Shared playback runs the simulation. Bloom is in Rendering.';
   sync=(force=false)=>{const row=target(),value=row?.object?.userData?.kaminosPromptRelief?.prompt,changed=field.dataset.target!==(row?.id??'');field.disabled=!value;if(force||changed||document.activeElement!==field){field.value=value??inputs.prompt??'';field.dataset.target=row?.id??'';}};
   const durationLabel=document.createElement('label');durationLabel.textContent='Burner duration (seconds) ';const duration=document.createElement('input');duration.type='number';duration.min='0';duration.step='0.5';duration.setAttribute('aria-label','Burner duration in seconds');durationLabel.append(duration);duration.onchange=()=>{if(duration.value!==''&&duration.validity.valid)invoke('setBurnerSeconds',Number(duration.value)).catch(fail);};const syncPrompt=sync;sync=(force=false)=>{syncPrompt(force);duration.disabled=!target()?.object?.userData?.kaminosPromptRelief;if(force||document.activeElement!==duration)duration.value=String(read().burnerSeconds);};
   const save=document.createElement('button');save.className='btn';save.textContent='Save kiln for Generate';save.onclick=()=>invoke('saveForGenerate').then(result=>{status.textContent=`Generate now uses ${result.sceneFile}`;}).catch(fail);
   help.textContent='Edit the kiln scene, camera, flame and material here. This is sample text for designing the burn; Generate burns your actual image prompt. Bloom is under Rendering → Flame. Save kiln for Generate keeps this scene and its settings.';
   root.append(field,add,durationLabel,save,help,status);sync();
  },async dispose(){if(closed)return;closed=true;stop();await session.dispose();}};
 }catch(error){await session.dispose();throw error;}
}};
