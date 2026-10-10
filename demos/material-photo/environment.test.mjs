import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import * as THREE from '../../lib/three.webgpu.js';
import {decodeRadianceHdrRgbe} from '../../finger-fluid-webgpu-core.js';

async function environmentModule(){
  const context=vm.createContext({URL,Uint8Array,Uint16Array,Math,Number,Error,fetch:async url=>{
    const data=await readFile(url);return {ok:true,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};
  }});
  const source=new vm.SourceTextModule(await readFile(new URL('./environment.js',import.meta.url),'utf8'),{context,initializeImportMeta(meta){meta.url=new URL('./environment.js',import.meta.url).href;}});
  await source.link(async specifier=>{
    const exports=specifier==='three/webgpu'?THREE:{decodeRadianceHdrRgbe};
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context});
  });
  await source.evaluate();return source.namespace;
}
test('annular light handle round trips frontal, middle and grazing directions without covering the center',async()=>{
  const {lightOnRing,lightFromRing}=await environmentModule();
  for(const length of [0,.2,.7,1])for(let angle=0;angle<Math.PI*2;angle+=.2){
    const light={x:Math.cos(angle)*length,y:Math.sin(angle)*length};
    const {u,v}=lightOnRing(light),r=Math.hypot(u-.5,v-.5);
    assert.ok(r>=.3-1e-12&&r<=.43+1e-12);
    const actual=lightFromRing(u,v);
    assert.ok(Math.hypot(actual.x-light.x,actual.y-light.y)<1e-12);
  }
  assert.equal(lightFromRing(.5,.5).x,0);
  assert.ok(Math.hypot(...Object.values(lightFromRing(5,-5)))<=1);
  assert.throws(()=>lightFromRing(NaN,0),/Invalid/);
});
test('all bundled environments decode to real linear HDR half-float textures',async()=>{
  const {ENVIRONMENTS,loadEnvironmentTexture}=await environmentModule();
  for(const name of Object.keys(ENVIRONMENTS)){
    const texture=await loadEnvironmentTexture(name);
    assert.equal(texture.image.width,1024);assert.equal(texture.image.height,512);
    assert.equal(texture.type,THREE.HalfFloatType);assert.equal(texture.colorSpace,THREE.LinearSRGBColorSpace);
    assert.equal(texture.mapping,THREE.EquirectangularReflectionMapping);
    const values=texture.image.data;let peak=0;
    for(let i=0;i<values.length;i++)if(i%4!==3){const value=THREE.DataUtils.fromHalfFloat(values[i]);assert.ok(Number.isFinite(value));peak=Math.max(peak,value);}
    assert.ok(peak>1,'Tone-mapped LDR is not an HDR environment');texture.dispose();
  }
  await assert.rejects(loadEnvironmentTexture('missing'),/Unknown/);
});
