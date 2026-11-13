// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import experiment from '../experiments/causeway.experiment.mjs';
test('causeway edits retain latest nonnegative source and release debounced geometry',async()=>{
 let root,disposed=false,persisted,events=[];
 const session={attach:async r=>{root=r;return{id:'causeway-test'};},readView:()=>({}),setView(){},redraw(){},dispose:async()=>{disposed=true;}};
 const e=await experiment.create({host:{scene:{open:async()=>session}},record:v=>events.push(v),updateInputs:v=>persisted=v});
 assert.equal(e.read().objectId,'causeway-test');assert.ok(root.children[0].children.length>1);
 assert.equal(e.operations.setShape({key:'relief',value:.001}).pending,true);
 e.operations.setShape({key:'relief',value:.002});assert.equal(e.read().displayedConfig.relief,.003);
 const result=e.operations.flush();assert.equal(result.displayedConfig.relief,.002);assert.equal(result.pending,false);assert.equal(persisted.source.relief,.002);
 e.operations.setShape({key:'grain',value:-2});assert.equal(e.operations.flush().config.grain,0);
 assert.throws(()=>e.operations.setMode('learned'),/unavailable/);assert.throws(()=>e.operations.setShape({key:'unowned',value:1}),/Invalid/);
 assert.ok(events.length>0);await e.dispose();assert.equal(disposed,true);
});
