// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadExperimentContributions,openExperiment} from '../workbench-experiments.mjs';
const row=(id,moduleUrl='/'+id+'.mjs')=>({id,title:id,moduleUrl});
const moduleFor=id=>({default:{id,title:id,create:()=>({read:()=>({id}),operations:{}})}});
test('catalogue imports nothing; opening a choice never imports its broken neighbor',async()=>{
 const imports=[];const rows=await loadExperimentContributions([row('good'),row('broken')],{loadModule:async url=>{imports.push(url);if(url==='/broken.mjs')throw Error('missing dependency');return moduleFor(typeof url==='object'?url.id:'good');}});
 assert.deepEqual(imports,[]);
 const entry=await openExperiment(rows[0]);assert.deepEqual(await entry.read(),{id:'good'});assert.deepEqual(imports,['/good.mjs']);await entry.dispose();
 await assert.rejects(openExperiment(rows[1]),/broken.mjs.*missing dependency/);
});
test('metadata errors and duplicate identities disable only those contributions',async()=>{
 const rows=await loadExperimentContributions([row('same','/one'),row('ok'),row('same','/two'),{moduleUrl:'/bad',error:'missing metadata'}]);
 assert.equal(rows.length,4);assert.match(rows[0].error,/Duplicate.*same.*one.*two/);assert.match(rows[2].error,/Duplicate/);assert.equal(rows[1].error,undefined);assert.match(rows[3].error,/missing metadata/);
 await assert.rejects(openExperiment(rows[0]),/Duplicate/);
});
test('selected module must match catalogue identity before its factory can run',async()=>{
 let starts=0;const [entry]=await loadExperimentContributions([row('chosen')],{loadModule:async()=>({default:{id:'other',title:'chosen',create(){starts++;}}})});
 await assert.rejects(openExperiment(entry),/chosen.mjs.*identity/);assert.equal(starts,0);
});
