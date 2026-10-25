import blendDefinition from './flame-blend.experiment.mjs';
import {createInferenceFlame,INFERENCE_STAGES} from '../inference-flame.mjs';
import {inferenceEvents} from '../inference-events.mjs';
import {inferenceFlameDemo} from '../inference-flame-demo.mjs';
const names={weights:'Weights',text:'Prompt',denoise:'Denoise',decode:'Decode',saving:'Save',complete:'Finished'};
const kinds={state:'State · hold B',ramp:'Transition · A → B',pulse:'Effect · pulse to B'};
export default {id:'inference-flame',title:'Flame · inference & replay',async create(context){
 const {host,inputs,record}=context;
 let arrangement=inputs.arrangement;
 if(inputs.arrangementUrl){
  const result=await fetch(inputs.arrangementUrl);
  if(!result.ok)throw Error('Arrangement HTTP '+result.status);
  arrangement=await result.json();
 }
 const initialBlend=inputs.blend??arrangement?.score?.objects?.[0]?.recipe??Object.values(arrangement?.score?.stages??{})[0];
 const blend=await blendDefinition.create({...context,inputs:{}}),flame=await host.flame.open(),scene=await host.scene.open();
 let sync=()=>{},alive=true;
 const response=createInferenceFlame({flame,source:inferenceEvents,onFrame:scene.onFrame,changed:()=>sync()});
 response.operations.load(inferenceFlameDemo());
 try{if(arrangement)response.operations.restore(arrangement);if(initialBlend)blend.operations.restore(initialBlend);}catch(e){response.dispose();await blend.dispose();await scene.dispose();throw e;}
 const operations={...Object.fromEntries(Object.entries(blend.operations).map(([key,fn])=>[key,(...args)=>{response.operations.pause();return fn(...args);}]))};
 for(const [name,fn] of Object.entries(response.operations))operations['response.'+name]=(...args)=>{
  blend.operations.pause();const result=fn.apply(response.operations,args),state=response.read({includeScore:false});
  record({kind:'inference-flame.'+name,phase:'applied',effective:{position:state.position,live:state.live}});return result;
 };
 operations['response.assignBlend']=stage=>operations['response.assign']({stage,recipe:blend.operations.export()});
 operations['response.saveBlendObject']=value=>operations['response.saveObject']({...value,recipe:blend.operations.export()});
 operations['response.updateBlendObject']=value=>operations['response.updateObject']({...value,recipe:blend.operations.export()});
 operations['response.editObject']=id=>{
  response.operations.pause();const object=response.read().score.objects?.find(item=>item.id===id);
  if(!object)throw Error('Choose a saved state or effect');return blend.operations.restore(object.recipe);
 };
 operations['response.editStage']=stage=>{
  response.operations.pause();const score=response.read().score,layer=score.stacks?.[stage]?.[0];
  const recipe=score.objects?.find(item=>item.id===layer?.objectId)?.recipe??score.stages[stage];
  if(!recipe)throw Error('Add a state or effect to this phase first');return blend.operations.restore(recipe);
 };
 operations['response.capturePeak']=values=>operations['response.captureFlare']({...values,fields:blend.read().fields});
 operations['response.demo']=()=>operations['response.load'](inferenceFlameDemo());
 return {read:()=>({blend:blend.read(),response:response.read()}),operations,async mount({root,document,invoke}){
  const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
  const panel=el('section');panel.className='inference-flame-panel';
  const style=el('style');style.textContent=`
   .inference-flame-panel{display:grid;gap:9px;font-size:12px}
   .inference-flame-panel p{margin:0;line-height:1.4;color:#bbb}
   .inference-flame-panel .actions{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
   .inference-flame-panel button,.inference-flame-panel select,.inference-flame-panel input{font:inherit}
   .inference-flame-panel input[type=range]{width:100%}
   .inference-flame-panel canvas{width:100%;max-height:100px;object-fit:contain;background:#161616}
   .inference-flame-panel [hidden]{display:none!important}
   .inference-flame-panel input[type=number]{width:65px}
   .inference-flame-panel input[type=text]{min-width:0;width:100%;box-sizing:border-box}
   .inference-flame-panel details{border-top:1px solid #ffffff25;padding-top:8px}
   .inference-flame-panel summary{cursor:pointer;padding:5px 0}
   .inference-flame-panel .object-list,.inference-flame-panel .phase-stack{display:grid;gap:6px}
   .inference-flame-panel .object-list{max-height:270px;overflow:auto}
   .inference-flame-panel .object-card,.inference-flame-panel .layer-card{display:grid;gap:6px;padding:8px;border:1px solid #ffffff25;border-radius:6px;min-width:0}
   .inference-flame-panel .object-card[data-selected=true]{border-color:#dba66b;background:#dba66b12}
   .inference-flame-panel .object-card strong,.inference-flame-panel .layer-card strong{overflow-wrap:anywhere}
   .inference-flame-panel .object-summary{color:#aaa}
   .inference-flame-panel .library-body{display:grid;gap:8px;padding-top:5px}
  `;
  root.append(style,panel);const status=el('p');status.setAttribute('role','status');let message='',selectedObject=null;
  const run=async(name,value)=>{message='';try{return await invoke(name,value);}catch(error){message=error.message;}finally{sync();}};
  const btn=(label,name,value)=>{const button=el('button',label);button.className='btn';button.type='button';if(name)button.onclick=()=>run(name,value);return button;};
  const actions=(...nodes)=>{const row=el('div');row.className='actions';row.append(...nodes);return row;};
  const number=(label,value,change)=>{const input=el('input');input.type='number';input.min='0';input.step='any';input.value=String(value);input.setAttribute('aria-label',label);input.onchange=()=>change(Number(input.value));return input;};
  panel.append(el('strong','Give the generation a flame'),status);
  const play=btn('Replay','response.play'),pause=btn('Pause','response.pause');
  panel.append(actions(play,pause,btn('Follow next ImageGen','response.follow')));
  const scrub=el('input');scrub.type='range';scrub.min=0;scrub.max=15500;scrub.step='any';scrub.setAttribute('aria-label','Inference replay position');scrub.oninput=()=>run('response.seek',Number(scrub.value));panel.append(scrub);
  const position=el('output');panel.append(position);
  const preview=el('canvas');preview.width=32;preview.height=32;preview.hidden=true;panel.append(preview);const caption=el('p');panel.append(caption);

  const files=actions(btn('Latest ImageGen run','response.latest'),btn('Demo recording','response.demo'));
  const save=btn('Save arrangement…');save.onclick=async()=>{
   try{const data=await invoke('response.export'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),link=el('a');link.href=url;link.download='inference-flame.json';link.click();URL.revokeObjectURL(url);message='Arrangement saved with its states, effects and current recording.';}catch(error){message=error.message;}sync();
  };
  const file=el('input');file.type='file';file.accept='.json';file.hidden=true;file.onchange=async()=>{
   try{if(file.files[0]){await invoke('response.restore',JSON.parse(await file.files[0].text()));selectedObject=null;message='Arrangement opened.';}}catch(error){message=error.message;}finally{file.value='';sync();}
  };
  const open=btn('Open arrangement…');open.onclick=()=>file.click();files.append(save,open,file);panel.append(files);

  const stageLabel=el('label','Phase '),stage=el('select');stage.setAttribute('aria-label','Inference stage');
  for(const id of INFERENCE_STAGES){const option=el('option',names[id]);option.value=id;stage.append(option);}stage.value='denoise';stageLabel.append(stage);panel.append(stageLabel);
  const stack=el('div');stack.className='phase-stack';stack.setAttribute('aria-label','Phase response stack');panel.append(stack);
  const stackHint=el('p','Layers play together. Lower layers take precedence for any shared parameters.');panel.append(stackHint);
  const addSelected=btn('Add selected to phase');addSelected.onclick=()=>run('response.addLayer',{stage:stage.value,objectId:selectedObject});
  const clearPhase=btn('Clear phase');clearPhase.onclick=()=>run('response.clearStage',stage.value);panel.append(actions(addSelected,clearPhase));
  const scaleLabel=el('label','Authored duration × '),scale=number('Authored duration multiplier',1,value=>run('response.timeScale',value));scaleLabel.append(scale);panel.append(scaleLabel);
  panel.append(el('p','Fit phase uses its recorded span. Authored seconds keeps the saved duration; Finished gets its full transition. Live phases with unknown length use authored seconds. Fit ×1 fills the phase; longer settings may be interrupted by its successor.'));

  const library=el('details');library.open=true;library.append(el('summary','Saved states & effects'));
  const libraryBody=el('div');libraryBody.className='library-body';library.append(libraryBody);
  const objects=el('div');objects.className='object-list';objects.setAttribute('aria-label','Saved flame objects');libraryBody.append(objects);
  const kind=el('select');kind.setAttribute('aria-label','Saved flame object kind');
  for(const [value,label] of Object.entries(kinds)){const option=el('option',label);option.value=value;kind.append(option);}kind.value='ramp';
  const objectName=el('input');objectName.type='text';objectName.placeholder='Name optional';objectName.setAttribute('aria-label','Flame object name');
  const saveObject=btn('Save new from A/B');saveObject.onclick=async()=>{
   const result=await run('response.saveBlendObject',{label:objectName.value.trim()||undefined,kind:kind.value});
   if(result){selectedObject=result.score?.objects?.at(-1)?.id??response.read().score.objects.at(-1)?.id;objectName.value='';invalidate();}
  };
  const updateObject=btn('Update selected from A/B');updateObject.onclick=()=>run('response.updateBlendObject',{id:selectedObject,kind:kind.value,...(objectName.value.trim()?{label:objectName.value.trim()}:{})});
  libraryBody.append(kind,objectName,actions(saveObject,updateObject));
  libraryBody.append(el('p','State holds B. Transition travels from A to B. Effect pulses toward B, then settles onto the other layers. Author the endpoints below.'));
  panel.append(library);
  const author=el('details');author.open=!arrangement;author.append(el('summary','Author A/B looks in Properties'));const authorRoot=el('div');author.append(authorRoot);panel.append(author);
  await blend.mount({root:authorRoot,document,invoke});

  const flare=el('details'),flareTitle=el('summary','Flare when a preview appears');flare.append(flareTitle);
  flare.append(el('p','Tune a peak in Properties, then capture it. Uses the checked A/B parameters; settles back onto the continuing phase response.'));
  const attack=number('Preview flare attack seconds',.12,()=>{}),settle=number('Preview flare settle seconds',.9,()=>{});
  const attackLabel=el('label','Attack seconds '),settleLabel=el('label','Settle seconds ');attackLabel.append(attack);settleLabel.append(settle);
  const peak=btn('Capture current flame as peak');peak.onclick=()=>run('response.capturePeak',{attackMs:Number(attack.value)*1000,settleMs:Number(settle.value)*1000});
  flare.append(attackLabel,settleLabel,peak,btn('Remove flare','response.clearFlare'));panel.append(flare);
  panel.append(el('p','Replay repeats inference events, not the evolved fluid. Follow records ImageGen stages and approximate latent previews.'));

  let lastPreview=null,lastRevision=null,lastStage=null,lastSelection=null,cachedScore=null;
  const invalidate=()=>{lastRevision=null;sync();};
  stage.onchange=invalidate;
  const editObject=async object=>{selectedObject=object.id;kind.value=object.kind;objectName.value=object.label;await run('response.editObject',object.id);author.open=true;invalidate();};
  function renderObjects(score){
   const list=score.objects??[];
   if(selectedObject&&!list.some(object=>object.id===selectedObject))selectedObject=null;
   objects.replaceChildren();
   if(!list.length)objects.append(el('p','Capture or choose A and B, then save a state, transition or effect.'));
   for(const object of list){
    const card=el('article');card.className='object-card';card.dataset.selected=String(selectedObject===object.id);card.dataset.objectId=object.id;
    card.append(el('strong',object.label),el('span',`${kinds[object.kind]??object.kind} · ${object.recipe.fields.length} parameters · ${object.recipe.duration}s`));
    const select=btn(selectedObject===object.id?'Selected':'Select');select.onclick=()=>{selectedObject=object.id;kind.value=object.kind;objectName.value=object.label;invalidate();};
    const edit=btn('Edit A/B');edit.onclick=()=>editObject(object);
    const add=btn('Add to '+names[stage.value]);add.onclick=()=>run('response.addLayer',{stage:stage.value,objectId:object.id});
    const rename=el('input');rename.type='text';rename.value=object.label;rename.setAttribute('aria-label','Rename '+object.label);
    rename.onchange=()=>run('response.renameObject',{id:object.id,label:rename.value});
    const details=el('details');details.append(el('summary','Name & remove'),rename,btn('Remove saved object','response.deleteObject',object.id));
    card.append(actions(select,edit,add),details);objects.append(card);
   }
   addSelected.disabled=!selectedObject;updateObject.disabled=!selectedObject;
  }
  function renderStack(score){
   stack.replaceChildren();const layers=score.stacks?.[stage.value]??[],objectsById=new Map((score.objects??[]).map(object=>[object.id,object]));
   if(!layers.length)stack.append(el('p','No response assigned to '+names[stage.value]+'. Add a saved object below.'));
   layers.forEach((layer,index)=>{
    const object=objectsById.get(layer.objectId),card=el('article');card.className='layer-card';card.dataset.layerId=layer.id;
    const enabled=el('input');enabled.type='checkbox';enabled.checked=layer.enabled!==false;enabled.setAttribute('aria-label','Enable '+(object?.label??'missing object'));
    enabled.onchange=()=>run('response.updateLayer',{stage:stage.value,id:layer.id,enabled:enabled.checked});
    const title=el('label');title.append(enabled,' ',el('strong',object?.label??'Missing saved object'));card.append(title);
    const timing=el('select');timing.setAttribute('aria-label','Timing for '+(object?.label??layer.id));
    for(const [value,label] of [['phase','Fit phase'],['seconds','Authored seconds'],['progress','Observed progress']]){const option=el('option',label);option.value=value;timing.append(option);}timing.value=layer.timing;
    timing.onchange=()=>run('response.updateLayer',{stage:stage.value,id:layer.id,timing:timing.value});
    const factor=number('Duration multiplier for '+(object?.label??layer.id),layer.scale??1,value=>run('response.updateLayer',{stage:stage.value,id:layer.id,scale:value}));
    const multiplier=el('label','× ');multiplier.append(factor);card.append(actions(timing,multiplier));
    const up=btn('↑','response.moveLayer',{stage:stage.value,id:layer.id,direction:-1}),down=btn('↓','response.moveLayer',{stage:stage.value,id:layer.id,direction:1});up.disabled=index===0;down.disabled=index===layers.length-1;
    up.setAttribute('aria-label','Move layer up');down.setAttribute('aria-label','Move layer down');
    const edit=btn('Edit');edit.disabled=!object;edit.onclick=()=>editObject(object);
    card.append(actions(up,down,edit,btn('Remove','response.removeLayer',{stage:stage.value,id:layer.id})));stack.append(card);
   });
  }
  sync=()=>{
   if(!alive)return;const state=response.read({includeScore:false});
   status.textContent=message||state.error||(state.live?'Live · waiting for or following ImageGen':state.recording?`${state.recording.source.label||state.recording.source.model||state.recording.runId} · ${state.playing?'replaying':'paused'}${state.recording.status==='complete'?'':` · ${state.recording.status}`}${state.recording.terminal?.error?.message?': '+state.recording.terminal.error.message:''}`:'No recording loaded · choose Demo recording or follow ImageGen');
   scrub.max=String(state.playbackDurationMs||1);scrub.value=String(Math.min(state.position,Number(scrub.max)));scrub.disabled=state.live||!state.recording;play.disabled=state.live||!state.recording;pause.disabled=!state.live&&!state.playing&&!state.previewing;
   position.textContent=`${(state.position/1000).toFixed(1)}s · ${names[state.stage]||state.stage||'Start'}${state.progress===null?'':` · ${Math.round(state.progress*100)}%`}`;
   if(lastRevision===null||lastRevision!==state.scoreRevision||lastStage!==stage.value||lastSelection!==selectedObject){
    cachedScore=response.read().score;renderObjects(cachedScore);renderStack(cachedScore);lastRevision=state.scoreRevision;lastStage=stage.value;lastSelection=selectedObject;
    if(document.activeElement!==scale)scale.value=String(cachedScore.timeScale??1);
    flareTitle.textContent=cachedScore.flare?'Preview flare · '+cachedScore.flare.fields.length+' linked parameters':'Flare when a preview appears';
    if(cachedScore.flare){if(document.activeElement!==attack)attack.value=String(cachedScore.flare.attackMs/1000);if(document.activeElement!==settle)settle.value=String(cachedScore.flare.settleMs/1000);}
   }
   if(state.preview&&`${state.recording.runId}:${state.preview.atMs}`!==lastPreview){lastPreview=`${state.recording.runId}:${state.preview.atMs}`;preview.width=state.preview.width;preview.height=state.preview.height;preview.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(state.preview.rgba),state.preview.width,state.preview.height),0,0);}
   preview.hidden=!state.preview;caption.textContent=state.preview?(state.preview.kind==='illustrated-demo'?'Illustrated demo · not a generated image':'Approximate latent preview'):'';
  };sync();
 },async dispose(){alive=false;response.dispose();await blend.dispose();await scene.dispose();}};
}};
