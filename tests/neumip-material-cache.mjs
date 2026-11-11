// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshStandardNodeMaterial} from '../lib/three.webgpu.js';
import {createNeumipMaterial} from '../neumip-material.mjs';
import {createNeumipStudent} from '../neumip-training.mjs';

test('neural lighting closures cannot share the native PBR program or another model closure',()=>{
 const native=new MeshStandardNodeMaterial();
 const a=createNeumipMaterial(createNeumipStudent({resolution:4,seed:41}));
 const b=createNeumipMaterial(createNeumipStudent({resolution:4,seed:42}));
 try{
  const key=a.material.customProgramCacheKey();
  assert.notEqual(key,native.customProgramCacheKey(),'Neural and native PBR lighting share a compiled program');
  assert.notEqual(key,b.material.customProgramCacheKey(),'Distinct closure-bound model weights share a compiled program');
  a.settings.gain.value=2;
  assert.equal(key,a.material.customProgramCacheKey(),'Uniform edits should retain the compiled program');
 }finally{native.dispose();a.material.dispose();b.material.dispose();}
});
