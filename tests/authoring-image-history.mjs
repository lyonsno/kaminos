// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
let history={};try{history=await import('../authoring-image-history.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const storage=()=>{const data=new Map();return{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
const image=(source,provenance)=>({kind:'image',source,name:source,provenance});
test('history retains every result, lineage and prompt provenance across reload without changing the pinned reference',()=>{
 assert.equal(typeof history.createImageIterationHistory,'function','Generate needs persistent iteration history independent of the current asset selection');
 const store=storage(),c=history.createImageIterationHistory({storage:store});
 c.observe(image('/input.png'));c.useReference('/input.png');
 const p={prompt:'final edit',reference:{source:'/input.png'},promptExpansion:{request:{prompt:'my edit'},expandedPrompt:'expanded'}};
 c.record(image('/result.png',p));assert.equal(c.read().viewed.source,'/result.png');assert.equal(c.reference().source,'/input.png');
 assert.equal(c.comparison().source,'/input.png');c.observe(image('/other.png'));assert.equal(c.reference().source,'/input.png');
 c.view('/result.png');const restored=history.createImageIterationHistory({storage:store});
 assert.equal(restored.read().viewed.source,'/result.png');assert.equal(restored.reference().source,'/input.png');assert.deepEqual(restored.read().viewed.provenance,p);
 restored.useReference('/result.png');assert.equal(restored.reference().source,'/result.png');assert.equal(restored.read().entries.length,3);
 for(let i=0;i<150;i++)restored.record(image('/result-'+i+'.png'));assert.equal(restored.read().entries.length,153,'no history retention cap');
});
test('comparison can select any history image, preserves missing parent identity, and withholds held imagery',()=>{
 const c=history.createImageIterationHistory({storage:storage()});c.record(image('/b.png',{reference:{source:'/a.png'}}));
 assert.equal(c.comparison().source,'/a.png');assert.equal(c.comparison().unverified,true);
 c.observe(image('/c.png'));c.view('/b.png');c.compare('/c.png');assert.equal(c.comparison().source,'/c.png');
 assert.throws(()=>c.record({...image('/secret.png'),visibility:{status:'withheld'}}),/withheld|available/i);
});
test('broken storage is visible and does not erase the in-memory iteration',()=>{
 const c=history.createImageIterationHistory({storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});c.observe(image('/a.png'));
 assert.equal(c.read().entries.length,1);assert.match(c.read().error,/quota/);
});
test('malformed stored history is preserved, and a later withheld selection revokes its remembered image',()=>{
 let written=false;const corrupt={getItem:()=>'{bad',setItem:()=>{written=true;}};const c=history.createImageIterationHistory({storage:corrupt});c.observe(image('/a.png'));assert.equal(written,false);assert.match(c.read().error,/could not be read/);
 const h=history.createImageIterationHistory({storage:storage()});h.observe(image('/held.png'));h.observe({...image('/held.png'),visibility:{status:'withheld'}});assert.equal(h.reference(),null);assert.equal(h.read().viewed,null);
});
