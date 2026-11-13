// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {createKaminosVolumePrototype} from '../volume-core.js';
import {createBrowserVolumeSurface,createOffscreenVolumeSurface} from '../volume-runtime-surface.mjs';

// Import the complete production constructor. Scheduling and resize also have
// isolated CPU checks below; no test here establishes native GPU compatibility.
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
test('complete production runtime constructs and disposes without page globals or GPU admission',async()=>{
 assert.equal(typeof document,'undefined');assert.equal(typeof window,'undefined');
 const canvas={width:16,height:16,getContext(){throw Error('unexpected GPU admission');}};
 const transparency=[];let disposed=0;
 const presentationSurface=createOffscreenVolumeSurface({canvas,readViewport:()=>({width:32,height:32}),onTransparent:value=>transparency.push(value),onDispose:()=>disposed++});
 const runtime=createKaminosVolumePrototype({THREE,camera:new THREE.PerspectiveCamera(),getControls:()=>({resolution:16}),presentationSurface,
   transparentCanvas:true,frameScheduleOwner:'host',frameScheduler:{requestAnimationFrame(){throw Error('unexpected frame admission');},cancelAnimationFrame(){}}});
 assert.equal(runtime.canvasElement(),canvas);assert.equal(runtime.isActive(),false);
 assert.deepEqual(transparency,[true]);runtime.setSceneCompositionPresentation(false);assert.deepEqual(transparency,[true,false]);
 assert.equal(runtime.debugState().active,false);
 assert.equal(runtime.debugState().frameScheduleOwner,'host');assert.equal(runtime.renderSharedFrame().reason,'inactive');
 assert.throws(()=>createKaminosVolumePrototype({frameScheduleOwner:'unknown'}),/unsupported-volume-frame-schedule-owner/);
 await runtime.dispose();assert.equal(disposed,1);
});

test('offscreen viewport rejects missing or nonfinite host measurements explicitly',()=>{
 const canvas={width:1,height:1,getContext(){}};let viewport=null;
 const surface=createOffscreenVolumeSurface({canvas,readViewport:()=>viewport});
 for(const value of [null,{}, {width:NaN,height:8},{width:8,height:-1},{width:8,height:8,pixelRatio:0}]){
   viewport=value;assert.throws(()=>surface.viewport(),/invalid offscreen viewport/);assert.throws(()=>surface.bounds(),/invalid offscreen viewport/);
 }
 viewport={width:0,height:0,fallbackWidth:20,fallbackHeight:10};
 assert.deepEqual(surface.bounds(),{left:0,top:0,width:0,height:0});assert.equal(surface.viewport().pixelRatio,1);
});

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
 assert.equal(mounted[0],canvas);assert.equal(canvas.id,'kaminos-volume-canvas');assert.equal(canvas.dataset.routeIdentity,'route');
 assert.equal(surface.viewport().fallbackWidth,900);assert.equal(surface.viewport().pixelRatio,2);
 document.defaultView.devicePixelRatio=.8;assert.equal(surface.viewport().pixelRatio,.8,'receipt reports the positive host pixel ratio without applying render policy');
 surface.resize(50,40);assert.equal(canvas.style.width,'100%');assert.equal(canvas.width,50);
 surface.setActive(true);assert.equal(classes.has('active'),true);
 surface.setActive(false);assert.equal(classes.size,0);surface.setTransparent(true);assert.equal(canvas.style.background,'transparent');surface.dispose();assert.equal(removed,1);
 createBrowserVolumeSurface({viewport,identity:'v',routeIdentity:'r',mount:false});assert.equal(mounted.length,1,'caller-owned frames do not append an overlay');
});
test('injected scheduler preserves its owning context and cancellation handle',()=>{
 const start=source.indexOf('export function createKaminosVolumePrototype('),end=source.indexOf('  const productTransform =',start);
 const body=source.slice(start,end).replace('export function','function')+'return {requestAnimationFrame,cancelAnimationFrame};\n}';
 const calls=[],scheduler={requestAnimationFrame(callback){assert.equal(this,scheduler);calls.push(callback);return 73;},cancelAnimationFrame(handle){assert.equal(this,scheduler);calls.push(handle);}};
 const c={PROTOTYPE_IDENTITY:'v',ROUTE_IDENTITY:'r',getControls:()=>({}),stripRetiredRaymarchControls:controls=>({controls}),integralReconstructionSettings:()=>({}),rayHistorySettings:()=>({})};vm.createContext(c);vm.runInContext(body,c);
 const runtime=c.createKaminosVolumePrototype({getControls:()=>({}),presentationSurface:{canvas:{},setTransparent(){}},frameScheduler:scheduler});
 const callback=()=>{};assert.equal(runtime.requestAnimationFrame(callback),73);runtime.cancelAnimationFrame(73);assert.deepEqual(calls,[callback,73]);
 const host=c.createKaminosVolumePrototype({getControls:()=>({}),presentationSurface:{canvas:{},setTransparent(){}},frameScheduler:scheduler,frameScheduleOwner:'host'});
 assert.equal(host.requestAnimationFrame(callback),0,'the scene host owns frame cadence');assert.deepEqual(calls,[callback,73]);
});

test('production resize uses host viewport and capture extent without page globals',()=>{
 const canvas={width:1,height:1,getContext(){}};let viewport={width:120,height:60,pixelRatio:2};
 const surface=createOffscreenVolumeSurface({canvas,readViewport:()=>viewport});
 const state={},c={canvas,surface,state,controlsSnapshot:{renderScale:.5},getPresentationSize:()=>null,boundarySplatRequested:()=>true,normalizeRenderScale:value=>value,browserResidualCanApply:()=>false,frameTextureSize:'old',browserResidualFeatureTextureSize:'old'};
 vm.createContext(c);
 const start=source.indexOf('  function resize() {'),end=source.indexOf('\n  function ensureFrameTexture()',start);
 assert.ok(start>0&&end>start);vm.runInContext(source.slice(start,end),c);c.resize();
 assert.deepEqual([canvas.width,canvas.height],[60,30]);assert.equal(state.displayWidth,120);assert.equal(state.renderScale,.5);
 c.getPresentationSize=()=>({width:40,height:20});c.resize();assert.deepEqual([canvas.width,canvas.height],[20,10]);assert.equal(state.canvasDevicePixelRatio,1,'explicit capture extent is backing pixels');
 c.getPresentationSize=()=>null;viewport={width:0,height:0,fallbackWidth:80,fallbackHeight:50,pixelRatio:1};c.resize();assert.deepEqual([canvas.width,canvas.height],[40,25]);assert.equal(state.viewportSizeFallback,true);
});

test('complete browser runtimes retain independent fire-unit canvas identities',async()=>{
 const mounted=[],runtimes=[];
 const document={createElement(tag){assert.equal(tag,'canvas');const canvas={dataset:{},style:{},classList:{toggle(){}},getContext(){throw Error('unexpected GPU admission');},remove(){mounted.splice(mounted.indexOf(canvas),1);}};return canvas;}};
 const viewport={ownerDocument:document,appendChild:canvas=>mounted.push(canvas)};
 try{
  for(const canvasId of ['kaminos-fire-unit-A','kaminos-fire-unit-B']){
   const runtime=createKaminosVolumePrototype({THREE,viewport,canvasId,camera:new THREE.PerspectiveCamera(),getControls:()=>({resolution:16}),frameScheduleOwner:'host',frameScheduler:{requestAnimationFrame(){throw Error('unexpected frame admission');},cancelAnimationFrame(){}}});
   runtimes.push(runtime);assert.equal(runtime.canvasElement().id,canvasId);
  }
  assert.equal(new Set(mounted.map(canvas=>canvas.id)).size,2);assert.equal(mounted.some(canvas=>canvas.id==='kaminos-volume-canvas'),false,'unit canvases must not impersonate the primary volume');
 }finally{for(const runtime of runtimes)await runtime.dispose();}
 assert.equal(mounted.length,0);
});
