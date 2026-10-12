import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {riverSample} from '../finger-fluid-river-playground.mjs';
const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
test('actual constructor encoding round trips through the shader release-slot expression',()=>{
 const pack=source.match(/materialTracerData.set\((\[sample\.xOffset[^;]+), index \* MATERIAL_TRACER_FLOATS \+ 13\)/)[1];
 const shaderRead=source.match(/\(tick - 1u\) % 101u != u32\(([^)]*)\)/)[1];
 const encoded=new Function('sample',`return new Float32Array(${pack})`);
 const decoded=new Function('riverState',`return Math.max(0,Math.trunc(${shaderRead}))`);
 for(let i=0;i<101;i++){
  const sample=riverSample(i),data=encoded(sample);
  assert.equal(decoded({w:data[2]}),sample.releaseSlot,`axial slot ${sample.releaseSlot} corrupted`);
  assert.ok(data[2]<0,'river slots must not masquerade as positive active optical inlets');
 }
});
