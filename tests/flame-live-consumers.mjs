// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');

test('the live host creates its fluid boot before requesting a flame',async()=>{
 const start=page.indexOf('async function initKaminosVolumeRoute() {'),end=page.indexOf('// --- File Input Handling ---',start);
 assert.ok(start>=0&&end>start);
 let initializer,reason;
 const createFluidBoot=init=>{initializer=init;return {ensure:async why=>{reason=why;return 'boot requested';}};};
 const init=new Function('createFluidBoot','window',page.slice(start,end)+';return initKaminosVolumeRoute;')(createFluidBoot,{__kaminosFireBoot:{boot:true,reason:'authored flame'}});
 assert.equal(await init(),'boot requested');assert.equal(typeof initializer,'function');assert.equal(reason,'authored flame');
});

test('the retained prototype exposes the particle, trace and capture consumers',()=>{
 // Evaluate the actual public object without allocating a GPU/device or running
 // its closures. Opaque closure bindings cannot create a missing method.
 const a=core.lastIndexOf('\n  return {'),b=core.lastIndexOf('\n  };');assert.ok(a>=0&&b>a);
 const expression=core.slice(a+'\n  return '.length,b+4);
 const scope=new Proxy({}, {has:()=>true,get:(_,key)=>key===Symbol.unscopables?undefined:()=>{throw Error('consumer was not invoked');}});
 const api=new Function('scope','with(scope){return '+expression+';}')(scope);
 for(const name of ['setCapturePaused','pauseCaptureAtSimStep','holdPresentationForStill','sampleFrame','sampleOpticalParticles','measureOpticalParticleFrame','sampleOpticalTraceChunk'])assert.equal(typeof api[name],'function','missing retained API '+name);
});
