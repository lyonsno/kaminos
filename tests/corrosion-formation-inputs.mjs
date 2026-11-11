// kaminos-test: node
import test from 'node:test';import assert from'node:assert/strict';import experiment from'../experiments/corrosion-formation.experiment.mjs';
test('invalid source inputs reject before fetching state or opening the scene',async()=>{
 const original=globalThis.fetch;let fetched=0;globalThis.fetch=async()=>{fetched++;throw Error('unexpected state fetch');};
 try{for(const inputs of [null,[],4,'source']){await assert.rejects(()=>experiment.create({inputs,host:{},record(){}}),/inputs must be an object/);}assert.equal(fetched,0);}finally{globalThis.fetch=original;}
});
