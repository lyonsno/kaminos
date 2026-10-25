import {behaviorControls} from './behavior-settings.mjs';
import {mountPlaybackControls} from '../../playback-controls.mjs';

export function mountCreatureProperties({document,read,invoke,save,open,behaviorContext=null,installNumberDrag=null}) {
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const properties=el('section');properties.className='creature-properties';
 const style=el('style',`.creature-properties{display:grid;gap:12px;border-top:1px solid #41494e;padding-top:12px;margin-top:8px;color:#d9e2e5;font:12px system-ui}.creature-properties[hidden]{display:none}.creature-properties h3{margin:0}.creature-properties label{display:grid;gap:5px}.creature-properties select{width:100%;min-width:0;background:#292e32;color:inherit;padding:7px;border:1px solid #505d64;border-radius:4px}.creature-properties details{font-size:11px}.creature-properties details>div{display:grid;gap:10px;margin-top:10px}.creature-properties button{padding:6px;background:#303b41;color:inherit;border:1px solid #56666d;border-radius:4px}.creature-properties [role=alert]{color:#ffb7ac;overflow-wrap:anywhere}.creature-properties .creature-identity{font:10px ui-monospace,monospace;overflow-wrap:anywhere;color:#95a7ad}.scene-owner-playback{position:absolute;bottom:0;left:0;right:0;z-index:35}.creature-properties input[type=file]{max-width:100%}`);
 properties.append(style,el('h3','Creature'));
 const error=el('div');error.setAttribute('role','alert');error.textContent='';
 const select=(name,items,parent=properties)=>{const label=el('label',name),control=el('select');control.setAttribute('aria-label','Creature '+name.toLowerCase());for(const [value,text]of items){const option=el('option',text);option.value=value;control.append(option);}label.append(control);parent.append(label);return control;};
 const action=select('Action',[['preview','Motion preview'],['wander','Wander here']]);
 const actionNote=el('p');actionNote.style.cssText='margin:0;color:#a5b7bd;font-size:11px';properties.append(actionNote);
 const editArea=el('button','Edit wander area');editArea.type='button';properties.append(editArea);
 const initial=read(),skins=initial.currentSkin?.choices??[];
 const casts=[...new Map(skins.map(c=>[c.cast,c])).values()];
 const cast=select('Cast',casts.map(c=>[c.cast,c.label]));cast.hidden=!casts.length;
 const motion=select('Motion',initial.motions.map(c=>[c.id,c.label]));motion.hidden=!initial.motions.length;
 const mode=select('Playback',[['source','One pass'],['cycle','Repeat · straight travel'],['path','Follow curved path']]);
 const travel=el('p');travel.style.cssText='margin:0;color:#a5b7bd;font-size:11px';properties.append(travel);
 // Attention: what the creature is looking at and why, plus recent looks.
 const attentionBox=el('div');attentionBox.className='creature-attention';attentionBox.hidden=!initial.attention;
 const attentionLabel=el('label'),attentionToggle=el('input');attentionToggle.type='checkbox';attentionToggle.setAttribute('aria-label','Creature attention');
 attentionLabel.style.cssText='display:flex;gap:6px;align-items:center';attentionLabel.append(attentionToggle,el('span','Attention'));
 const attentionNow=el('p'),attentionRecent=el('ol');attentionNow.style.cssText='margin:0';attentionRecent.style.cssText='margin:0;padding-left:18px;color:#a5b7bd;font-size:11px';
 const engageLabel=el('label'),engageToggle=el('input');engageToggle.type='checkbox';engageToggle.setAttribute('aria-label','Investigate interests');engageLabel.style.cssText='display:flex;gap:6px;align-items:center';engageLabel.append(engageToggle,el('span','Investigate interests'));engageToggle.onchange=()=>call('engagement',{enabled:engageToggle.checked});
 attentionBox.append(attentionLabel,engageLabel,attentionNow,attentionRecent);properties.append(attentionBox);
 const tuning=el('details'),tuningBody=el('div'),tuningInputs=new Map(),tuningDrags=[];tuning.append(el('summary','Reactions & motivation'),tuningBody);attentionBox.append(tuning);
 for(const {key,label,description} of behaviorControls){
  const row=el('label',label+' ×'),input=el('input');input.type='number';input.min=['recoveryTime','habituation'].includes(key)?'0.01':'0';input.step='any';input.title=description;input.setAttribute('aria-label','Creature '+label.toLowerCase());
  input.oninput=input.onchange=()=>call('behavior',{[key]:input.value.trim()===''?NaN:Number(input.value)});row.append(input);tuningBody.append(row);tuningInputs.set(key,input);if(installNumberDrag&&input.addEventListener)tuningDrags.push(installNumberDrag({input,grip:row,step:.01}));
 }
 attentionToggle.onchange=()=>call('attention',{enabled:attentionToggle.checked});
 const advanced=el('details'),advancedBody=el('div');advanced.append(el('summary','Deformation & source'),advancedBody);properties.append(advanced);
 const attachment=select('Attachment',[],advancedBody),identity=el('p');identity.className='creature-identity';advancedBody.append(identity);
 const setup=el('details'),setupBody=el('div');setup.append(el('summary','Save / open creature'),setupBody);properties.append(setup,error);
 const saveButton=el('button','Save creature setup');saveButton.type='button';saveButton.onclick=()=>save(read().recipe);setupBody.append(saveButton);
 const fileLabel=el('label','Open creature setup'),file=el('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Open creature setup');fileLabel.append(file);setupBody.append(fileLabel);
 let disposed=false,lastVariants='',motionKey=JSON.stringify(initial.motions.map(c=>[c.id,c.label]));const requests=new Map(),failures=new Map();
 const perform=async(name,action)=>{if(disposed)return;const current=(requests.get(name)??0)+1;requests.set(name,current);failures.delete(name);try{const pending=action();update();await pending;}catch(e){if(!disposed&&requests.get(name)===current&&name!=='skin')failures.set(name,e.message);}finally{if(!disposed)update();}};
 const call=(name,input)=>perform(name,()=>invoke(name,input));
 action.onchange=()=>call('action',{kind:action.value});editArea.onclick=()=>call('selectArea');
 cast.onchange=()=>{const current=read().currentSkin.current,variants=skins.filter(c=>c.cast===cast.value),choice=variants.find(c=>c.attachment===current.attachment)??variants.find(c=>c.attachment==='distributed')??variants[0];return call('skin',{cast:choice.cast,attachment:choice.attachment});};
 attachment.onchange=()=>call('skin',{cast:read().currentSkin.current.cast,attachment:attachment.value});
 motion.onchange=()=>call('motion',{id:motion.value});mode.onchange=()=>call('mode',{mode:mode.value});
 file.onchange=async()=>{const chosen=file.files?.[0];if(!chosen||disposed)return;await perform('open',async()=>open(JSON.parse(await chosen.text())));file.value='';};
 const playbackRoot=el('div');
 const playback=mountPlaybackControls({document,root:playbackRoot,label:'Creature playback',
  read(){const r=read(),p=r.playback;return {playing:p.status==='playing',time:p.time??0,duration:(p.frames-1)/p.fps,stepSeconds:1/p.fps,rate:r.rate};},
  invoke(name,input){const r=read(),p=r.playback;
   if(name==='seek')return invoke('seek',{frame:Math.min(p.frames-1,Math.max(0,Math.round(input.seconds*p.fps)))});
   if(name==='step')return invoke('seek',{frame:Math.min(p.frames-1,Math.max(0,(p.frame??0)+input.direction))});
   return invoke(name,input);
  }});
 let behaviorUI=null;
 if(behaviorContext){
  const hiddenStyle=el('style','.creature-properties [hidden]{display:none}');properties.append(hiddenStyle);
  action.parentElement?.remove();editArea.remove();actionNote.remove();setup.remove();
  // DOM/test adapters need not expose parentElement; actual DOM does.
  if(action.parentNode)action.parentNode.remove();
  const controls=el('div'),activeLabel=el('label','Behavior active'),active=el('input'),status=el('p'),places=el('div'),heading=el('h3','Places'),add=el('select'),create=el('button','New zone'),previewLabel=el('label','Preview motion clip'),preview=el('input'),localPreview=el('div');
  active.type=preview.type='checkbox';active.setAttribute('aria-label','Creature behavior active');preview.setAttribute('aria-label','Preview motion clip');status.setAttribute('role','status');status.style.margin='0';
  activeLabel.style.cssText=previewLabel.style.cssText='display:flex;align-items:center;justify-content:space-between';activeLabel.append(active);previewLabel.append(preview);add.setAttribute('aria-label','Add existing Wander zone');create.type='button';
  properties.querySelector('h3').textContent='Body & motion';controls.append(el('h3','Behavior'),activeLabel,status,heading,places,add,create,previewLabel);properties.prepend(controls);
  localPreview.className='creature-local-preview';localPreview.append(playback.node);properties.append(localPreview);
  const extra=el('style',`.creature-place{display:grid;grid-template-columns:20px minmax(0,1fr) 64px 24px;gap:5px;align-items:center;margin:6px 0}.creature-place button{overflow:hidden;text-overflow:ellipsis}.creature-place input[type=number]{min-width:0;width:100%;box-sizing:border-box;background:#292e32;color:inherit;border:1px solid #505d64;padding:5px}.creature-local-preview[hidden]{display:none}.creature-local-preview .playback-controls{position:relative;grid-template-columns:1fr;grid-template-rows:auto;gap:7px;padding:8px 0}.creature-local-preview .playback-timeline{grid-row:2}.creature-local-preview .playback-options{grid-row:3;justify-self:start}.creature-local-preview .playback-controls output{width:13ch;flex-basis:13ch}`);properties.append(extra);
  const handle=fn=>perform('behavior',fn);active.onchange=()=>handle(()=>behaviorContext.setActive(active.checked));preview.onchange=()=>handle(()=>behaviorContext.setPreview(preview.checked));
  add.onchange=()=>handle(()=>{if(!add.value)return;const state=behaviorContext.read();return behaviorContext.setPlaces([...state.places,{zoneId:add.value,enabled:true,preference:1}]);});create.onclick=()=>handle(()=>behaviorContext.addZone());
  behaviorUI={active,status,localPreview,preview,update(){const state=behaviorContext.read();active.checked=state.behavior.active;active.disabled=state.behavior.preview;preview.checked=state.behavior.preview;const engagement=read().action.engagement;status.textContent=state.behavior.status==='Wandering'&&engagement?.enabled?({watching:'Watching before approaching',approaching:'Approaching an interest',inspecting:'Stopped to inspect',cautious:'Keeping still and watching',withdrawing:'Giving it more space',wandering:'Wandering'}[engagement.phase]??state.behavior.status):state.behavior.status;localPreview.hidden=!state.behavior.preview;mode.parentElement.hidden=!state.behavior.preview;travel.hidden=true;
   const key=JSON.stringify([state.places,state.zones.map(z=>({id:z.id,label:z.label,mounted:z.mounted}))]);if(key===behaviorUI.key)return;behaviorUI.key=key;places.replaceChildren();add.replaceChildren();const option=el('option','Add existing zone…');option.value='';add.append(option);
   const change=(zoneId,patch)=>{const current=behaviorContext.read();return behaviorContext.setPlaces(current.places.map(p=>p.zoneId===zoneId?{...p,...patch}:p));};
   for(const ref of state.places){const zone=state.zones.find(z=>z.id===ref.zoneId),label=zone?.label??'Missing zone',row=el('div'),enabled=el('input'),name=el('button',label),weight=el('input'),remove=el('button','×');row.className='creature-place';enabled.type='checkbox';enabled.checked=ref.enabled;enabled.setAttribute('aria-label','Use zone '+label);enabled.onchange=()=>handle(()=>change(ref.zoneId,{enabled:enabled.checked}));name.type='button';name.title='Select this zone in the scene';name.onclick=()=>handle(()=>behaviorContext.selectZone(ref.zoneId));weight.type='number';weight.min='0';weight.step='any';weight.value=String(ref.preference);weight.setAttribute('aria-label','Preference for '+label);weight.title='Relative preference when choosing the next destination; not a time percentage';weight.onchange=()=>handle(()=>change(ref.zoneId,{preference:Number(weight.value)}));remove.type='button';remove.setAttribute('aria-label','Remove zone '+label);remove.onclick=()=>handle(()=>behaviorContext.setPlaces(behaviorContext.read().places.filter(p=>p.zoneId!==ref.zoneId)));row.append(enabled,name,weight,remove);places.append(row);}
   for(const zone of state.zones)if(zone.mounted&&!state.places.some(p=>p.zoneId===zone.id)){const option=el('option',zone.label);option.value=zone.id;add.append(option);}add.value='';
  }};
 }
 function update(){
  if(disposed)return;const r=read(),s=r.currentSkin;
  // The selector owns Cast/Attachment errors, including requests made through
  // the agent invoker. Other properties cannot supersede that domain state.
  error.textContent=[s?.error,r.action?.error,...failures.values()].filter(Boolean).join('\n');
  action.value=r.action?.kind??'preview';editArea.hidden=!r.action?.area?.mounted;
  const wandering=r.action?.kind==='wander';mode.disabled=wandering;actionNote.hidden=!wandering;
  actionNote.textContent=wandering?`${r.playback.status==='playing'?'Wandering':'Held pose'} · edit the area with the scene gizmo. Flat support; no foot-contact solve.`:'';
  if(s){cast.value=s.current.cast;cast.disabled=Boolean(s.pending);attachment.disabled=Boolean(s.pending);
   const variants=skins.filter(c=>c.cast===s.current.cast),key=variants.map(c=>c.attachment).join('|');
   if(key!==lastVariants){for(const child of [...attachment.children])child.remove();for(const c of variants){const o=el('option',c.attachmentLabel??c.attachment);o.value=c.attachment;attachment.append(o);}lastVariants=key;}attachment.value=s.current.attachment;
  }
  const nextKey=JSON.stringify(r.motions.map(c=>[c.id,c.label]));if(nextKey!==motionKey){motionKey=nextKey;for(const child of [...motion.children])child.remove();for(const c of r.motions){const o=el('option',c.label);o.value=c.id;motion.append(o);}motion.hidden=!r.motions.length;}motion.value=r.motion?.id??'';mode.value=r.mode;
  travel.hidden=r.mode!=='path';travel.textContent=r.pathGuide?`Radius ${r.pathGuide.radius} · ${r.pathGuide.sourceDistance.toFixed(3)} scene units per cycle · source-paced travel`:'';
  const a=r.attention;attentionBox.hidden=!a;
  if(a){
   for(const [key,input] of tuningInputs)if(document.activeElement!==input)input.value=String(a.behavior?.[key]??1);
   attentionToggle.checked=a.enabled;engageToggle.checked=r.action.engagement?.enabled===true;engageToggle.disabled=!a.enabled;
   attentionNow.textContent=!a.enabled?'Off':a.interruption?`Stopped to check · ${a.interruption.cause}`:a.startle?'Startled · recovering':a.why?`Looking at ${a.why.label} · ${a.why.cause}`:'Not looking at anything in particular';
   const looks=a.history.filter(e=>e.kind==='look').slice(-5).reverse(),key=looks.map(e=>e.time).join('|');
   if(attentionRecent.dataset.key!==key){attentionRecent.dataset.key=key;for(const child of [...attentionRecent.children])child.remove();for(const e of looks)attentionRecent.append(el('li',`${e.time.toFixed(1)} s · ${e.cause} · ${e.label??e.id}`));}
  }
  identity.textContent=`${r.source.prompt??'Retained motion'}\nMotion ${r.source.motionSha256}\nSkin ${r.source.caseSha256}`;
  playback.update();behaviorUI?.update();
 }
 update();
 return {properties,playback:behaviorContext?null:playback.node,update,dispose(){disposed=true;for(const drag of tuningDrags)drag.dispose();playback.dispose();properties.remove();}};
}
