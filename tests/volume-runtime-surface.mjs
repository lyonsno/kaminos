// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the production constructor through surface selection, before any GPU
// initialization. This establishes the DOM-free construction seam, not WebGPU
// worker compatibility or a composed frame.
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('export function createKaminosVolumePrototype(');
const end=source.indexOf('  const productTransform =',start);
const constructor=source.slice(start,end).replace('export function','function')+'return canvas;\n}';
test('caller-supplied runtime surface constructs without page globals or mounting',()=>{
 const canvas={width:16,height:16};
 const presentationSurface={canvas};
 const context={PROTOTYPE_IDENTITY:'volume',ROUTE_IDENTITY:'route'};
 vm.createContext(context);
 vm.runInContext(constructor,context);
 assert.equal(context.createKaminosVolumePrototype({presentationSurface,productFrameOwner:'caller',externalDevice:{},externalColorFormat:'rgba8unorm'}),canvas);
});

const {createBrowserVolumeSurface,createOffscreenVolumeSurface}=await import('../volume-runtime-surface.mjs');
test('offscreen surface follows applied viewport updates without DOM state',()=>{
 const canvas={width:1,height:1,getContext(){}};
 let viewport={left:3,top:4,width:100,height:80,pixelRatio:2};
 const active=[],transparent=[];let disposed=0;
 const surface=createOffscreenVolumeSurface({canvas,readViewport:()=>viewport,onActive:value=>active.push(value),onTransparent:value=>transparent.push(value),onDispose:()=>disposed++});
 surface.resize(50,40);assert.deepEqual([canvas.width,canvas.height],[50,40]);
 assert.deepEqual(surface.bounds(),{left:3,top:4,width:100,height:80});
 viewport={width:200,height:150,pixelRatio:1};assert.equal(surface.viewport().width,200);
 surface.setActive(true);surface.setActive(false);surface.setTransparent(true);surface.dispose();
 assert.deepEqual(active,[true,false]);assert.deepEqual(transparent,[true]);assert.equal(disposed,1);
 assert.equal('style' in canvas,false);assert.equal('classList' in canvas,false);
});
test('browser adapter preserves mounting, CSS size, visibility and viewport fallback',()=>{
 const classes=new Set(),mounted=[];let removed=0;
 const canvas={dataset:{},style:{},width:1,height:1,classList:{toggle(name,value){if(value)classes.add(name);else classes.delete(name);}},getBoundingClientRect:()=>({left:5,top:6,width:100,height:80}),remove(){removed++;}};
 const document={defaultView:{innerWidth:1000,innerHeight:600,devicePixelRatio:2},createElement(tag){assert.equal(tag,'canvas');return canvas;}};
 const viewport={ownerDocument:document,getBoundingClientRect:()=>({left:100,top:0,width:0,height:0}),appendChild:node=>mounted.push(node)};
 const surface=createBrowserVolumeSurface({viewport,identity:'volume',routeIdentity:'route'});
 assert.equal(mounted[0],canvas);assert.equal(canvas.dataset.routeIdentity,'route');
 assert.equal(surface.viewport().fallbackWidth,900);assert.equal(surface.viewport().pixelRatio,2);
 surface.resize(50,40);assert.equal(canvas.style.width,'100%');assert.equal(canvas.width,50);
 surface.setActive(true);assert.equal(classes.has('active'),true);
 surface.setActive(false);assert.equal(classes.size,0);surface.setTransparent(true);assert.equal(canvas.style.background,'transparent');surface.dispose();assert.equal(removed,1);
 createBrowserVolumeSurface({viewport,identity:'v',routeIdentity:'r',mount:false});assert.equal(mounted.length,1,'caller-owned frames do not append an overlay');
});
test('injected scheduler preserves its owning context and cancellation handle',()=>{
 const start=source.indexOf('export function createKaminosVolumePrototype('),end=source.indexOf('  const productTransform =',start);
 const body=source.slice(start,end).replace('export function','function')+'return {requestAnimationFrame,cancelAnimationFrame};\n}';
 const calls=[],scheduler={requestAnimationFrame(callback){assert.equal(this,scheduler);calls.push(callback);return 73;},cancelAnimationFrame(handle){assert.equal(this,scheduler);calls.push(handle);}};
 const c={PROTOTYPE_IDENTITY:'v',ROUTE_IDENTITY:'r'};vm.createContext(c);vm.runInContext(body,c);
 const runtime=c.createKaminosVolumePrototype({presentationSurface:{canvas:{}},frameScheduler:scheduler});
 const callback=()=>{};assert.equal(runtime.requestAnimationFrame(callback),73);runtime.cancelAnimationFrame(73);assert.deepEqual(calls,[callback,73]);
});

test('production resize uses host viewport and capture extent without page globals',()=>{
 const canvas={width:1,height:1,getContext(){}};let viewport={width:120,height:60,pixelRatio:2};
 const surface=createOffscreenVolumeSurface({canvas,readViewport:()=>viewport});
 const state={},c={canvas,surface,state,controlsSnapshot:{renderScale:.5},getPresentationSize:()=>null,boundarySplatRequested:()=>true,normalizeRenderScale:value=>value,browserResidualCanApply:()=>false,frameTextureSize:'old',browserResidualFeatureTextureSize:'old'};
 vm.createContext(c);
 const start=source.indexOf('  function resize() {'),end=source.indexOf('\n  function ensureFrameTexture()',start);
 assert.ok(start>0&&end>start);vm.runInContext(source.slice(start,end),c);c.resize();
 assert.deepEqual([canvas.width,canvas.height],[120,60]);assert.equal(state.displayWidth,240);assert.equal(state.renderScale,.5);
 c.getPresentationSize=()=>({width:40,height:20});c.resize();assert.deepEqual([canvas.width,canvas.height],[20,10]);assert.equal(state.canvasDevicePixelRatio,1,'explicit capture extent is backing pixels');
 c.getPresentationSize=()=>null;viewport={width:0,height:0,fallbackWidth:80,fallbackHeight:50,pixelRatio:1};c.resize();assert.deepEqual([canvas.width,canvas.height],[40,25]);assert.equal(state.viewportSizeFallback,true);
});
