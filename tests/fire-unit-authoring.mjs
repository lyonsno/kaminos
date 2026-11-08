// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createFireUnitControlDocument} from '../fire-unit-authoring.mjs';
const document=()=>({querySelectorAll:()=>[],implementation:{createHTMLDocument(){const nodes=new Map();return{body:{append(node){nodes.set(node.id,node);}},getElementById:id=>nodes.get(id),createElement:()=>({type:'',value:'',id:''})};}}});
test('a canonical basin retains its virtual smoke presentation control in a private document',()=>{
 const settings={presentationControls:{'raymarch-smoke-presentation':{id:'raymarch-smoke-presentation',type:'button-state',value:'off'}}};
 const copy=createFireUnitControlDocument(document(),settings);assert.equal(copy.getElementById('raymarch-smoke-presentation').value,'off');
});
test('an unknown physical control still fails rather than silently using a default',()=>{
 assert.throws(()=>createFireUnitControlDocument(document(),{domControls:{missing:{id:'missing',type:'range',value:1}}}),/Unsupported fire control missing/);
});
test('a valid grid dimension outside the legacy dropdown options round-trips into private controls',()=>{
 function select(){let value='32';return{id:'volume-world-smoke-flow',tagName:'SELECT',type:'select-one',options:[{value:'32'}],get value(){return value;},set value(v){value=this.options.some(o=>o.value===v)?v:'';},cloneNode(){return select();},append(o){this.options.push(o);}};}
 const source=select(),doc=document();doc.querySelectorAll=()=>[source];const create=doc.implementation.createHTMLDocument;
 doc.implementation.createHTMLDocument=()=>{const copy=create(),append=copy.body.append;copy.body.append=node=>{node.ownerDocument=copy;append(node);};return copy;};
 const copy=createFireUnitControlDocument(doc,{domControls:{'volume-world-smoke-flow':{id:'volume-world-smoke-flow',type:'select-one',value:'10'}}});assert.equal(copy.getElementById('volume-world-smoke-flow').value,'10');
});

test('private numeric pressure fields keep their authored bounds and integer step while seeding runtime values',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const {setFireUnitControlValue}=await import('../fire-unit-authoring.mjs');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('seedControls(copy,values){'),end=html.indexOf('\n    listBasins:',start);
 const input={id:'volume-pressure-cg-iterations',type:'number',value:'6',min:'1',max:'',step:'1'};
 const ctx=vm.createContext({volumeSceneControlId:()=>input.id,GRID_TUNING_FIELDS:[],setFireUnitControlValue});
 const callback=vm.runInContext('({'+html.slice(start,end)+'})',ctx).seedControls;
 callback({getElementById:()=>input},{pressureCgIterations:6});
 assert.equal(input.max,'','an unbounded CG count must remain adjustable above its current value');
 assert.equal(input.min,'1');assert.equal(input.step,'1');
});

test('editing an older fire object materializes new pressure controls for basin saving',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const text=readFileSync(new URL('../fire-unit-authoring.mjs',import.meta.url),'utf8'),start=text.indexOf('function snapshot('),end=text.indexOf('\n let applying',start);
 const old={controlCount:1,domControls:{'volume-pressure-solver':{id:'volume-pressure-solver',value:'converged-open-top'}},rendererControls:{},presentationControls:{}};
 const seedSettings={domControls:Object.fromEntries([['volume-pressure-algorithm','sor'],['volume-pressure-cg-iterations',6]].map(([id,value])=>[id,{id,value}]))};
 const ctx=vm.createContext({structuredClone,seedSettings,settings:()=>old,copy:{getElementById:id=>({type:id==='volume-pressure-cg-iterations'?'number':'select-one',value:id==='volume-pressure-cg-iterations'?'10':id==='volume-pressure-algorithm'?'amgpcg':'converged-open-top'})}});
 vm.runInContext(text.slice(start,end),ctx);const result=ctx.snapshot();
 assert.ok(result.domControls['volume-pressure-algorithm'],'edited legacy object must include its pressure algorithm in basin settings');
 assert.deepEqual(JSON.parse(JSON.stringify(result.domControls['volume-pressure-algorithm'])),{id:'volume-pressure-algorithm',value:'amgpcg'});
 assert.equal(result.domControls['volume-pressure-cg-iterations'].value,10);assert.equal(result.controlCount,3);assert.equal(old.controlCount,1);
});
