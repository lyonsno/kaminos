// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createKaminosVolumePrototype} from '../volume-core.js';
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');

test('the live host registers its fluid initializer before requesting a flame',async()=>{
 const start=page.indexOf('async function initKaminosVolumeRoute() {'),end=page.indexOf('// --- File Input Handling ---',start);
 assert.ok(start>=0&&end>start);
 let initializer,reason;
 const createFluidBoot=init=>{initializer=init;return {ensure:async why=>{reason=why;return 'boot requested';}};};
 const init=new Function('createFluidBoot','window',page.slice(start,end)+';return initKaminosVolumeRoute;')(createFluidBoot,{__kaminosFireBoot:{boot:true,reason:'authored flame'}});
 assert.equal(await init(),'boot requested');assert.equal(typeof initializer,'function');assert.equal(reason,'authored flame');
});

test('the Workbench browser module resolves every retained import',async()=>{
 const script=page.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,'Workbench module script is missing');
 await build({stdin:{contents:script,sourcefile:'index.html',resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',packages:'external',logLevel:'silent'});
});

test('the actual prototype admits boot presentation controls without a retired diagnostic',()=>{
 const stub=()=>new Proxy(function(){},{get(t,p){if(p===Symbol.toPrimitive)return()=>0;if(p==='then')return undefined;return t[p]??(t[p]=stub());},set(t,p,v){t[p]=v;return true;},apply(){return stub();},construct(){return stub();}});
 globalThis.document=stub();globalThis.window=stub();globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 const prototype=createKaminosVolumePrototype({THREE:stub(),viewport:stub(),camera:stub(),controls:stub(),getControls:()=>({resolution:8}),onStatus(){}});
 try {
  const a=page.indexOf('  const requestedVolumePresentation ='),b=page.indexOf('  volumeBridge?.dispose?.();',a);assert.ok(a>=0&&b>a);
  new Function('params','volumePrototype','window','syncVolumePresentationControls','syncRaymarchSmokePresentationControls',page.slice(a,b))(new URLSearchParams(),prototype,{},()=>{},()=>{});
  assert.equal(prototype.debugState().volumePresentationModeEffective,'beauty');
  assert.equal(prototype.debugState().raymarchSmokePresentationModeEffective,'on');
  assert.equal(prototype.setAppearanceDecompositionMode,undefined,'retired appearance diagnostic remains callable');
 } finally {prototype.dispose();}
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
