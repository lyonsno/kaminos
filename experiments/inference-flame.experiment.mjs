import blendDefinition from './flame-blend.experiment.mjs';
import {createInferenceFlame,INFERENCE_STAGES} from '../inference-flame.mjs';
import {inferenceEvents} from '../inference-events.mjs';
import {inferenceFlameDemo} from '../inference-flame-demo.mjs';
const names={weights:'Weights',text:'Prompt',denoise:'Denoise',decode:'Decode',saving:'Save',complete:'Finished'};
export default {id:'inference-flame',title:'Flame · inference & replay',async create(context){
 const {host,inputs,record}=context;
 let arrangement=inputs.arrangement;
 if(inputs.arrangementUrl){
  const result=await fetch(inputs.arrangementUrl);
  if(!result.ok)throw Error('Arrangement HTTP '+result.status);
  arrangement=await result.json();
 }
 const initialBlend=inputs.blend??Object.values(arrangement?.score?.stages??{})[0];
 const blend=await blendDefinition.create({...context,inputs:{}}),flame=await host.flame.open(),scene=await host.scene.open();
 let sync=()=>{},alive=true;
 const response=createInferenceFlame({flame,source:inferenceEvents,onFrame:scene.onFrame,changed:()=>sync()});
 response.operations.load(inferenceFlameDemo());
 try{if(arrangement)response.operations.restore(arrangement);if(initialBlend)blend.operations.restore(initialBlend);}catch(e){response.dispose();await blend.dispose();await scene.dispose();throw e;}
 const operations={...Object.fromEntries(Object.entries(blend.operations).map(([key,fn])=>[key,(...args)=>{response.operations.pause();return fn(...args);}]))};
 for(const [name,fn] of Object.entries(response.operations))operations['response.'+name]=(...args)=>{blend.operations.pause();const result=fn.apply(response.operations,args);record({kind:'inference-flame.'+name,phase:'applied',effective:{position:response.read().position,live:response.read().live}});return result;};
 operations['response.assignBlend']=stage=>operations['response.assign']({stage,recipe:blend.operations.export()});
 operations['response.editStage']=stage=>{response.operations.pause();const recipe=response.read().score.stages[stage];if(!recipe)throw Error('Assign a blend to this stage first');return blend.operations.restore(recipe);};
 operations['response.capturePeak']=values=>operations['response.captureFlare']({...values,fields:blend.read().fields});
 return {read:()=>({blend:blend.read(),response:response.read()}),operations,async mount({root,document,invoke}){
  const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const panel=el('section');panel.className='inference-flame-panel';
  const style=el('style');style.textContent=`.inference-flame-panel{display:grid;gap:8px;font-size:12px}.inference-flame-panel p{margin:0;line-height:1.4;color:#bbb}.inference-flame-panel .actions{display:flex;gap:5px;flex-wrap:wrap}.inference-flame-panel button,.inference-flame-panel select{font:inherit}.inference-flame-panel input[type=range]{width:100%}.inference-flame-panel canvas{width:100%;max-height:100px;object-fit:contain;background:#161616}.inference-flame-panel [hidden]{display:none!important}.inference-flame-panel input[type=number]{width:70px}.inference-flame-panel details{border-top:1px solid #ffffff25;padding-top:8px}.inference-flame-panel summary{cursor:pointer;padding:5px 0}`;
  root.append(style,panel);const status=el('p');status.setAttribute('role','status');let message='';
  const run=(name,value)=>{message='';return Promise.resolve().then(()=>invoke(name,value)).catch(e=>{message=e.message;sync();});};
  const btn=(label,name,value)=>{const b=el('button',label);b.className='btn';b.type='button';b.onclick=()=>run(name,value);return b;};
  const heading=el('strong','Give the generation a flame');panel.append(heading,status);
  const transport=el('div');transport.className='actions';const play=btn('Replay','response.play'),pause=btn('Pause','response.pause'),live=btn('Follow next ImageGen','response.follow');transport.append(play,pause,live);panel.append(transport);
  const scrub=el('input');scrub.type='range';scrub.min=0;scrub.max=15500;scrub.step='any';scrub.setAttribute('aria-label','Inference replay position');scrub.oninput=()=>run('response.seek',Number(scrub.value));panel.append(scrub);
  const position=el('output');panel.append(position);
  const preview=el('canvas');preview.width=32;preview.height=32;preview.hidden=true;panel.append(preview);const caption=el('p');panel.append(caption);
  const stageLabel=el('label','Response for '),stage=el('select');stage.setAttribute('aria-label','Inference stage');for(const id of INFERENCE_STAGES){const o=el('option',names[id]);o.value=id;stage.append(o);}stage.value='denoise';stageLabel.append(stage);panel.append(stageLabel);
  const assigned=el('p');panel.append(assigned);
  const assign=btn('Use current A/B blend','response.assignBlend');assign.onclick=()=>run('response.assignBlend',stage.value);
  const edit=btn('Edit stage looks','response.editStage');edit.onclick=async()=>{await run('response.editStage',stage.value);author.open=true;};
  const clear=btn('Clear stage','response.clearStage');clear.onclick=()=>run('response.clearStage',stage.value);
  const assignments=el('div');assignments.className='actions';assignments.append(assign,edit,clear);panel.append(assignments);stage.onchange=()=>sync();
  const author=el('details');author.open=!arrangement;author.append(el('summary','Author A/B looks in Properties'));const authorRoot=el('div');author.append(authorRoot);panel.append(author);
  await blend.mount({root:authorRoot,document,invoke});
  const flare=el('details'),flareTitle=el('summary','Flare when a preview appears');flare.append(flareTitle);
  flare.append(el('p','Tune a peak in Properties, then capture it. Uses the checked A/B parameters; settles back onto the continuing stage response.'));
  const attack=el('input'),settle=el('input');for(const n of [attack,settle]){n.type='number';n.step='any';n.min=0;}attack.value='.12';settle.value='.9';
  const attackLabel=el('label','Attack seconds '),settleLabel=el('label','Settle seconds ');attackLabel.append(attack);settleLabel.append(settle);
  const peak=btn('Capture current flame as peak','response.capturePeak');peak.onclick=()=>run('response.capturePeak',{attackMs:Number(attack.value)*1000,settleMs:Number(settle.value)*1000});
  flare.append(attackLabel,settleLabel,peak,btn('Remove flare','response.clearFlare'));panel.append(flare);
  const files=el('div');files.className='actions';files.append(btn('Use latest ImageGen run','response.latest'));
  const save=btn('Save arrangement…','response.export');save.onclick=async()=>{try{const data=await invoke('response.export');const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=el('a');a.href=url;a.download='inference-flame.json';a.click();URL.revokeObjectURL(url);}catch(e){message=e.message;sync();}};
  const file=el('input');file.type='file';file.accept='.json';file.hidden=true;file.onchange=async()=>{try{if(file.files[0])await invoke('response.restore',JSON.parse(await file.files[0].text()));}catch(e){message=e.message;}finally{file.value='';sync();}};
  const open=btn('Open arrangement…','response.restore');open.onclick=()=>file.click();files.append(save,open,file);panel.insertBefore(files,author);
  panel.append(el('p','Replay repeats inference events, not the evolved fluid. Follow uses ImageGen in Generate and records observed stages and approximate latent previews.'));
  let lastPreview=null;
  sync=()=>{if(!alive)return;const s=response.read();const selected=s.score.stages[stage.value];
   status.textContent=message||s.error||(s.live?'Live · waiting for or following ImageGen':s.recording?`${s.recording.source.label||s.recording.source.model||s.recording.runId} · ${s.playing?'replaying':'paused'}`:'No recording loaded');
   scrub.max=String(s.playbackDurationMs||1);scrub.value=String(Math.min(s.position,Number(scrub.max)));scrub.disabled=s.live||!s.recording;play.disabled=s.live||!s.recording;pause.disabled=!s.live&&!s.playing&&!s.previewing;
   position.textContent=`${(s.position/1000).toFixed(1)}s · ${names[s.stage]||s.stage||'Start'}${s.progress===null?'':` · ${Math.round(s.progress*100)}%`}`;
   assigned.textContent=selected?`${selected.a.label} → ${selected.b.label} · ${selected.fields.length} linked parameters`:'No response assigned. Author A/B below, then use that blend here.';
   edit.disabled=!selected;clear.disabled=!selected;
   flareTitle.textContent=s.score.flare?'Preview flare · '+s.score.flare.fields.length+' linked parameters':'Flare when a preview appears';
   if(s.score.flare){if(document.activeElement!==attack)attack.value=String(s.score.flare.attackMs/1000);if(document.activeElement!==settle)settle.value=String(s.score.flare.settleMs/1000);}
   if(s.preview!==null&&`${s.recording.runId}:${s.preview.atMs}`!==lastPreview){lastPreview=`${s.recording.runId}:${s.preview.atMs}`;preview.width=s.preview.width;preview.height=s.preview.height;preview.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(s.preview.rgba),s.preview.width,s.preview.height),0,0);}
   preview.hidden=!s.preview;caption.textContent=s.preview?(s.preview.kind==='illustrated-demo'?'Illustrated demo · not a generated image':'Approximate latent preview'):'No preview at this position';
  };sync();
 },async dispose(){alive=false;response.dispose();await blend.dispose();await scene.dispose();}};
}};
