// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageExperiments} from '../authoring-image-experiments.mjs';
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
