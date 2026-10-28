// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import {checkedSceneBloom,createSceneBloom} from '../scene-bloom.mjs';
test('bloom preserves coverage, leaves the disabled scene alone and reuses its display graph',()=>{
 let allocations=0,rebuilds=0,redraws=0;const input={rgb:{add:emission=>({emission})},a:{identity:'coverage'}};
 const api=createSceneBloom({bloom:(_node,strength,radius,threshold)=>{allocations++;return {rgb:{},strength:{value:strength},radius:{value:radius},threshold:{value:threshold},dispose(){}};},convertToTexture:x=>x,vec4:(rgb,a)=>({rgb,a}),rebuild:()=>rebuilds++,redraw:()=>redraws++});
 assert.equal(api.output(input),input);assert.equal(allocations,0);
 api.set({enabled:true,strength:0});assert.equal(api.output(input,input),input);assert.equal(allocations,0);api.set({strength:.04});const output=api.output(input,input);assert.equal(output.a,input.a);assert.equal(allocations,1);
 api.set({radius:.2,strength:.3});assert.equal(api.output(input,input),output);assert.equal(allocations,1);
 const prior=api.read();assert.throws(()=>api.set({radius:2}),/radius/);assert.deepEqual(api.read(),prior);
 api.set({enabled:false});assert.equal(api.output(input),input);api.set({enabled:true});assert.equal(api.output(input,input),output);
 assert.equal(rebuilds,4);assert.equal(redraws,5);api.dispose();
});
test('bloom admits zero gain, rejects invalid values atomically and reports its input signal',()=>{
 assert.equal(checkedSceneBloom({strength:0,threshold:0,radius:0}).strength,0);
 for(const value of [{enabled:1},{strength:NaN},{threshold:-1},{radius:Infinity}])assert.throws(()=>checkedSceneBloom(value));
});

test('bloom uses a separate physical-emission input and refuses an ambiguous source',()=>{
 let source;const input={rgb:{add:x=>x},a:1},emission={rgb:'resident-emission'};
 const api=createSceneBloom({bloom:node=>{source=node;return {rgb:{},dispose(){}};},convertToTexture:x=>x,vec4:(rgb,a)=>({rgb,a}),rebuild(){},redraw(){}});
 api.set({enabled:true});
 assert.throws(()=>api.output(input),/emission/i,'whole-scene brightness cannot silently replace an emission attachment');
 api.output(input,emission);assert.equal(source,emission);
 assert.equal(api.read().signal,'physical-emission');
});
