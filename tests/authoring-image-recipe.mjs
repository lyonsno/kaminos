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
 for(const patch of [{model:'another model'},{width:640,height:640},{weightsLevel:undefined},{seed:undefined},{seed:-1},{aspect:'portrait'},{reference:{name:'missing source'}},{completion:{earlyDecoded:true,stepsCompleted:2,stepsRequested:4}}]){
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
