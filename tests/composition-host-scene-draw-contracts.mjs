// kaminos-test: node — the composition host's foreground frame reports whether this request drew the scene
import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    runForegroundFrame(run) {'),end=html.indexOf('    async presentGlb(',start);
assert.ok(start>0&&end>start,'the composition host foreground frame must be present');
const method=html.slice(start,end).trim().replace(/,$/,'');
function host({draws}){
  const context={foregroundServiceActive:true,insideForegroundFrame:false,sceneRenderedForVolume:false,sceneFrameCount:7,
    syncViewportRendererSize(){},camera:{updateMatrixWorld(){}},fireLightFieldPass:null,
    renderSceneFrame(){if(!draws)return false;context.sceneFrameCount++;}};
  return {context,frame:vm.runInNewContext(`({${method}})`,context)};
}
const drawn=host({draws:true}),a=drawn.frame.runForegroundFrame(()=>({ok:1}));
assert.equal(a.sceneDrawn,true);assert.equal(a.sceneFrameCountBefore,7);assert.equal(a.sceneFrameCountAfter,8);
assert.equal(a.sceneAuthority,'three-render-returned-inside-service-not-presentation');
const skipped=host({draws:false}),b=skipped.frame.runForegroundFrame(()=>({ok:1}));
assert.equal(b.sceneDrawn,false,'a skipped draw must not read as a new scene frame');
assert.equal(b.sceneFrameCountBefore,b.sceneFrameCountAfter);
assert.notEqual(b.sceneAuthority,'three-render-returned-inside-service-not-presentation');
console.log('composition host scene-draw contracts passed');
