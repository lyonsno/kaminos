// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import experiment from '../experiments/causeway.experiment.mjs';
import {createNeumipStudent} from '../neumip-training.mjs';
import {writeNeumipModel} from '../neumip-model.mjs';
import {causewayDefaults} from '../causeway-source.mjs';
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
test('persisted edits keep the original fitted source identity',async()=>{
 const fetchBefore=globalThis.fetch,model=createNeumipStudent({resolution:2,chart:{width:causewayDefaults.width,depth:causewayDefaults.depth,offsetMeters:.004,boundary:'repeat'}}),bytes=writeNeumipModel(model);
 globalThis.fetch=async()=>({ok:true,url:'fixture',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
 const session={attach:async()=>({id:'fit-test'}),readView:()=>({}),setView(){},redraw(){},dispose:async()=>{}};let e,persisted;
 try{e=await experiment.create({host:{scene:{open:async()=>session}},inputs:{modelURL:'fixture'},record(){},updateInputs:v=>persisted=v});e.operations.setShape({key:'relief',value:.001});
 assert.deepEqual(persisted.fitSource,causewayDefaults);
 }finally{await e?.dispose();globalThis.fetch=fetchBefore;}
});

test('physical tile-size edit preserves independent relief and aspect ratio',async()=>{
 const session={attach:async()=>({id:'scale-test'}),readView:()=>({}),setView(){},redraw(){},dispose:async()=>{}};let saved;
 const e=await experiment.create({host:{scene:{open:async()=>session}},inputs:{source:{width:.12,depth:.06}},record(){},updateInputs:v=>saved=v});
 try{e.operations.setTileSize(.24);const r=e.operations.flush();assert.equal(r.config.width,.24);assert.equal(r.config.depth,.12);assert.equal(r.config.relief,.003);assert.equal(saved.source.width,.24);assert.throws(()=>e.operations.setTileSize(0),/positive/);e.operations.setLOD(-1);assert.equal(e.read().lod,-1);}finally{await e.dispose();}
 await assert.rejects(()=>experiment.create({inputs:{cutaway:'false'},host:{scene:{open:async()=>session}},record(){}}),/boolean/);
});
test('learned carrier matches tiled source support and follows cutaway changes',async()=>{
 const previous=globalThis.fetch,model=createNeumipStudent({resolution:2,chart:{width:.12,depth:.12,offsetMeters:.004,boundary:'repeat'}}),bytes=writeNeumipModel(model);let root,e;
 globalThis.fetch=async()=>({ok:true,url:'fixture',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
 const session={attach:async r=>{root=r;return{id:'repeat-test'};},readView:()=>({}),setView(){},redraw(){},dispose:async()=>{}};
 try{e=await experiment.create({host:{scene:{open:async()=>session}},inputs:{modelURL:'fixture',mode:'learned'},record(){}});
  const carrier=root.children.find(c=>c.name==='Learned flat carrier');const width=()=>{carrier.geometry.computeBoundingBox();return carrier.geometry.boundingBox.max.x-carrier.geometry.boundingBox.min.x;};
  assert.ok(Math.abs(width()-.36)<1e-7);e.operations.setCutaway(true);assert.ok(Math.abs(width()-.12)<1e-7);assert.equal(e.read().displayRepeats,1);e.operations.setCutaway(false);assert.ok(Math.abs(width()-.36)<1e-7);
 }finally{await e?.dispose();globalThis.fetch=previous;}
});
