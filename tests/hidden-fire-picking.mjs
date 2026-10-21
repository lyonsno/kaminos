// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function pickVisibleFlameFromViewportPointer('),source.indexOf('\nfunction viewportEventHitsInteractiveOverlay('));
const canvas={style:{opacity:'0'}};let picks=0;
const context={isSceneItemVisible:()=>true,activeSceneComposition:{},selectionCaptureSuspended:false,volumePrototype:{isActive:()=>true,canvasElement:()=>canvas},camera:{far:100,near:.01,getWorldPosition:()=>({toArray:()=>[0,0,5]})},sceneRaycaster:{ray:{origin:{toArray:()=>[0,0,5]},direction:{toArray:()=>[0,0,-1]}}},groundPlane:null,THREE:{Vector3:class{}},fireProxySync:{pick(){picks++;return {distance:1};}}};
vm.createContext(context);vm.runInContext(fn,context);
assert.equal(context.pickVisibleFlameFromViewportPointer([]),null,'A presentation-hidden flame cannot intercept the remaining body');
assert.equal(picks,0);canvas.style.opacity='1';assert.ok(context.pickVisibleFlameFromViewportPointer([]));assert.equal(picks,1);
