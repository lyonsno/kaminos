import {test} from 'node:test';
import assert from 'node:assert/strict';

test('included pack preserves depth and map bytes and rejects a different input or incomplete maps',async()=>{
  const {encodeExample,decodeExample}=await import('./included-examples.js');
  const depth={width:2,height:2,depth:new Float32Array([1,2,3,4]),normals:new Float32Array(12).fill(-1)};
  const output={width:2,height:2,maps:Object.fromEntries(['albedo','roughness','metallic','orm'].map(name=>[name,{width:2,height:2,data:new Uint8ClampedArray(16).fill(123)}]))};
  const provenance={source:'included-example',inputKey:'2x2:abc',sample:'orb',size:2,revision:'abc',record:{status:'done',moge:{weights:'observed'},supermat:{identity:{}}}};
  const encoded=encodeExample({depth,output,provenance}),decoded=decodeExample(encoded,'2x2:abc');
  assert.deepEqual(decoded.depth,depth);assert.deepEqual(decoded.output,output);
  assert.throws(()=>decodeExample(encoded,'other'),/input/);
  const bad=structuredClone(encoded);delete bad.maps.orm;assert.throws(()=>decodeExample(bad,'2x2:abc'),/map/);
  const partial=structuredClone(encoded);partial.depth=partial.depth.slice(4);assert.throws(()=>decodeExample(partial,'2x2:abc'),/length/);
  assert.throws(()=>encodeExample({depth,output,provenance:{...provenance,record:{status:'error'}}}),/completed/);
});
