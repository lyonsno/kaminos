// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWoodMaps} from '../wood-fiber-material.mjs';

test('missing measured channels refuse before fetching or allocating maps',async()=>{
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return {ok:true,json:async()=>({encoding:'rgba32float-le',samples:{cmaple:{}}})};};
 try{await assert.rejects(loadWoodMaps('https://fixture.invalid/manifest'),/Missing measured wood channel: diffuse/);assert.equal(requests,1);}
 finally{globalThis.fetch=original;}
});
