import {createStageMold,stageWordMold,checkedStageMold,STAGE_MOLD_SOURCE} from '../stage-mold.mjs';
import {installSceneControlHistory} from '../scene-control-history.mjs';

export default {
 id:'stage-pour',title:'Stage word · pour study',
 async create({host,inputs,record}){
  const document=host.controls.document,app=document.defaultView,water=app.kaminosWaterSources;
  if(!water||!app.kaminosSceneAuthoring)throw Error('Open the authored scene before the pour study');
  let session,asset,emitterId,recipe,status,wordField,flowHistory,refreshControls=()=>{},cleanupControls=()=>{},disposed=false,disposal,borrowed=false,pending=Promise.resolve();
  // Mounted controls and agent operations share this boundary, including close.
  const serial=action=>value=>{
   if(disposed)return Promise.reject(Error('Pour study is closed'));
   const task=pending.then(()=>{if(disposed)throw Error('Pour study is closed');return action(value);});
   pending=task.catch(()=>{});return task;
  };
  const read=()=>({label:asset?.root.userData.kaminosStageMold?.label??recipe?.label,moldId:asset?.id,emitterId,water:water.read(),stage:'liquid contact study; ignition is not coupled'});
  async function reset(){await water.commitEdits();water.edit(emitterId,{emissionEnabled:false});water.reset();return read();}
  async function retire(replace=false){
   const oldSession=session,oldAsset=asset,oldEmitter=emitterId,wasBorrowed=borrowed;
   session=asset=emitterId=null;borrowed=false;
   if(replace||!wasBorrowed){
    if(water.read().sources.every(r=>r.id===oldEmitter))water.reset();
    if(oldEmitter)app.removeSceneObject(oldEmitter);
    if(replace&&wasBorrowed&&oldAsset)app.removeSceneObject(oldAsset.id);
   }
   await oldSession?.dispose();
  }
  async function makeWord(label){
   if(asset){
    await water.commitEdits();
    const runtime=water.read().runtime;
    const flowing=app.kaminosLocalLiquidState().emitters.find(row=>row.id===emitterId)?.localLiquidEmitter.emissionEnabled;
    if(runtime&&(runtime.population?.active!==0||flowing))throw Error('Reset water before changing the mold. Its source and placement will be kept.');
    recipe=app.kaminosSceneAuthoring.setStageWord(asset.id,label);
    record({kind:'stage-pour.mold',phase:'applied',effective:{label,recipe,emitterId,moldId:asset.id}});
    return read();
   }
   const next=stageWordMold(document,label);
   if(water.read().sources.some(r=>r.id!==emitterId))throw Error('Build a word in a scene without unrelated water sources.');
   await retire(true);
   const nextSession=await host.scene.open();let nextEmitter,nextAsset;
   try{
    const root=createStageMold(next);root.position.y=.25;
    nextAsset=await nextSession.attach(root,{owned:true,metadata:{type:'pbr',source:STAGE_MOLD_SOURCE,label:root.name,stageMold:next}});
    nextEmitter=await app.kaminosSceneAuthoring.addWaterEmitter();
    const width=next.rows[0].length*next.pitch,depth=next.rows.length*next.pitch;
    app.kaminosSetSceneObjectTransform(nextEmitter,{position:[-width/2+.5,1.0,(73-48)*next.pitch],rotation:[Math.PI/2,0,0]});
    app.renameSceneObject(nextEmitter,'Pour into '+label);
    water.edit(nextEmitter,{baseRadius:.075,strength:.25,volumeRate:.008,emissionEnabled:false});
    water.editSimulation({particleCount:8000,waterSampling:{spacing:.05/Math.cbrt(3),container:null,worldBounds:{min:[-width/2-.3,0,-depth/2-.3],max:[width/2+.3,1.3,depth/2+.3]}}});
    app.selectSceneObject(nextEmitter);
   }catch(error){if(nextEmitter)app.removeSceneObject(nextEmitter);await nextSession.dispose();throw error;}
   session=nextSession;asset=nextAsset;emitterId=nextEmitter;recipe=next;
   if(wordField)wordField.value=label;
   record({kind:'stage-pour.mold',phase:'applied',effective:{label,recipe,emitterId,moldId:asset.id}});
   return read();
  }
  const frame=()=>{
   const width=recipe.rows[0].length*recipe.pitch;
   return session.setView({position:[.1,width*1.5,width*1.05],target:[0,.25,0],fov:38});
  };
  const sources=water.read().sources,molds=host.scene.objects().filter(o=>o.source===STAGE_MOLD_SOURCE);
  if(sources.length){
   if(sources.length!==1||molds.length!==1)throw Error('Open one saved stage mold with its pour emitter, or start in a scene without water sources.');
   recipe=checkedStageMold(molds[0].object.userData.kaminosStageMold);session=await host.scene.open();
   try{asset=await session.attach(molds[0].object,{owned:false});}catch(error){await session.dispose();throw error;}
   emitterId=sources[0].id;borrowed=true;
  }else{await makeWord(inputs.word??'DENOISER');frame();}
  return {
   read,
   operations:{setFlow(value){
    if(disposed)throw Error('Pour study is closed');
    const litres=Number(value);if(value===''||!Number.isFinite(litres)||litres<0)throw Error('Flow must be zero or more litres per second');
    const patch={volumeRate:litres/1000};
    if(flowHistory?.state().pending)app.kaminosSceneEdits.preview(patch);else water.edit(emitterId,patch);
    return read();
   },...Object.fromEntries(Object.entries({makeWord,frame,reset,
    async pour(){
     if(disposed)throw Error('Pour study is closed');
     await water.commitEdits();
     const source=app.kaminosLocalLiquidState().emitters.find(r=>r.id===emitterId);if(!source)throw Error('The pour emitter was removed; build the word again.');
     water.edit(emitterId,{emissionEnabled:true});
     if(water.read().runtime)app.kaminosPauseLocalLiquid(false);else await water.release(emitterId);
     const result=read();record({kind:'stage-pour.release',phase:'applied',effective:result});return result;
    },
    async stopPour(){
     await water.commitEdits();
     water.edit(emitterId,{emissionEnabled:false});return read();
    },
    selectEmitter(){app.selectSceneObject(emitterId);return read();},
   }).map(([name,action])=>[name,serial(action)]))},
   mount({root,invoke}){
    const element=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
    const heading=element('h3','Stage word · pour study');
    const help=element('p','Use the controls beside the spigot and mold. Select either object for placement and deeper properties.');
    status=element('p');status.setAttribute('role','status');
    const spigot=element('section'),mold=element('section');
    spigot.dataset.stageOperating='spigot';mold.dataset.stageOperating='mold';
    spigot.setAttribute('aria-label','Spigot controls');mold.setAttribute('aria-label','Mold controls');
    const source=()=>host.scene.objects().find(row=>row.id===emitterId);
    const sourceRoot=source()?.object;if(!sourceRoot)throw Error('The pour source is absent');
    const sourceStatus=element('p',null,'operating-status'),moldStatus=element('p',null,'operating-status');
    sourceStatus.setAttribute('role','status');moldStatus.setAttribute('role','status');
    const call=(name,value,output=status)=>invoke(name,value).then(()=>{output.textContent='';refreshControls();return true;}).catch(error=>{output.textContent=error.message;return false;});
    const pour=element('button','Pour','btn');pour.type='button';pour.title='Open or close this spigot. Stopping preserves the water already poured.';
    pour.addEventListener('click',()=>call(source()?.localLiquidEmitter.emissionEnabled?'stopPour':'pour',undefined,sourceStatus));
    const top=element('header');top.append(element('span','Spigot','operating-title'),pour);
    const flowLabel=element('label','Flow · L/s'),flow=element('input',null,'transform-input');flow.type='number';flow.min='0';flow.step='.1';flow.setAttribute('aria-label','Spigot flow in litres per second');flowLabel.append(flow);
    spigot.append(top,flowLabel,element('p','Drag the value · click to type','operating-hint'),sourceStatus);
    const moldHeader=element('header');moldHeader.append(element('span','Mold','operating-title'));
    wordField=element('input',null,'transform-input');wordField.type='text';wordField.value=read().label;wordField.setAttribute('aria-label','Mold word');wordField.title='Edit the lettering; press Enter to rebuild its channels. Placement, material and the spigot stay attached. Reset water first if it has been released.';
    wordField.addEventListener('keydown',async e=>{
     if(e.key==='Enter'){e.preventDefault();if(await call('makeWord',wordField.value,moldStatus))wordField.blur();}
     if(e.key==='Escape'){e.preventDefault();wordField.value=read().label;wordField.blur();moldStatus.textContent='';}
    });
    mold.append(moldHeader,wordField,element('p','Enter to change · Esc to cancel','operating-hint'),moldStatus);
    const resetButton=element('button','Reset water','btn');resetButton.type='button';resetButton.title='Stop pouring and clear all water in this study. Keep the mold, spigot placement and source settings.';resetButton.addEventListener('click',()=>call('reset'));
    root.append(heading,help,resetButton,status);
    refreshControls=()=>{
     const settings=source()?.localLiquidEmitter;if(!settings)return;
     pour.textContent=settings.emissionEnabled?'Stop':'Pour';pour.setAttribute('aria-pressed',String(!!settings.emissionEnabled));
     if(document.activeElement!==flow&&!flowHistory?.state().pending)flow.value=String(settings.volumeRate*1000);
     if(document.activeElement!==wordField)wordField.value=read().label;
    };
    const mounts=[];let drag,unsubscribe;
    cleanupControls=()=>{unsubscribe?.();drag?.dispose();flowHistory?.dispose();mounts.forEach(m=>m.dispose());};
    mounts.push(host.controls.mountOperating({asset:{id:emitterId,root:sourceRoot},node:spigot,side:'left',anchor:[0,0,0]}));
    mounts.push(host.controls.mountOperating({asset,node:mold,side:'right',anchor:[recipe.rows[0].length*recipe.pitch/2,recipe.wallHeight,0]}));
    const fail=error=>{sourceStatus.textContent=error.message;};
    flowHistory=installSceneControlHistory({controls:[flow],edits:app.kaminosSceneEdits,id:()=>water.editTarget(emitterId),label:'Change spigot flow',onError:fail});
    drag=host.controls.installNumberDrag({input:flow,step:.1});
    flow.addEventListener('input',()=>{void call('setFlow',flow.value,sourceStatus);});
    flow.addEventListener('blur',()=>queueMicrotask(refreshControls));
    unsubscribe=water.subscribeEdits(refreshControls);refreshControls();
   },
   dispose(){if(!disposed){cleanupControls();disposed=true;disposal=pending.then(()=>retire());}return disposal;},
  };
 },
};
