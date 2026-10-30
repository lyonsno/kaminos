import {createStageMold,stageWordMold,checkedStageMold,STAGE_MOLD_SOURCE} from '../stage-mold.mjs';

export default {
 id:'stage-pour',title:'Stage word · pour study',
 async create({host,inputs,record}){
  const document=host.controls.document,app=document.defaultView,water=app.kaminosWaterSources;
  if(!water||!app.kaminosSceneAuthoring)throw Error('Open the authored scene before the pour study');
  let session,asset,emitterId,recipe,status,wordField,disposed=false,disposal,borrowed=false,pending=Promise.resolve();
  // Mounted controls and agent operations share this boundary, including close.
  const serial=action=>value=>{
   if(disposed)return Promise.reject(Error('Pour study is closed'));
   const task=pending.then(()=>{if(disposed)throw Error('Pour study is closed');return action(value);});
   pending=task.catch(()=>{});return task;
  };
  const read=()=>({label:recipe?.label,moldId:asset?.id,emitterId,water:water.read(),stage:'liquid contact study; ignition is not coupled'});
  async function reset(){await water.commitEdits();water.reset();return read();}
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
   operations:Object.fromEntries(Object.entries({makeWord,frame,reset,
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
   }).map(([name,action])=>[name,serial(action)])),
   mount({root,invoke}){
    const heading=document.createElement('h3');heading.textContent='Pour a stage word';
    const label=document.createElement('label');label.textContent='Word ';
    wordField=document.createElement('input');wordField.value=recipe.label;wordField.type='text';wordField.setAttribute('aria-label','Stage word');wordField.className='transform-input';label.append(wordField);
    status=document.createElement('p');status.setAttribute('role','status');
    const call=(name,value)=>invoke(name,value).then(()=>{status.textContent='';}).catch(error=>{status.textContent=error.message;});
    wordField.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();call('makeWord',wordField.value);}});
    const buttons=document.createElement('div');buttons.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin:12px 0';
    for(const [text,name]of [['Build word','makeWord'],['Pour','pour'],['Reset water','reset']]){
     const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.addEventListener('click',()=>call(name,name==='makeWord'?wordField.value:undefined));buttons.append(b);
    }
    root.append(heading,label,buttons,status);
   },
   dispose(){if(!disposed){disposed=true;disposal=pending.then(()=>retire());}return disposal;},
  };
 },
};
