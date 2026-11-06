// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as experimentModule from '../authoring-image-experiments.mjs';
import {createImageExperiments,installImageExperiments} from '../authoring-image-experiments.mjs';
const doc=(id='gloves')=>({schema:'kaminos.image-experiment.v1',id,title:id,revision:1,members:[{source:'/image.png',availability:'available',entry:{source:'/image.png',kind:'image',experiment:{id,title:id}}}]});
test('native selection opens the recorded member through the ordinary recipe operation',async()=>{
 const calls=[],c=createImageExperiments({request:async()=>doc(),openRecipe:async e=>calls.push(e)});
 await c.open('gloves');c.select('/image.png');await c.edit();assert.equal(calls[0].experiment.id,'gloves');
 assert.throws(()=>c.select('/absent.png'),/available/);c.deselect();assert.equal(c.read().selected,null);
});
test('an experiment reference or early-decoded result can start an image edit without pretending to replay its recipe',async()=>{
 const document=doc('burners'),calls=[];
 document.members.push({source:'/soft-reference.png',role:'reference',availability:'available',entry:{kind:'image',source:'/soft-reference.png',experiment:{id:'burners',title:'Burners'}}});
 document.members[0].entry.provenance={completion:{earlyDecoded:true}};
 const c=createImageExperiments({request:async()=>document,openImageEditor:async entry=>calls.push(entry),openRecipe:async()=>{throw Error('Recipe recall must stay separate');}});
 await c.open('burners');
 await c.editImage('/soft-reference.png');
 c.select('/image.png');await c.editImage();
 assert.deepEqual(calls.map(entry=>entry.source),['/soft-reference.png','/image.png']);
 assert.ok(calls.every(entry=>entry.experiment.id==='burners'));
 assert.equal(calls[1].provenance.completion.earlyDecoded,true,'keep the original provenance intact');
 await assert.rejects(c.editImage('/missing.png'),/available/);
});
test('the run snapshot owns destination even while another experiment is browsed',async()=>{
 const writes=[],c=createImageExperiments({request:async(url,payload)=>{
  if(payload){writes.push(payload);return doc(payload.id);}return doc(new URL(url,'http://localhost').searchParams.get('id'));
 }});
 await c.open('other');await c.recordResult({source:'/new.png',name:'New'},{experiment:{id:'gloves'}});
 assert.equal(writes[0].id,'gloves');assert.equal(c.read().document.id,'other');
 assert.deepEqual(writes[0].members,[{source:'/new.png',name:'New',group:'Iterations',role:'result'}]);
 await c.recordResult({source:'/unowned.png'},{});assert.equal(writes.length,1);
});
test('a persistence failure propagates so Generate retains its pixels for retry',async()=>{
 const c=createImageExperiments({request:async()=>{throw Error('disk full');}});
 await assert.rejects(c.recordResult({source:'/new.png'},{experiment:{id:'gloves'}}),/disk full/);
 assert.equal(c.read().document,null);
});
test('late experiment reads cannot overwrite a later selection; wrong identity stays an error',async()=>{
 let release;const c=createImageExperiments({request:url=>url.endsWith('old')?new Promise(r=>release=r):Promise.resolve(doc('new'))});
 const old=c.open('old');await c.open('new');release(doc('old'));assert.equal(await old,null);assert.equal(c.read().document.id,'new');
 await assert.rejects(c.open('wrong'),/does not match/);assert.equal(c.read().document.id,'new');
});

// Minimal DOM transport; the production installer and handlers remain unmodified.
function dom(){
 const nodes=[];
 const node=tag=>{const e={tagName:tag,children:[],dataset:{},hidden:false,disabled:false,textContent:'',attrs:{},classList:{toggle(){}},append(...c){this.children.push(...c);},prepend(...c){this.children.unshift(...c);},after(){},replaceChildren(...c){this.children=c;},setAttribute(k,v){this.attrs[k]=v;},querySelectorAll(){return this.children.flatMap(c=>[...(c.dataset?.source?[c]:[]),...(c.querySelectorAll?.()??[])]);}};nodes.push(e);return e;};
 const document={createElement:node,getElementById:id=>nodes.findLast(e=>e.id===id),addEventListener(){},defaultView:{location:{href:'http://local/'},history:{replaceState(){}}}};
 for(const id of ['asset-browse','asset-browse-header','asset-generate','asset-detail','authoring-assets','asset-status']){const e=node('div');e.id=id;}
 return {document,nodes};
}
test('same-revision refresh removes restricted details and stale comparison handlers revalidate both members',async()=>{
 for(const availability of ['withheld','missing'])for(const restricted of ['selected','other']){
  let current=doc('burners'),ui;const calls=[],{document,nodes}=dom();
  current.members[0].entry.provenance={prompt:'private instruction'};
  current.members.push({...structuredClone(current.members[0]),source:'/other.png',entry:{kind:'image',source:'/other.png'}});
  const c=createImageExperiments({request:async()=>structuredClone(current),changed:()=>ui?.render()});
  ui=installImageExperiments({document,controller:c,assets:{read:()=>({root:'image-experiments',selected:null}),select:e=>calls.push(e)},assetsUI:{open:async()=>{}},history:{record:e=>calls.push(e),compare:e=>calls.push(e)},layout:{compare(){}},recipe:{read:()=>({})}});
  await c.open('burners');c.select('/image.png');
  const oldCompare=nodes.findLast(e=>e.tagName==='select'&&e.attrs['aria-label']==='Compare this image with');oldCompare.value='/other.png';
  const member=current.members[restricted==='selected'?0:1];member.availability=availability;delete member.preview;delete member.entry.provenance;
  if(availability==='withheld')member.entry.visibility={status:'withheld'};
  await c.open('burners');
  if(restricted==='selected'){
   assert.equal(document.getElementById('asset-experiment-edit').disabled,true,'same revision must not retain an enabled recipe action');
   assert.equal(document.getElementById('asset-experiment-edit-image').disabled,true);
  }
  await oldCompare.onchange();assert.deepEqual(calls,[],'a detached stale comparison must not copy either restricted member into history');
 }
});

test('shared branch rows preserve people, agents, external parents and every member without following cycles',()=>{
 assert.equal(typeof experimentModule.imageExperimentBranches,'function');
 const member=(source,parent,author)=>({source,name:source,availability:'available',entry:{source,provenance:{...(parent?{iteration:{parent:{source:parent},operation:'recipe-rerun',changes:[{field:'seed',before:1,after:2}]}}:{}),...(author?{author}:{})}}});
 const human={kind:'person',id:'noah',label:'Noah'},agent={kind:'agent',id:'design-agent',label:'Design Agent'};
 const members=[member('/child','/root',human),member('/sibling','/root',agent),member('/root'),member('/outside','/elsewhere',agent),member('/cycle-a','/cycle-b'),member('/cycle-b','/cycle-a')];
 const rows=experimentModule.imageExperimentBranches(members);
 assert.equal(rows.length,members.length);assert.equal(new Set(rows.map(r=>r.member.source)).size,members.length);
 const child=rows.find(r=>r.member.source==='/child');assert.equal(child.depth,1);assert.deepEqual(child.author,human);assert.equal(child.parent.source,'/root');
 assert.equal(rows.find(r=>r.member.source==='/sibling').author.kind,'agent');
 assert.equal(rows.find(r=>r.member.source==='/outside').parentAvailable,false);
 assert.equal(rows.find(r=>r.member.source==='/root').author,null,'collection owner must not impersonate an unrecorded author');
 assert.ok(rows.some(r=>r.issue==='cycle'));
 assert.deepEqual(members[0].entry.provenance.author,human);
});

test('a recipe-opening failure is visible beside the selected action',async()=>{
 const {document}=dom();let ui;const c=createImageExperiments({request:async()=>doc('burners'),openRecipe:async()=>{throw Error('Recorded model is unsupported');},changed:()=>ui?.render()});
 ui=installImageExperiments({document,controller:c,assets:{read:()=>({root:'image-experiments',selected:null})},assetsUI:{open:async()=>{}},history:{},layout:{},recipe:{read:()=>({})}});
 await c.open('burners');c.select('/image.png');await document.getElementById('asset-experiment-edit').onclick();
 const feedback=document.getElementById('asset-experiment-action-status');assert.ok(feedback,'selected recipe needs visible action feedback');assert.match(feedback.textContent,/Recorded model is unsupported/);
});

test('presenting an explicit recipe preserves its own collection or independence instead of inheriting the viewed collection',async()=>{
 const {createImageRecipeIteration}=await import('../authoring-image-recipe.mjs');const {createImageIterationHistory}=await import('../authoring-image-history.mjs');const {withPngProvenance}=await import('../authoring-image-generation.mjs');
 for(const experiment of [{id:'destination',title:'Destination'},null]){
  const {document}=dom(),listeners=new Map();document.addEventListener=(name,handler)=>listeners.set(name,handler);
  let controls={},ui;const assets={read:()=>({root:'image-experiments',selected:null}),select(){}};
  const p={schema:'kaminos.image-generation.v1',model:'FLUX.3 Image Klein',prompt:'Recorded object',seed:37,width:256,height:256,weightsLevel:'4-bit',lora:null,source:{repo:'test-source',revision:'recorded'},sampling:{steps:16,shift:3},completion:{earlyDecoded:true,stepsCompleted:3,stepsRequested:16}};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'),bytes=new Uint8Array(await(await withPngProvenance(new Blob([png]),p)).arrayBuffer());
  const recipe=createImageRecipeIteration({history:createImageIterationHistory({}),assets,readControls:()=>controls,applyControls:r=>controls=r,fetchBytes:async()=>bytes,onOpened:()=>listeners.get('kaminos-assets-mode-change')({detail:{mode:'generate'}})});
  const c=createImageExperiments({request:async()=>doc('viewed'),changed:()=>ui?.render()});
  ui=installImageExperiments({document,controller:c,assets,assetsUI:{open:async()=>{}},history:{},layout:{},recipe});await c.open('viewed');
  const opened=await recipe.open({kind:'image',source:'/incoming.png',name:'Incoming',...(experiment?{experiment}:{})}),live=recipe.read(),request=recipe.decorate(controls);
  assert.equal(live.parent?.source,'/incoming.png','presenting must not replace an explicitly restored recipe with the collection on screen');assert.deepEqual(live.experiment,experiment);assert.equal(request.iteration.parent.source,'/incoming.png');assert.deepEqual(request.iteration.parentCompletion,p.completion);assert.deepEqual(request.expectedModel.sampling,p.sampling);assert.equal(request.expectedModel.lora,null);assert.deepEqual(opened,live);
 }
});

test('working selection survives inspection and refresh; shift range includes available images only',async()=>{
 const current=doc('burners');current.members.push({source:'/two.png',availability:'available',entry:{kind:'image',source:'/two.png'}},{source:'/held.png',availability:'withheld',entry:{kind:'image'}},{source:'/four.png',availability:'available',entry:{kind:'image',source:'/four.png'}});
 const c=createImageExperiments({request:async()=>structuredClone(current)});await c.open('burners');
 assert.equal(typeof c.toggleSelected,'function','experiment needs independent working selection');
 c.toggleSelected('/image.png');c.select('/two.png');assert.deepEqual(c.read().selection,['/image.png']);
 c.toggleSelected('/four.png',{range:true});assert.deepEqual(c.read().selection,['/image.png','/two.png','/four.png']);
 await c.open('burners');assert.equal(c.read().selected,'/two.png');assert.deepEqual(c.read().selection,['/image.png','/two.png','/four.png']);
 current.members[1].availability='missing';await c.open('burners');assert.deepEqual(c.read().selection,['/image.png','/four.png']);
 c.clearSelection();assert.deepEqual(c.read().selection,[]);
});
