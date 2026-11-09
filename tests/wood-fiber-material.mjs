// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWoodMaps,createWoodMaterial} from '../wood-fiber-material.mjs';
import {DataTexture} from '../lib/three.webgpu.js';

test('missing measured channels refuse before fetching or allocating maps',async()=>{
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return {ok:true,json:async()=>({encoding:'rgba32float-le',samples:{cmaple:{}}})};};
 try{await assert.rejects(loadWoodMaps('https://fixture.invalid/manifest'),/Missing measured wood channel: diffuse/);assert.equal(requests,1);}
 finally{globalThis.fetch=original;}
});

test('fiber optical controls retain accepted values and refuse invalid edits',()=>{
 const texture=new DataTexture(),maps=Object.fromEntries(['diffuse','axis','fiber','beta'].map(key=>[key,texture]));
 const program=createWoodMaterial(maps);
 try{
  assert.equal(typeof program.setFiberSpread,'function','fiber width must be an editable material parameter');
  assert.equal(typeof program.setIOR,'function','fiber-medium refraction must be editable');
  program.setFiberSpread(2);program.setIOR(1.33);
  assert.deepEqual(program.readParameters(),{fiberStrength:1,roughness:.28,fiberSpread:2,ior:1.33});
  for(const value of [0,-1,NaN,Infinity])assert.throws(()=>program.setFiberSpread(value));
  for(const value of [.9,NaN,Infinity])assert.throws(()=>program.setIOR(value));
  assert.equal(program.readParameters().fiberSpread,2);
  assert.equal(program.readParameters().ior,1.33);
 }finally{program.dispose();texture.dispose();}
});
