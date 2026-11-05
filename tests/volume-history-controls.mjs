// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as history from '../volume-history-allocation.mjs';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';
import {readFileSync} from 'node:fs';

test('history settings preserve the accepted defaults and validate GPU-representable input',()=>{
 assert.equal(typeof history.rayHistorySettings,'function','history authoring needs a validated settings contract');
 assert.deepEqual(history.rayHistorySettings(),{influence:1,window:1,retention:0});
 assert.equal(history.rayHistorySettings({influence:0,window:8}).influence,0);
 assert.ok(history.rayHistorySettings({window:8}).retention>0);
 for(const influence of [-1,Infinity,NaN,1e100,1e-100])assert.throws(()=>history.rayHistorySettings({influence}));
 for(const window of [0,-1,1.5,Infinity,1e100])assert.throws(()=>history.rayHistorySettings({window}));
});
test('both knobs belong to the contextual ray marcher and additive saved renderer state',()=>{
 const fields=FLAME_PROPERTY_GROUPS.find(g=>g.name==='Ray marching').fields.map(([id])=>id);
 const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
 for(const key of ['volume-history-influence','volume-history-window']){
  assert.equal(fields.filter(id=>id===key).length,1,key);
  assert.equal(schema.rendererControls.find(c=>c.key===key)?.additiveDefault,1,key+' default');
 }
});
