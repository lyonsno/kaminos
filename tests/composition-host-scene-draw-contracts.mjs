// kaminos-test: node — actual page installation and foreground consumer receipt
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createSceneFrameComposition} from '../scene-frame-composition.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('  const frameComposition=createSceneFrameComposition('),end=html.indexOf('  let sceneFrameCount',start);
const hostStart=html.indexOf('  compositionHost = {'),hostEnd=html.indexOf('    async presentGlb(',hostStart);
assert.ok(start>0&&end>start&&hostStart>0&&hostEnd>hostStart);
function host({draws}){
 const context={createSceneFrameComposition,sceneFrameCount:7,sceneLightingPreparation:null,
  exclusiveInspectionRender:false,manualInspectionRender:false,authoredWaterFlameTransportActive:false,authoredFlameHDRActive:false,
  window:{__kaminosSceneRadiance:{canRender:()=>draws}},renderer:{backend:{device:{}}},
  syncViewportRendererSize(){},camera:{updateMatrixWorld(){}},fireLightFieldPass:null,
  drawSceneFrame(){context.sceneFrameCount++;}};
 vm.runInNewContext(html.slice(start,end)+html.slice(hostStart,hostEnd)+'};',context);
 context.compositionHost.setForegroundServiceActive(true);
 return context.compositionHost;
}
const drawn=host({draws:true}),a=drawn.runForegroundFrame(()=>({ok:1}));
assert.equal(a.sceneDrawn,true);assert.equal(a.sceneFrameCountBefore,7);assert.equal(a.sceneFrameCountAfter,8);
assert.equal(a.sceneAuthority,'three-render-returned-inside-service-not-presentation');
const skipped=host({draws:false}),b=skipped.runForegroundFrame(()=>({ok:1}));
assert.equal(b.sceneDrawn,false,'a skipped draw must not read as a new scene frame');
assert.equal(b.sceneFrameCountBefore,b.sceneFrameCountAfter);
assert.notEqual(b.sceneAuthority,'three-render-returned-inside-service-not-presentation');
console.log('composition host scene-draw contracts passed');
