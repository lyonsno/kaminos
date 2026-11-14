// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import definition from '../experiments/optical-particles.experiment.mjs';
import {bindParticleNumber} from "../particle-number-control.mjs";
import {opticalParticleSettings} from '../volume-optical-particles.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';

async function mounted({shared=false,inputs={},viewport=false,edits}={}){
 const document=new EventTarget();document.activeElement=null;
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.value='';this.min='';this.max='';const classes=new Set();this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)};}
  append(...els){for(let el of els){if(typeof el==='string'){const node=new Element('span');node.textContent=el;el=node;}el.parentNode=this;this.children.push(el);}}
  setAttribute(){}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);}
  fire(type,init={}){const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,init);this.dispatchEvent(event);}
 }
 document.createElement=t=>new Element(t);if(viewport)document.body=new Element('body');const native=new Map();document.getElementById=id=>native.get(id)??null;
 let accepted=opticalParticleSettings(),reaction=shared?{burnTime:3,cooling:50,heatRelease:6,sootYield:.1,smokeLife:90}:null,writes=[];
 const trace={settings:[],reaction:[],records:[],redraw:[],nativeEvents:[],reset:[]};
 const runtime={...(viewport?{opticalParticleViewport:()=>({getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:600,width:800,height:600})})}:{}),opticalParticleSettings:()=>accepted,setOpticalParticles:s=>{trace.settings.push(s);accepted=opticalParticleSettings(s);},splitIntegralSettings:()=>({mode:'off'}),setSplitIntegral(){},opticalParticleState:()=>({effective:'world-optical-particles',settings:accepted,simulationReaction:reaction,sourceRenderScale:1,sourceRaySteps:8}),setParticleSimulationReaction:p=>{trace.reaction.push(p);reaction={...reaction,...p};return reaction;},resetOpticalParticles(){trace.reset.push(true);}};
 for(const [key,id] of [['burnTime','volume-reactant-mixing-time'],['cooling','volume-reactant-cooling-time'],['sootYield','volume-reactant-soot-yield']]){
  const input=new Element('input'),label=new Element('span');input.value=String(reaction?.[key]??accepted[key]);input.addEventListener('input',()=>{trace.nativeEvents.push(key);runtime.setParticleSimulationReaction({[key]:Number(input.value)});});native.set(id,input);native.set(id+'-val',label);
 }
 document.defaultView={__kaminosVolumePrototype:runtime,Event,crypto:globalThis.crypto,kaminosSceneEdits:edits};
 const owner=await definition.create({host:{controls:{document,installNumberDrag:()=>({dispose(){}})},scene:{open:async()=>({onFrame:()=>()=>{},redraw(){trace.redraw.push(true);},dispose(){}})}},inputs:{...inputs,particles:{acquisitionMode:1,...inputs.particles}},record:r=>trace.records.push(r),updateInputs:s=>writes.push(s)});
 const root=new Element('div');owner.mount({root,document,invoke:async(op,v)=>owner.operations[op](v)});
 const all=el=>[el,...el.children.flatMap(all)];const field=key=>all(root).find(el=>el.dataset.particle===key);
 Object.values(trace).forEach(rows=>{rows.length=0;});
 return {owner,document,field,writes,trace,native,accepted:()=>accepted,dispose:()=>owner.dispose()};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,220));
test('legacy proxy soot settings cannot silently rewrite the shared simulation on reopening',async()=>{
 const old=await mounted({shared:true,inputs:{particles:{sootYield:5,smokeLife:7}}});try{assert.equal(old.owner.read().effective.simulationReaction.sootYield,.1);assert.equal(old.owner.read().effective.simulationReaction.smokeLife,90);assert.equal(old.owner.read().settings.sootYield,.1,'versioned persistence captures the effective shared law');assert.equal(old.owner.read().settings.smokeLife,90);old.owner.operations.setReaction({sootYield:.3,smokeLife:70});assert.equal(old.owner.read().effective.simulationReaction.sootYield,.3);}finally{await old.dispose();}
 const current=await mounted({shared:true,inputs:{particles:{materialStateVersion:1,sootYield:.6,smokeLife:80}}});try{assert.equal(current.owner.read().effective.simulationReaction.sootYield,.6);assert.equal(current.owner.read().effective.simulationReaction.smokeLife,80);}finally{await current.dispose();}
});

test('typed acquisition edits debounce complete values, retain invalid drafts and preserve accepted policy',async()=>{
 const x=await mounted();try{
  const input=x.field('sourceBias');x.document.activeElement=input;
  input.value='0.05';input.fire('input');await Promise.resolve();
  assert.equal(x.accepted().sourceBias,.75,'a typed prefix must not immediately redefine accepted placement');
  await settle();assert.equal(x.accepted().sourceBias,.05,'complete valid tuning applies automatically');
  input.value='2';input.fire('input');await settle();
  assert.equal(x.accepted().sourceBias,.05,'invalid placement leaves accepted runtime state intact');
  assert.equal(input.value,'2','an active invalid draft remains editable');
  x.document.activeElement=null;input.fire('blur');await Promise.resolve();
  assert.equal(Number(input.value),.05,'leaving an invalid draft restores the accepted value');
 }finally{await x.dispose();}
});
test('one shared reaction scrub updates native projection and publishes exactly one accepted operation',async()=>{
 const x=await mounted({shared:true});try{
  const input=x.field('cooling');input.classList.add('scrubbing');input.value='27.25';input.fire('input');await Promise.resolve();
  assert.equal(x.trace.reaction.length,1,'native UI projection may not send a second runtime reaction command');assert.equal(x.trace.settings.length,1);assert.equal(x.writes.length,1);assert.equal(x.trace.records.length,1);assert.equal(x.trace.redraw.length,1);assert.equal(x.trace.nativeEvents.length,0);assert.equal(x.trace.reset.length,0);
  assert.equal(x.owner.read().effective.simulationReaction.cooling,27.25);assert.equal(x.native.get('volume-reactant-cooling-time').value,'27.25');assert.equal(x.native.get('volume-reactant-cooling-time-val').textContent,'27');
  x.owner.operations.setReaction({sootYield:.4,smokeLife:70});assert.equal(x.owner.read().effective.simulationReaction.sootYield,.4);assert.equal(x.owner.read().effective.simulationReaction.smokeLife,70);assert.equal(Number(x.field('sootYield').value),.4);assert.equal(Number(x.field('smokeLife').value),70);
 }finally{await x.dispose();}
});
test('mixed reaction/options edits publish once and invalid mixed edits do not partially change the shared law',async()=>{
 const x=await mounted({shared:true});try{
  x.owner.operations.setOptions({cooling:23,exchangeStrength:.4,lifeQuiet:4});assert.equal(x.trace.reaction.length,1);assert.equal(x.trace.settings.length,1);assert.equal(x.writes.length,1);assert.equal(x.trace.records.length,1);assert.equal(x.trace.redraw.length,1);
  const accepted=x.owner.read(),counts=Object.fromEntries(Object.entries(x.trace).map(([key,rows])=>[key,rows.length])),n=x.writes.length;
  assert.throws(()=>x.owner.operations.setOptions({cooling:17,exchangeStrength:2}),/exchangeStrength/);assert.equal(x.owner.read().effective.simulationReaction.cooling,accepted.effective.simulationReaction.cooling);assert.equal(x.owner.read().settings.exchangeStrength,.4);assert.equal(x.writes.length,n);for(const [key,length] of Object.entries(counts))assert.equal(x.trace[key].length,length,'invalid settings may not reach '+key);
 }finally{await x.dispose();}
});
test('material controls expose exchange, survival, follow acquisition and normalized support through live operations',async()=>{
 const x=await mounted();try{
  const keys=['exchangeStrength','exchangeTime','exchangeCellSize','stateLife','lifeFuel','lifeHeat','lifeSmoke','lifeQuiet','lifeFade','followFraction','followJitter','followFuel','followHeat','followSmoke','debugView','emissionFalloff','extinctionFalloff','emissionEdgeSoftness','extinctionEdgeSoftness'];
  for(const key of keys)assert.ok(x.field(key),'missing usable material control '+key);
  for(const key of ['reactionSeedLength','reactionSupportCoupling','carriedSmokeGain','generatedSmokeGain'])assert.equal(x.field(key),undefined,'obsolete proxy/split control must not be exposed');
  for(const key of ['exchangeStrength','stateLife','lifeFade','followFraction','emissionEdgeSoftness','extinctionEdgeSoftness'])assert.equal(x.field(key).max,'1');
  for(const [key,value] of [['exchangeStrength',.25],['stateLife',.5],['followFraction',.8],['emissionFalloff',1.4]]){const input=x.field(key);input.classList.add('scrubbing');input.value=String(value);input.fire('input');await Promise.resolve();assert.equal(x.accepted()[key],value);input.classList.remove('scrubbing');}
  const view=x.field('debugView');assert.equal(view.children.length,9);view.value='7';view.fire('change');await Promise.resolve();assert.equal(x.accepted().debugView,7);assert.equal(x.trace.reset.length,0);
 }finally{await x.dispose();}
});
test('effective proposal shares expose normalized weights and an unassigned remainder',async()=>{
 const x=await mounted();try{
  x.owner.operations.setOptions({sourceBias:.9,fineCoverage:1,coarseCoverage:1});
  const p=x.owner.read().proposal;assert.ok(p,'effective placement is part of the agent and UI readout');
  assert.equal(p.conditionalOn,'no-accepted-tracking');assert.equal(p.trackingAttemptFraction,.75);assert.equal(p.acceptedTrackingFraction,null,'authored attempt share cannot impersonate a measured tracking success rate');
  assert.equal(p.source,.9);assert.ok(Math.abs(p.fine-.05)<1e-12);assert.ok(Math.abs(p.broad-.05)<1e-12);assert.equal(p.unassigned,0);
  x.owner.operations.setOptions({fineCoverage:0,coarseCoverage:0});assert.ok(Math.abs(x.owner.read().proposal.unassigned-.1)<1e-12);
  assert.equal(x.field('sourceBias').max,'1','scrubbing uses the same fraction bound as typed validation');
 }finally{await x.dispose();}
});
test('scrubbed values apply immediately and disposal cancels pending typed writes',async()=>{
 const x=await mounted();const input=x.field('sourceBias');
 input.classList.add('scrubbing');input.value='.4';input.fire('input');await Promise.resolve();assert.equal(x.accepted().sourceBias,.4);
 input.classList.remove('scrubbing');x.document.activeElement=input;input.value='.2';input.fire('input');const n=x.writes.length;await x.dispose();await settle();assert.equal(x.writes.length,n,'closed controls cannot publish an old delayed edit');
});

test('untouched numeric controls preserve accepted precision and one edit publishes once',async()=>{
 const x=await mounted();try{
  x.owner.operations.setOptions({cooling:30.4472070312505});const input=x.field('cooling'),before=x.writes.length;x.document.activeElement=input;input.fire('blur');await Promise.resolve();assert.equal(x.accepted().cooling,30.4472070312505,'tab navigation cannot write rounded display values');assert.equal(x.writes.length,before);
  input.value='27.25';input.fire('input');await settle();input.fire('change');input.fire('blur');await Promise.resolve();assert.equal(x.accepted().cooling,27.25);assert.equal(x.writes.length,before+1,'debounce/change/blur apply one draft once');
  const bias=x.field('sourceBias');x.document.activeElement=bias;bias.value='2';bias.fire('input');await settle();assert.ok(x.owner.read().error);bias.fire('keydown',{key:'Escape'});assert.equal(x.owner.read().error,null,'discarding an invalid draft clears its error');
 }finally{await x.dispose();}
});

test('connected-field and cost gates share the live authoring path and preserve the population',async()=>{const x=await mounted();try{for(const key of ['exchangeEnabled','groupingEnabled','acquisitionEnabled','birthsEnabled','updateEnabled','reactionEnabled','transportEnabled','liveTimings','hud']){const input=x.field(key);assert.ok(input,key);assert.equal(input.type,'checkbox');input.checked=false;input.fire('change');await Promise.resolve();assert.equal(x.accepted()[key],false,key);}for(const [key,v] of [['exchangeHeat',20],['exchangeRate',100],['exchangeEvery',4],['acquisitionEvery',3],['exchangeSpacing',.125],['opticalCutoff',.001]]){const input=x.field(key);assert.ok(input,key);input.classList.add('scrubbing');input.value=String(v);input.fire('input');await Promise.resolve();assert.equal(x.accepted()[key],v,key);}assert.equal(x.trace.reset.length,0,'live work controls cannot clear material');}finally{await x.dispose();}});

test('HUD visibility responds immediately to explicit controls inside the frame throttle window',async t=>{let clock=1000;t.mock.method(Date,'now',()=>clock);const x=await mounted({viewport:true});try{const hud=x.document.body.children[0];assert.equal(hud.style.display,'block');clock++;x.owner.operations.setOptions({hud:false});assert.equal(hud.style.display,'none');clock++;x.owner.operations.setOptions({hud:true});assert.equal(hud.style.display,'block');}finally{await x.dispose();}});

test('Fill exposes a small active strength and accepts an exact typed zero',async()=>{
 const x=await mounted({inputs:{particles:{depthMode:1,fillExtinction:.0001}}});
 try{
  const fill=x.field('fillExtinction');assert.equal(Number(fill.value),.0001,'a positive strength must never display as off');
  x.document.activeElement=fill;fill.value='0';fill.fire('input');fill.fire('keydown',{key:'Enter'});await Promise.resolve();
  assert.equal(x.accepted().fillExtinction,0);
  assert.equal(x.trace.reset.length,0);
 }finally{await x.dispose();}
});

test('hybrid march emission is independently editable and full reference ignores it',async()=>{
 const x=await mounted({inputs:{particles:{showRaymarch:true,showParticles:true}}});
 try{
  const input=x.field('referenceEmission');assert.ok(input,'hybrid march emission control is missing');
  assert.equal(Number(input.value),0);assert.equal(input.disabled,false);
  input.classList.add('scrubbing');input.value='0.25';input.fire('input');await Promise.resolve();
  assert.equal(x.accepted().referenceEmission,.25);
  x.owner.operations.setOptions({showParticles:false});
  assert.equal(input.disabled,true);assert.equal(x.accepted().referenceEmission,.25);
 }finally{await x.dispose();}
});

test('the transport toggle is unavailable when the entire retained update is held',async()=>{
 const x=await mounted();try{
  assert.equal(x.field('transportEnabled').disabled,false);
  x.owner.operations.setOptions({updateEnabled:false});
  assert.equal(x.field('transportEnabled').disabled,true);
  assert.equal(x.field('reactionEnabled').disabled,true);
  assert.equal(x.accepted().transportEnabled,true,'holding the parent preserves the authored motion setting');
  x.owner.operations.setOptions({updateEnabled:true});
  assert.equal(x.field('transportEnabled').disabled,false);
 }finally{await x.dispose();}
});

test('budget controls are adjacent and distinguish legacy, focused and emitter acquisition',async()=>{
 const x=await mounted();try{
  const fresh=x.field('acquisitionSamples'),slots=x.field('capacity'),replacement=x.field('refresh');
  const rows=slots.parentNode.parentNode.children;
  const position=input=>rows.indexOf(input.parentNode);
  assert.equal(position(fresh),position(slots)+1);
  assert.equal(position(replacement),position(fresh)+1);
  assert.equal(fresh.disabled,false);assert.equal(replacement.disabled,false);
  assert.equal(x.field('fineAcquisition').disabled,true);
  x.owner.operations.setOptions({acquisitionMode:0,capacity:0});
  assert.equal(fresh.disabled,true);assert.equal(replacement.disabled,false);
  assert.equal(x.field('fineAcquisition').disabled,false);
  assert.equal(x.field('followFraction').disabled,true,'legacy does not dispatch tracking');
  x.owner.operations.setOptions({acquisitionMode:2,capacity:1024});
  assert.equal(replacement.disabled,true);assert.equal(x.field('depthSupport').disabled,true);
  assert.equal(x.field('emitterBirthsPerStep').disabled,false);
  x.owner.operations.setOptions({projection:0,depthMode:0});
  assert.equal(x.field('flowAlignment').disabled,true);assert.equal(x.field('depthSlices').disabled,true);
 }finally{await x.dispose();}
});

test('programmatic coverage, pixel support and scene edits share chronological undo',async()=>{
 const edits=createSceneEdits({read:()=>null,write:()=>{}});
 const x=await mounted({edits});
 let sceneValue=0;
 edits.register('@other',{read:()=>({v:sceneValue}),check:v=>v,write:v=>{sceneValue=v.v;}});
 try{
  const first=x.accepted().coverage;
  x.owner.operations.setCoverage({...first,footprint:[[0,1],[1,2]]});
  const curve=x.accepted().coverage;
  edits.apply('@other',{v:1},'Scene edit');
  x.owner.operations.setOptions({coverage:{...curve,smoke:{...curve.smoke,radius:3}},pixelFloor:.25,gain:3});
  assert.equal(edits.state().undoCount,3);
  edits.undo();
  assert.deepEqual(x.accepted().coverage,curve);assert.equal(x.accepted().pixelFloor,.5);assert.equal(x.accepted().gain,3);
  assert.deepEqual(x.writes.at(-1).particles.coverage,curve,'undo persists the accepted settings');
  edits.undo();assert.equal(sceneValue,0);
  edits.undo();assert.deepEqual(x.accepted().coverage,first);
  edits.redo();assert.deepEqual(x.accepted().coverage,curve);
  edits.begin('@other','In-progress scene edit');edits.preview({v:2});
 }finally{await x.dispose();}
 assert.equal(edits.state().active?.id,'@other','closing Workbench cannot cancel an unrelated scene gesture');
 assert.equal(sceneValue,2);edits.cancel();
});

test('keeps Beaming lighting settings opaque across shared lighting edits and scene restoration',async()=>{
 const foreign={enabled:false,width:20,transportWidth:32,directions:12,gain:2};
 const x=await mounted({inputs:{lighting:foreign}});
 const win=x.document.defaultView, calls=[];
 const makeOwner=()=>({configureLiveLighting(patch){calls.push(patch);if(patch&&('width' in patch||'transportWidth' in patch))throw Error('foreign lighting options');return patch&&{enabled:true,intervalMs:250,...patch};},liveLightingState:()=>({})});
 try{
  win.__kaminosSceneRadiance=makeOwner();
  x.owner.operations.setLighting({gain:3});
  assert.deepEqual(calls,[{gain:3}]);
  assert.deepEqual(x.writes.at(-1).lighting,foreign);
  assert.equal(x.writes.at(-1).sharedLighting.gain,3);
  x.owner.operations.setLighting(null);
  assert.deepEqual(x.writes.at(-1).lighting,foreign);
  assert.equal(Object.hasOwn(x.writes.at(-1),'sharedLighting'),false);
 }finally{await x.dispose();}
});

test('keeps the rejection visible after committing an invalid lighting edit',async()=>{
 const input=new EventTarget();input.value='3';input.classList={contains:()=>false};
 let failure;
 const binding=bindParticleNumber({input,read:()=>4,apply:()=>{throw Error('even widths only');},onError:e=>{failure=e.message;},onAccepted:()=>{failure=null;}});
 try{
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
  await Promise.resolve();
  assert.equal(input.value,'4');
  assert.equal(failure,'even widths only');
 }finally{binding.dispose();}
});
