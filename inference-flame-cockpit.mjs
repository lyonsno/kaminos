import {portraitImage} from './flame-portrait.mjs';
import {INFERENCE_STAGES} from './inference-flame.mjs';
const names={weights:'Weights',text:'Prompt',denoise:'Denoise',decode:'Decode',saving:'Save',complete:'Finished'};
const kinds={state:'State',ramp:'Transition',pulse:'Effect'};
const seconds=ms=>`${Number((ms/1000).toFixed(1))}s`;

// A rendering layer over the same response/blend operations used by agents.
// Only transport/progress changes every frame; object DOM changes on edits.
export async function mountInferenceFlameCockpit({root,document,host,flame,blend,response,invoke,arrangement}){
 const el=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
 const style=el('link');style.rel='stylesheet';style.href=new URL('./inference-flame-cockpit.css',import.meta.url).href;
 const panel=el('section',null,'inference-flame-panel');root.append(style,panel);
 let alive=true,message='',selectedStage='denoise',selectedObject=null,selectedLayer=null,lastStructure='',lastPreview='',score=null;
 const drags=new Set(),rowNodes=new Map();
 const actions=(...nodes)=>{const row=el('div',null,'if-actions');row.append(...nodes);return row;};
 const button=(label,fn,title)=>{const b=el('button',label,'btn');b.type='button';b.onclick=fn;if(title)b.title=title;return b;};
 const run=async(name,value)=>{message='';try{return await invoke(name,value);}catch(error){message=error.message;return null;}finally{sync();}};
 const number=(label,value,change,step=.1)=>{const n=el('input');n.type='number';n.step='any';n.min='.001';n.value=value;n.setAttribute('aria-label',label);n.onchange=()=>change(Number(n.value));const drag=host.controls.installNumberDrag({input:n,step});drags.add(drag);return n;};
 const detail=(title)=>{const d=el('details');d.append(el('summary',title));return d;};
 const select=(label,options,change)=>{const n=el('select');n.setAttribute('aria-label',label);for(const [id,text] of options){const o=el('option',text);o.value=id;n.append(o);}n.onchange=()=>change(n.value);return n;};
 const heading=actions(el('strong','Flame score'),button('Frame flame',()=>run('frame')));heading.classList.add('if-heading');panel.append(heading);
 const source=el('div',null,'if-source'),status=el('div',null,'if-status');status.setAttribute('role','status');
 const play=button('▶ Replay',()=>run('response.play')),pause=button('Ⅱ Pause',()=>run('response.pause')),position=el('output');
 panel.append(source,actions(play,pause,position));
 const scrub=el('input');scrub.type='range';scrub.min=0;scrub.step='any';scrub.setAttribute('aria-label','Inference replay position');scrub.oninput=()=>run('response.seek',Number(scrub.value));panel.append(scrub,status);
 const preview=el('canvas');preview.hidden=true;const caption=el('small');panel.append(preview,caption);
 const files=detail('Recording & files');
 const save=button('Save arrangement…',async()=>{try{const data=await invoke('response.export'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=el('a');a.href=url;a.download='inference-flame.json';a.click();URL.revokeObjectURL(url);message='Arrangement saved.';}catch(e){message=e.message;}sync();});
 const file=el('input');file.type='file';file.accept='.json';file.hidden=true;file.onchange=async()=>{try{if(file.files[0]){await invoke('response.restore',JSON.parse(await file.files[0].text()));selectedObject=null;selectedLayer=null;message='Arrangement opened.';}}catch(e){message=e.message;}finally{file.value='';sync();}};
 files.append(actions(button('Latest run',()=>run('response.latest')),button('Demo recording',()=>run('response.demo')),button('Follow next ImageGen',()=>run('response.follow'))),actions(save,button('Open arrangement…',()=>file.click())),file);
 const terminal=el('p');files.append(terminal);panel.append(files);

 const scoreHeading=actions(el('strong','Inference phases'),el('small','Select a phase to arrange it'));panel.append(scoreHeading);
 const phases=el('div',null,'if-phases');phases.setAttribute('aria-label','Inference phase score');panel.append(phases);
 const phaseHint=el('p',null,'if-hint');panel.append(phaseHint);

 const libraryHeading=actions(el('strong','Saved looks & effects'),button('+ New',()=>{selectedObject=null;selectedLayer=null;author.open=true;sync();editor.scrollIntoView({block:'nearest'});}));panel.append(libraryHeading);
 const objects=el('div',null,'if-library');objects.setAttribute('aria-label','Saved flame objects');panel.append(objects);
 const libraryHint=el('small','Drag onto a phase, or select a look and use + on its phase.');panel.append(libraryHint);

 const editor=el('section',null,'if-editor');editor.setAttribute('aria-label','Selected flame object editor');panel.append(editor);
 const editorHeading=el('strong'),objectName=el('input');objectName.type='text';objectName.placeholder='Name optional';objectName.setAttribute('aria-label','Flame object name');
 objectName.onchange=()=>{if(selectedObject)run('response.renameObject',{id:selectedObject,label:objectName.value.trim()});};
 const kind=select('Saved flame object kind',Object.entries(kinds),value=>{if(selectedObject)run('response.updateObject',{id:selectedObject,kind:value});});kind.value='ramp';
 const previewObject=button('▶ Preview look',async()=>{if(!selectedObject)return;const result=await run('response.editObject',selectedObject);if(result)await run('play');});
 const editLooks=button('Edit A/B',async()=>{if(selectedObject&&!await run('response.editObject',selectedObject))return;author.open=true;author.scrollIntoView({block:'nearest'});});
 const addObject=button('Add to Denoise',()=>run('response.addLayer',{stage:selectedStage,objectId:selectedObject}));
 const objectActions=actions(previewObject,editLooks,addObject);editor.append(editorHeading,objectName,kind,objectActions);
 const layerControls=el('div',null,'if-layer-editor');editor.append(layerControls);
 const timing=select('Selected layer timing',[['phase','Fill phase'],['seconds','Fixed seconds'],['progress','Observed progress']],value=>updateLayer({timing:value}));
 const timingValue=number('Selected layer duration',100,value=>{const object=score.objects.find(o=>o.id===selectedObject);updateLayer({scale:timing.value==='seconds'?value/(object.recipe.duration*(score.timeScale??1)):value/100});});
 const timingUnit=el('span'),timingRow=actions(timing,timingValue,timingUnit),timingHint=el('p');
 const enabled=el('input');enabled.type='checkbox';enabled.setAttribute('aria-label','Enable selected layer');enabled.onchange=()=>updateLayer({enabled:enabled.checked});const enabledLabel=el('label','Enabled ');enabledLabel.prepend(enabled);
 const up=button('↑',()=>move(-1),'Move earlier in stack'),down=button('↓',()=>move(1),'Move later in stack');up.setAttribute('aria-label','Move selected layer up');down.setAttribute('aria-label','Move selected layer down');
 layerControls.append(timingRow,timingHint,actions(enabledLabel,up,down,button('Remove from phase',()=>{const id=selectedLayer;selectedLayer=null;return run('response.removeLayer',{stage:selectedStage,id});})));
 const updateLayer=patch=>run('response.updateLayer',{stage:selectedStage,id:selectedLayer,...patch});
 const move=direction=>run('response.moveLayer',{stage:selectedStage,id:selectedLayer,direction});
 const author=detail('Author endpoint looks');const authorRoot=el('div');author.append(authorRoot);editor.append(author);await blend.mount({root:authorRoot,document,invoke});
 const saveNew=button('Save new from A/B',async()=>{const result=await run('response.saveBlendObject',{label:objectName.value.trim()||undefined,kind:kind.value});if(result){selectedObject=result.score.objects.at(-1).id;selectedLayer=null;author.open=false;sync();}});
 const update=button('Update from A/B',()=>run('response.updateBlendObject',{id:selectedObject,kind:kind.value,...(objectName.value.trim()?{label:objectName.value.trim()}:{})}));
 const remove=button('Delete saved object',async()=>{const result=await run('response.deleteObject',selectedObject);if(result){selectedObject=null;sync();}});
 editor.append(actions(saveNew,update,remove));

 const extras=detail('Preview flare & timing');
 const scale=number('All response durations multiplier',1,value=>run('response.timeScale',value));const scaleLabel=el('label','All response durations × ');scaleLabel.append(scale);extras.append(scaleLabel);
 const attack=number('Preview flare attack seconds',.12,()=>{}),settle=number('Preview flare settle seconds',.9,()=>{});const attackLabel=el('label','Attack seconds '),settleLabel=el('label','Settle seconds ');attackLabel.append(attack);settleLabel.append(settle);
 extras.append(el('p','A preview flare uses the checked endpoint parameters and settles back onto the phase.'),actions(attackLabel,settleLabel),actions(button('Capture current as flare',()=>run('response.capturePeak',{attackMs:Number(attack.value)*1000,settleMs:Number(settle.value)*1000})),button('Remove flare',()=>run('response.clearFlare'))));panel.append(extras);

 function pictures(object,compact=false){
  const row=el('span',null,'if-pictures');row.dataset.kind=object.kind;
  for(const slot of object.kind==='ramp'?['a','b']:['b']){
   if(row.childNodes.length)row.append(el('span','→','if-arrow'));
   const endpoint=object.recipe[slot];const picture=endpoint?.portrait?portraitImage(document,endpoint.portrait,{label:(endpoint.label||slot.toUpperCase())}):el('span',slot.toUpperCase(),'if-missing');
   if(!endpoint?.portrait)picture.title='Cover missing · edit A/B to capture a look';row.append(picture);
  }if(compact)row.classList.add('if-pictures-small');return row;
 }
 function chooseObject(id,layerId=null){selectedObject=id;selectedLayer=layerId;sync();}
 function renderStructure(state){
  score=response.read().score;const list=score.objects??[];
  if(selectedObject&&!list.some(o=>o.id===selectedObject)){selectedObject=null;selectedLayer=null;}
  if(selectedLayer&&!score.stacks?.[selectedStage]?.some(l=>l.id===selectedLayer)){selectedLayer=null;}
  const byId=new Map(list.map(o=>[o.id,o]));phases.replaceChildren();rowNodes.clear();
  for(const stage of INFERENCE_STAGES){
   const span=state.phases.find(p=>p.stage===stage),row=el('section',null,'if-phase');row.dataset.stage=stage;row.dataset.selected=String(stage===selectedStage);
   const choose=button(names[stage],()=>{selectedStage=stage;selectedLayer=null;sync();});choose.classList.add('if-phase-name');choose.setAttribute('aria-pressed',String(stage===selectedStage));
   const duration=el('small',span?seconds(span.recordedEndMs-span.startMs):state.live?'Waiting':state.recording?'Not in recording':'No recording');
   const audition=button('▶',()=>{selectedStage=stage;selectedLayer=null;return run('response.previewStage',stage);},'Preview '+names[stage]);audition.setAttribute('aria-label','Preview '+names[stage]);audition.disabled=!span||state.live;
   const add=button('+',()=>run('response.addLayer',{stage,objectId:selectedObject}),'Add selected look to '+names[stage]);add.setAttribute('aria-label','Add selected to '+names[stage]);add.disabled=!selectedObject;
   row.append(actions(choose,duration,audition,add));const layers=el('div',null,'if-layers');
   for(const layer of score.stacks?.[stage]??[]){const object=byId.get(layer.objectId);if(!object)continue;
    const chip=button('',()=>{selectedStage=stage;chooseObject(object.id,layer.id);});chip.classList.add('if-layer');chip.dataset.layerId=layer.id;chip.dataset.selected=String(selectedLayer===layer.id);chip.dataset.enabled=String(layer.enabled);chip.title=object.label+' · select to edit timing and stack order';chip.append(pictures(object,true),el('span',object.label,'if-object-name'));if(!layer.enabled)chip.append(el('small','off'));layers.append(chip);
   }
   if(!layers.childNodes.length){const empty=button('Drop a look here',()=>{selectedStage=stage;selectedLayer=null;sync();});empty.classList.add('if-empty');layers.append(empty);}
   row.append(layers);const progress=el('div',null,'if-phase-progress');row.append(progress);
   row.ondragover=event=>{if(event.dataTransfer.types.includes('application/x-kaminos-flame-object')){event.preventDefault();event.dataTransfer.dropEffect='copy';row.dataset.drop='true';}};
   row.ondragleave=()=>delete row.dataset.drop;row.ondrop=event=>{event.preventDefault();delete row.dataset.drop;const id=event.dataTransfer.getData('application/x-kaminos-flame-object');if(byId.has(id)){selectedStage=stage;run('response.addLayer',{stage,objectId:id});}};
   phases.append(row);rowNodes.set(stage,{row,progress,span});
  }
  objects.replaceChildren();
  for(const object of list){const card=button('',()=>chooseObject(object.id));card.classList.add('if-object');card.dataset.objectId=object.id;card.setAttribute('aria-pressed',String(selectedObject===object.id));card.draggable=true;card.ondragstart=event=>{event.dataTransfer.setData('application/x-kaminos-flame-object',object.id);event.dataTransfer.effectAllowed='copy';};card.append(pictures(object),el('strong',object.label),el('small',kinds[object.kind]+(object.kind==='state'?'':' · '+seconds(object.recipe.duration*1000))));objects.append(card);}
  if(!list.length)objects.append(el('p','Create a look from captured endpoints.'));
  const object=byId.get(selectedObject),layer=score.stacks?.[selectedStage]?.find(l=>l.id===selectedLayer);
  editorHeading.textContent=object?object.label:'New flame response';
  if(document.activeElement!==objectName)objectName.value=object?.label??'';
  if(object)kind.value=object.kind;
  previewObject.disabled=editLooks.disabled=addObject.disabled=update.disabled=remove.disabled=!object;
  addObject.textContent='Add to '+names[selectedStage];
  remove.disabled=!object||Object.values(score.stacks??{}).some(layers=>layers.some(l=>l.objectId===selectedObject));remove.title=remove.disabled&&object?'Remove its phase assignments before deleting':'';
  update.hidden=!object;remove.hidden=!object;saveNew.textContent=object?'Save as new':'Save new from A/B';
  layerControls.hidden=!layer;
  if(layer){enabled.checked=layer.enabled;timing.value=layer.timing;timingRow.hidden=object.kind==='state';timingUnit.textContent=layer.timing==='seconds'?'seconds':'%';
   if(document.activeElement!==timingValue)timingValue.value=layer.timing==='seconds'?object.recipe.duration*layer.scale*(score.timeScale??1):layer.scale*100;
   const span=state.phases.find(p=>p.stage===selectedStage),length=span?span.recordedEndMs-span.startMs:null;
   let hint=object.kind==='state'?'Holds B through this phase.':layer.timing==='progress'?'Follows observed inference progress; unknown progress uses authored seconds.':layer.timing==='phase'&&selectedStage!=='complete'&&length!==null?`Recorded phase: ${seconds(length)}. Response: ${seconds(length*layer.scale*(score.timeScale??1))}.`:`Response: ${seconds(object.recipe.duration*layer.scale*(score.timeScale??1)*1000)}${selectedStage==='complete'?' after inference.':'.'}`;
   const effective=(layer.timing==='phase'&&selectedStage!=='complete'&&length!==null?length:object.recipe.duration*1000)*layer.scale*(score.timeScale??1);
   if(object.kind!=='state'&&length!==null&&selectedStage!=='complete'&&effective>length)hint+=' Next phase interrupts it.';
   timingHint.textContent=hint;const index=score.stacks[selectedStage].indexOf(layer);up.disabled=index===0;down.disabled=index===score.stacks[selectedStage].length-1;
  }
  phaseHint.textContent=selectedLayer?`${names[selectedStage]} · selected layer. Later cards override shared parameters.`:`${names[selectedStage]} selected · add or drop a saved look.`;
  if(document.activeElement!==scale)scale.value=score.timeScale??1;
  if(score.flare){if(document.activeElement!==attack)attack.value=score.flare.attackMs/1000;if(document.activeElement!==settle)settle.value=score.flare.settleMs/1000;}
 }
 function sync(){
  if(!alive)return;const state=response.read({includeScore:false}),recording=state.recording;
  source.textContent=state.live?'Live · following ImageGen':recording?`${recording.source.label||recording.source.model||recording.runId} · ${recording.status==='complete'?'recorded':recording.status}`:'No recording loaded';
  terminal.textContent=recording?.terminal?.error?.message||'Replay repeats inference events; the flame continues evolving.';
  source.title=recording?.terminal?.error?.message||'';
  status.textContent=message||state.error||'';status.hidden=!status.textContent;
  play.disabled=state.live||!recording;pause.disabled=!state.live&&!state.playing&&!state.previewing;scrub.disabled=state.live||!recording;scrub.max=state.playbackDurationMs||1;scrub.value=state.position;
  position.textContent=`${seconds(state.position)} · ${names[state.stage]||'Start'}${state.progress===null?'':` · ${Math.round(state.progress*100)}%`}`;
  const signature=JSON.stringify([state.scoreRevision,recording?.runId,state.phases,selectedStage,selectedObject,selectedLayer,state.live]);
  if(signature!==lastStructure){renderStructure(state);lastStructure=signature;}
  for(const [stage,{row,progress,span}] of rowNodes){row.dataset.active=String(state.stage===stage);progress.style.width=span?`${Math.max(0,Math.min(1,(state.position-span.startMs)/(span.endMs-span.startMs||1)))*100}%`:'0%';}
  const key=state.preview?`${recording.runId}:${state.preview.atMs}`:'';
  if(key&&key!==lastPreview){preview.width=state.preview.width;preview.height=state.preview.height;preview.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(state.preview.rgba),state.preview.width,state.preview.height),0,0);}lastPreview=key;
  preview.hidden=!state.preview;caption.textContent=state.preview?(state.preview.kind==='illustrated-demo'?'Illustrated demo':'Approximate latent preview'):'';
 }
 let framed=false;
 const frameInitial=()=>{if(!framed&&flame.read().active){framed=true;flame.frame();}};
 const unsubscribe=flame.subscribe(frameInitial);frameInitial();sync();
 return {sync,dispose(){alive=false;unsubscribe();for(const drag of drags)drag?.dispose?.();drags.clear();}};
}
