// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageIterationHistory} from '../authoring-image-history.mjs';
import {withPngProvenance} from '../authoring-image-generation.mjs';
import * as recipe from '../authoring-image-recipe.mjs';
const p={schema:'kaminos.image-generation.v1',model:'FLUX.3 Image Klein',prompt:'leather glove',seed:7009,width:256,height:256,aspect:'square',weightsLevel:'4-bit',source:{repo:'bfl',revision:'actual'},sampling:{steps:4,shift:3},lora:{sha256:'adapter'}};
const entry=(source='/glove.png',provenance=p)=>({kind:'image',source,name:'Glove',provenance});
const storage=()=>{const data=new Map();return{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
function harness(options={}){
 assert.equal(typeof recipe.createImageRecipeIteration,'function','Generate needs one recall operation shared by links and UI');
 const history=createImageIterationHistory({storage:storage()}),calls=[];
 let controls={model:'flux2',prompt:'old',seed:1,size:1024,aspect:'portrait',level:'2-bit',reference:null};
 const c=recipe.createImageRecipeIteration({history,assets:{select:e=>calls.push(e)},readControls:()=>structuredClone(controls),applyControls:r=>{controls=structuredClone(r);},recallPrompt:r=>calls.push(r),...options});
 return {c,history,calls,get:()=>controls,set:patch=>Object.assign(controls,patch)};
}
test('recall restores the complete supported recipe and preserves its independent conditioning source',()=>{
 const h=harness(),e=entry('/result.png',{...p,width:224,height:384,aspect:'portrait',reference:{source:'/skeleton.png',name:'Skeleton'}});
 h.c.recall(e);
 assert.deepEqual(Object.fromEntries(['model','prompt','seed','size','aspect','level'].map(k=>[k,h.get()[k]])),{model:'flux3',prompt:'leather glove',seed:7009,size:384,aspect:'portrait',level:'4-bit'});
 assert.equal(h.history.reference().source,'/skeleton.png');assert.equal(h.history.read().viewed.source,'/result.png');
 const request=h.c.decorate({...h.get(),reference:h.history.reference()});
 assert.equal(request.iteration.parent.source,'/result.png');assert.deepEqual(request.iteration.changes,[]);
 assert.deepEqual(request.expectedModel.sampling,{steps:4,shift:3});
 h.set({prompt:'knitted glove',size:512});
 assert.deepEqual(h.c.decorate({...h.get(),reference:h.history.reference()}).iteration.changes.map(c=>c.field),['prompt','size']);
});
test('unsupported and missing recipe settings leave the current recipe and controls intact',()=>{
 const h=harness();h.c.recall(entry());const before=structuredClone(h.get());
 for(const patch of [{model:'another model'},{width:640,height:640},{weightsLevel:undefined},{seed:undefined},{seed:-1},{aspect:'portrait'},{reference:{name:'missing source'}}]){
  assert.throws(()=>h.c.recall(entry('/bad.png',{...p,...patch})),/recipe|recorded|supported|partial/i);
  assert.deepEqual(h.get(),before);assert.equal(h.c.read().parent.source,'/glove.png');
 }
});
test('changing model keeps parent lineage without treating the new model as the old model',()=>{
 const h=harness();h.c.recall(entry());h.set({model:'flux2'});const request=h.c.decorate(h.get());
 assert.equal(request.expectedModel,undefined);assert.equal(request.iteration.parent.source,'/glove.png');
 assert.deepEqual(request.iteration.changes.map(c=>c.field),['model']);
 h.c.clear();assert.equal(h.c.decorate(h.get()).iteration,undefined);
});
test('a recipe link reads actual PNG metadata; missing metadata and failed fetch cannot report recall',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
 const bytes=new Uint8Array(await(await withPngProvenance(new Blob([png]),p)).arrayBuffer());
 let value=bytes;const h=harness({fetchBytes:async()=>value});
 await h.c.open({kind:'image',source:'/saved.png',name:'Saved'});assert.equal(h.c.read().parent.source,'/saved.png');assert.equal(h.get().size,256);
 value=png;await assert.rejects(h.c.open({kind:'image',source:'/no-metadata.png'}),/metadata/i);
 assert.equal(h.c.read().parent.source,'/saved.png');assert.match(h.c.read().error,/metadata/i);
 const failed=harness({fetchBytes:async()=>{throw Error('HTTP 404');}});await assert.rejects(failed.c.open({kind:'image',source:'/missing.png'}),/404/);assert.equal(failed.c.read().parent,null);
});
test('a late link read cannot overwrite a newer explicit recall or start generation',async()=>{
 let release;const pending=new Promise(r=>release=r),h=harness({fetchBytes:()=>pending});
 const old=h.c.open({kind:'image',source:'/old.png'});h.c.recall(entry('/chosen.png'));release(new Uint8Array());
 await assert.rejects(old,/superseded/i);assert.equal(h.c.read().parent.source,'/chosen.png');assert.equal(h.get().seed,7009);
});

test('starting a separate experiment clears helper provenance and lineage while retaining editable controls',()=>{
 let reset=0;const h=harness({resetPrompt:()=>reset++});h.c.recall(entry());h.set({prompt:'edited glove'});const before=structuredClone(h.get());
 h.c.clear();assert.equal(reset,1);assert.equal(h.c.read().parent,null);assert.deepEqual(h.get(),before);assert.equal(h.c.decorate(h.get()).iteration,undefined);
});

test('a recipe carries experiment membership into the run snapshot independently of browsing',()=>{
 const h=harness(),experiment={id:'gloves',title:'Glove flight'};
 h.c.recall({...entry(),experiment});
 const request=h.c.decorate(h.get());
 assert.deepEqual(request.experiment,experiment,'Reopening a member must keep its reruns in that saved experiment');
 h.history.observe(entry('/unrelated.png'));
 assert.deepEqual(h.c.decorate(h.get()).experiment,experiment);
 h.c.clear();assert.equal(h.c.decorate(h.get()).experiment,undefined);
 h.c.recall(entry('/saved-child.png',{...p,experiment}));
 assert.deepEqual(h.c.decorate(h.get()).experiment,experiment,'The saved PNG must recover experiment membership on another page');
});
test('an empty experiment can start its first recipe without inheriting an unrelated parent',()=>{
 const h=harness();h.c.recall(entry());
 assert.equal(typeof h.c.joinExperiment,'function','A saved collection needs a first-result path, not only imported members');
 h.c.joinExperiment({id:'new-glove',title:'New glove'});
 assert.equal(h.c.read().parent,null);
 assert.deepEqual(h.c.decorate(h.get()).experiment,{id:'new-glove',title:'New glove'});
 assert.equal(h.c.decorate(h.get()).iteration,undefined);
});

test('reference edits retain experiment membership while clearing the old recipe lineage',()=>{
 const h=harness(),experiment={id:'gloves',title:'Glove flight'};
 h.c.recall({...entry(),experiment});h.c.editImage(entry('/selected.png'));
 assert.equal(h.c.read().parent,null);assert.deepEqual(h.c.decorate(h.get()).experiment,experiment);
 h.c.editImage({...entry('/other.png'),experiment:{id:'other',title:'Other flight'}});
 assert.equal(h.c.decorate(h.get()).experiment.id,'other');
});
test('entering Generate from an experiment preserves its existing recipe but drops unrelated lineage',()=>{
 const h=harness(),experiment={id:'gloves',title:'Glove flight'};
 h.c.recall({...entry(),experiment});h.c.joinExperiment(experiment,{preserveRecipe:true});
 assert.equal(h.c.read().parent.source,'/glove.png');
 h.c.joinExperiment({id:'other',title:'Other flight'},{preserveRecipe:true});
 assert.equal(h.c.read().parent,null);assert.equal(h.c.decorate(h.get()).experiment.id,'other');
});

test('explicit adapter absence survives decoration; older unknown FLUX3 adapter state cannot promise replay',()=>{
 const h=harness();h.c.recall(entry('/plain.png',{...p,lora:null}));
 assert.equal(h.c.decorate(h.get()).expectedModel.lora,null);
 const legacy={...p};delete legacy.lora;
 assert.throws(()=>h.c.recall(entry('/legacy.png',legacy)),/adapter.*recorded|recorded.*adapter/i);
 assert.equal(h.c.read().parent.source,'/plain.png');
});

test('fresh reference edits retain an image parent separately from exact recipe recall',()=>{
 const h=harness();h.c.editImage({...entry('/plate.png',null),experiment:{id:'burners',title:'Burners'}});h.set({prompt:'Cut a visible slot',seed:42});
 assert.equal(h.c.read().parent,null,'a raw plate does not pretend to have a recalled recipe');
 const request=h.c.decorate(h.get());assert.equal(request.iteration.parent.source,'/plate.png');assert.equal(request.iteration.operation,'image-edit');assert.equal(request.experiment.id,'burners');
 h.c.clear();assert.equal(h.c.decorate(h.get()).iteration,undefined);
});

test('a fresh image parent outside a collection is visible and clearable through the ordinary status control',()=>{
 const h=harness();h.c.editImage(entry('/raw.png',null));
 const nodes=new Map(),node=()=>({hidden:false,dataset:{},append(){},after(){},setAttribute(){},addEventListener(){},querySelector(){return node();}}),get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const document={createElement:tag=>{const e=node();Object.defineProperty(e,'id',{set(id){nodes.set(id,e);}});return e;},getElementById:get};
 const ui=recipe.installImageRecipeStatus({document,iteration:h.c});
 assert.equal(get('asset-recipe').hidden,false);assert.equal(get('asset-generate').dataset.recipeActive,'true');assert.match(get('asset-recipe-status').textContent,/image.*Glove|Glove.*image/i);assert.equal(get('asset-recipe-clear').hidden,false);
 get('asset-recipe-clear').onclick();ui.render();assert.equal(h.c.decorate(h.get()).iteration,undefined);assert.equal(get('asset-recipe').hidden,true);
});

test('an early-decoded result restores editable inputs and retains its prior completion without promising the old stopping point',()=>{
 const h=harness(),completion={earlyDecoded:true,stepsCompleted:3,stepsRequested:4};
 h.c.recall(entry('/preview.png',{...p,completion}));
 assert.equal(h.get().prompt,p.prompt);assert.equal(h.get().seed,p.seed);assert.deepEqual(h.c.read().completion,completion);
 const nodes=new Map(),node=()=>({hidden:false,dataset:{},append(){},after(){},setAttribute(){},addEventListener(){},querySelector(){return node();}}),get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const document={createElement:()=>{const e=node();Object.defineProperty(e,'id',{set(id){nodes.set(id,e);}});return e;},getElementById:get};recipe.installImageRecipeStatus({document,iteration:h.c});assert.match(get('asset-recipe-status').textContent,/3 of 4/);assert.match(get('asset-recipe-status').textContent,/full recorded schedule/);
 const request=h.c.decorate(h.get());assert.deepEqual(request.iteration.parentCompletion,completion);assert.deepEqual(request.expectedModel.sampling,p.sampling);assert.equal(request.completion,undefined,'the old stopping point must not silently control the new run');
});
test('opening presents the recipe only after validated controls and lineage are restored; rejected reads never present',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
 const bytes=new Uint8Array(await(await withPngProvenance(new Blob([png]),p)).arrayBuffer());let value=bytes,presented=[];
 const h=harness({fetchBytes:async()=>value,onOpened:state=>presented.push({state,controls:structuredClone(h.get())})});
 await h.c.open(entry('/valid.png'));assert.equal(presented.length,1);assert.equal(presented[0].controls.prompt,p.prompt);assert.equal(presented[0].state.parent.source,'/valid.png');
 value=png;await assert.rejects(h.c.open(entry('/raw.png')),/metadata/);assert.equal(presented.length,1,'a missing recipe cannot open an empty Generate page');assert.equal(h.c.read().parent.source,'/valid.png');
});
