import {createStageMold,stageWordMold,STAGE_MOLD_SOURCE} from '../stage-mold.mjs';

export default {
 id:'stage-pour',title:'Stage word · pour study',
 async create({host,inputs,record}){
  const document=host.controls.document,app=document.defaultView,water=app.kaminosWaterSources;
  if(!water||!app.kaminosSceneAuthoring)throw Error('Open the authored scene before the pour study');
  if(water.read().sources.length)throw Error('The pour study needs a scene without existing water sources; save your scene and open an empty one first.');
  let session,asset,emitterId,recipe,status,wordField,disposed=false;
  const read=()=>({label:recipe?.label,moldId:asset?.id,emitterId,water:water.read(),stage:'liquid mold study; solidification and ignition are not coupled'});
  async function reset(){water.reset();return read();}
  async function makeWord(label){
   const next=stageWordMold(document,label); // Validate before retiring the previous setup.
   water.reset();if(emitterId){app.removeSceneObject(emitterId);emitterId=null;}
   await session?.dispose();session=await host.scene.open();recipe=next;
   const root=createStageMold(recipe);root.position.y=.25;
   asset=await session.attach(root,{owned:true,metadata:{type:'pbr',source:STAGE_MOLD_SOURCE,label:root.name,stageMold:recipe}});
   try{
    emitterId=await app.kaminosSceneAuthoring.addWaterEmitter();
    const width=recipe.rows[0].length*recipe.pitch,depth=recipe.rows.length*recipe.pitch;
    app.kaminosSetSceneObjectTransform(emitterId,{position:[-width/2+.5,1.0,(73-48)*recipe.pitch],rotation:[Math.PI/2,0,0]});
    app.renameSceneObject(emitterId,'Pour into '+label);
    water.edit(emitterId,{baseRadius:.075,strength:.25,volumeRate:.008});
    water.editSimulation({particleCount:8000,waterSampling:{spacing:.05/Math.cbrt(3),container:null,worldBounds:{min:[-width/2-.3,0,-depth/2-.3],max:[width/2+.3,1.3,depth/2+.3]}}});
    app.selectSceneObject(asset.id);
   }catch(error){if(emitterId)app.removeSceneObject(emitterId);emitterId=null;await session.dispose();throw error;}
   if(wordField)wordField.value=label;
   record({kind:'stage-pour.mold',phase:'applied',effective:{label,recipe,emitterId,moldId:asset.id}});
   return read();
  }
  const frame=()=>{
   const width=recipe.rows[0].length*recipe.pitch;
   return session.setView({position:[.1,width*1.5,width*1.05],target:[0,.25,0],fov:38});
  };
  await makeWord(inputs.word??'DENOISER');frame();
  return {
   read,
   operations:{makeWord,frame,reset,
    async pour(){if(disposed)throw Error('Pour study is closed');const result=await water.release(emitterId);record({kind:'stage-pour.release',phase:'applied',effective:result});return read();},
    stopPour(){water.edit(emitterId,{volumeRate:0});return read();},
    selectEmitter(){app.selectSceneObject(emitterId);return read();},
   },
   mount({root,invoke}){
    const heading=document.createElement('h3');heading.textContent='Cast a stage word';
    const label=document.createElement('label');label.textContent='Word ';
    wordField=document.createElement('input');wordField.value=recipe.label;wordField.type='text';wordField.setAttribute('aria-label','Stage word');wordField.className='transform-input';label.append(wordField);
    status=document.createElement('p');status.setAttribute('role','status');
    const call=(name,value)=>invoke(name,value).then(()=>{status.textContent='';}).catch(error=>{status.textContent=error.message;});
    wordField.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();call('makeWord',wordField.value);}});
    const buttons=document.createElement('div');buttons.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin:12px 0';
    for(const [text,name]of [['Build word','makeWord'],['Pour','pour'],['Stop pouring','stopPour'],['Reset water','reset'],['Edit pour','selectEmitter'],['Frame mold','frame']]){
     const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.addEventListener('click',()=>call(name,name==='makeWord'?wordField.value:undefined));buttons.append(b);
    }
    const help=document.createElement('p');help.textContent='Pour into the runner and watch the letters fill. Select the emitter to change its flow and placement in Properties. Reset water preserves those edits. Save retains the mold and source; the liquid restarts when released.';
    const scope=document.createElement('p');scope.textContent='First study: liquid contact. Casting into a burnable solid is the next join.';
    root.append(heading,label,buttons,help,scope,status);
   },
   async dispose(){disposed=true;water.reset();if(emitterId)app.removeSceneObject(emitterId);await session?.dispose();},
  };
 },
};
