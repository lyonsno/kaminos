import {mountPlaybackControls} from '../../playback-controls.mjs';

export function mountCreatureProperties({document,read,invoke,save,open}) {
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const properties=el('section');properties.className='creature-properties';
 const style=el('style',`.creature-properties{display:grid;gap:12px;border-top:1px solid #41494e;padding-top:12px;margin-top:8px;color:#d9e2e5;font:12px system-ui}.creature-properties[hidden]{display:none}.creature-properties h3{margin:0}.creature-properties label{display:grid;gap:5px}.creature-properties select{width:100%;min-width:0;background:#292e32;color:inherit;padding:7px;border:1px solid #505d64;border-radius:4px}.creature-properties details{font-size:11px}.creature-properties details>div{display:grid;gap:10px;margin-top:10px}.creature-properties button{padding:6px;background:#303b41;color:inherit;border:1px solid #56666d;border-radius:4px}.creature-properties [role=alert]{color:#ffb7ac;overflow-wrap:anywhere}.creature-properties .creature-identity{font:10px ui-monospace,monospace;overflow-wrap:anywhere;color:#95a7ad}.scene-owner-playback{position:absolute;bottom:0;left:0;right:0;z-index:35}.creature-properties input[type=file]{max-width:100%}`);
 properties.append(style,el('h3','Creature'));
 const error=el('div');error.setAttribute('role','alert');error.textContent='';
 const select=(name,items,parent=properties)=>{const label=el('label',name),control=el('select');control.setAttribute('aria-label','Creature '+name.toLowerCase());for(const [value,text]of items){const option=el('option',text);option.value=value;control.append(option);}label.append(control);parent.append(label);return control;};
 const initial=read(),skins=initial.currentSkin?.choices??[];
 const casts=[...new Map(skins.map(c=>[c.cast,c])).values()];
 const cast=select('Cast',casts.map(c=>[c.cast,c.label]));cast.hidden=!casts.length;
 const motion=select('Motion',initial.motions.map(c=>[c.id,c.label]));motion.hidden=!initial.motions.length;
 const mode=select('Playback',[['source','One pass'],['cycle','Repeat · straight travel'],['path','Follow curved path']]);
 const travel=el('p');travel.style.cssText='margin:0;color:#a5b7bd;font-size:11px';properties.append(travel);
 const advanced=el('details'),advancedBody=el('div');advanced.append(el('summary','Deformation & source'),advancedBody);properties.append(advanced);
 const attachment=select('Attachment',[],advancedBody),identity=el('p');identity.className='creature-identity';advancedBody.append(identity);
 const setup=el('details'),setupBody=el('div');setup.append(el('summary','Save / open creature'),setupBody);properties.append(setup,error);
 const saveButton=el('button','Save creature setup');saveButton.type='button';saveButton.onclick=()=>save(read().recipe);setupBody.append(saveButton);
 const fileLabel=el('label','Open creature setup'),file=el('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Open creature setup');fileLabel.append(file);setupBody.append(fileLabel);
 let disposed=false,lastVariants='';
 const call=async(name,input)=>{if(disposed)return;try{error.textContent='';await invoke(name,input);}catch(e){if(!disposed)error.textContent=e.message;}finally{if(!disposed)update();}};
 cast.onchange=()=>{const current=read().currentSkin.current,variants=skins.filter(c=>c.cast===cast.value),choice=variants.find(c=>c.attachment===current.attachment)??variants.find(c=>c.attachment==='distributed')??variants[0];return call('skin',{cast:choice.cast,attachment:choice.attachment});};
 attachment.onchange=()=>call('skin',{cast:read().currentSkin.current.cast,attachment:attachment.value});
 motion.onchange=()=>call('motion',{id:motion.value});mode.onchange=()=>call('mode',{mode:mode.value});
 file.onchange=async()=>{const chosen=file.files?.[0];if(!chosen||disposed)return;try{error.textContent='';await open(JSON.parse(await chosen.text()));}catch(e){if(!disposed)error.textContent=e.message;}finally{file.value='';}};
 const playbackRoot=el('div');
 const playback=mountPlaybackControls({document,root:playbackRoot,label:'Creature playback',
  read(){const r=read(),p=r.playback;return {playing:p.status==='playing',time:p.time??0,duration:(p.frames-1)/p.fps,stepSeconds:1/p.fps,rate:r.rate};},
  invoke(name,input){const r=read(),p=r.playback;
   if(name==='seek')return invoke('seek',{frame:Math.min(p.frames-1,Math.max(0,Math.round(input.seconds*p.fps)))});
   if(name==='step')return invoke('seek',{frame:Math.min(p.frames-1,Math.max(0,(p.frame??0)+input.direction))});
   return invoke(name,input);
  }});
 function update(){
  if(disposed)return;const r=read(),s=r.currentSkin;
  if(s){cast.value=s.current.cast;cast.disabled=Boolean(s.pending);attachment.disabled=Boolean(s.pending);
   const variants=skins.filter(c=>c.cast===s.current.cast),key=variants.map(c=>c.attachment).join('|');
   if(key!==lastVariants){for(const child of [...attachment.children])child.remove();for(const c of variants){const o=el('option',c.attachmentLabel??c.attachment);o.value=c.attachment;attachment.append(o);}lastVariants=key;}attachment.value=s.current.attachment;
  }
  motion.value=r.motion?.id??'';mode.value=r.mode;
  travel.hidden=r.mode!=='path';travel.textContent=r.pathGuide?`Radius ${r.pathGuide.radius} · ${r.pathGuide.sourceDistance.toFixed(3)} scene units per cycle · source-paced travel`:'';
  identity.textContent=`${r.source.prompt??'Retained motion'}\nMotion ${r.source.motionSha256}\nSkin ${r.source.caseSha256}`;
  playback.update();
 }
 update();
 return {properties,playback:playback.node,update,dispose(){disposed=true;playback.dispose();properties.remove();}};
}
