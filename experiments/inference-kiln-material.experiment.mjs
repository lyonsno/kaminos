import {ensureKilnSceneDomain} from '../inference-kiln-scene.mjs';

export default {id:'inference-kiln-material',title:'Inference Kiln · material',async create({host,inputs={},record}){
 const doc=host.controls.document,app=doc.defaultView.kaminosSceneAuthoring,session=await host.scene.open();
 let closed=false,sync=()=>{};
 const target=()=>{const id=doc.defaultView.kaminosSelection?.read().activeId;return host.scene.objects().find(row=>row.id===id);};
 const lettering=()=>{const row=target();if(!row?.object?.userData?.kaminosPromptRelief)throw Error('Select prompt lettering in the scene');return row;};
 const active=()=>{if(closed)throw Error('Material tool is closed');};
 const read=()=>{const row=target();return {objectId:row?.id??null,prompt:row?.object?.userData?.kaminosPromptRelief?.prompt??null,burnAuthority:'scene-owned-thermal',combustion:row?app.burningState(row.id):null,bloom:doc.defaultView.kaminosSceneBloom?.read(),scope:'authored-scene-material-tool'};};
 const operations={read,
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
   const field=document.createElement('textarea');field.rows=3;field.setAttribute('aria-label','Prompt lettering');field.style.cssText='width:100%;box-sizing:border-box;background:#202327;color:#eee;padding:10px;border:1px solid #42464c;border-radius:6px;';
   const status=document.createElement('p');status.setAttribute('role','status');
   const fail=error=>{status.textContent=error.message;sync(true);};
   field.addEventListener('change',()=>{if(field.dataset.target!==target()?.id){sync(true);return;}invoke('setPrompt',field.value).catch(fail);});
   const add=document.createElement('button');add.className='btn';add.textContent='Add lettering';add.onclick=()=>invoke('addPrompt',field.value||inputs.prompt).catch(fail);
   const help=document.createElement('p');help.textContent='Select a mesh to tune its Combustion properties in the inspector. Position and enable the flame source using its native controls. Shared playback runs the simulation. Bloom is in Rendering.';
   sync=(force=false)=>{const row=target(),value=row?.object?.userData?.kaminosPromptRelief?.prompt,changed=field.dataset.target!==(row?.id??'');field.disabled=!value;if(force||changed||document.activeElement!==field){field.value=value??inputs.prompt??'';field.dataset.target=row?.id??'';}};
   root.append(field,add,help,status);sync();
  },async dispose(){if(closed)return;closed=true;stop();await session.dispose();}};
 }catch(error){await session.dispose();throw error;}
}};
