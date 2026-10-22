// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.includes('function sceneViewerPlaybackState(')?source.indexOf('function sceneViewerPlaybackState('):source.indexOf('function syncVolumeViewerPlay('),end=source.indexOf('function refreshVolumeReadout()',start);
assert.ok(start>=0&&end>start);
for(const fire of [true,false])for(const water of [true,false]) {
 const listeners={},pauseGlyph={style:{}},playGlyph={style:{}};
 const button={hidden:true,dataset:{},setAttribute(k,v){this[k]=v;},querySelector(k){return k==='.pause-glyph'?pauseGlyph:playGlyph;},addEventListener(k,fn){listeners[k]=fn;}};
 const freeze={value:'0',dispatchEvent(){}};
 const context={document:{getElementById:id=>id==='volume-viewer-play'?button:id==='volume-look-freeze'?freeze:id==='kaminos-volume-canvas'?{classList:{contains:()=>fire}}:null},
  Event:class{},volumePrototype:{isActive:()=>fire,debugState:()=>({active:fire})},localLiquidHost:water?{}:null,localLiquidPaused:false,sceneViewerPaused:null,window:{}};
 context.window.kaminosPauseLocalLiquid=value=>{context.localLiquidPaused=value;};
 runInNewContext(source.slice(start,end),context);
 context.syncVolumeViewerPlay({active:fire});
 assert.equal(button.hidden,!fire&&!water,'viewport playback is visible for water alone');
 if(!fire&&!water)continue;
 listeners.click();
 assert.equal(freeze.value,'1','viewport Pause holds fire');
 if(water)assert.equal(context.localLiquidPaused,true,'viewport Pause must also hold the water');
 context.syncVolumeViewerPlay({active:fire});assert.equal(button.dataset.state,'paused');
 listeners.click();assert.equal(freeze.value,'0');if(water)assert.equal(context.localLiquidPaused,false);
 // A mixed state still offers Pause, so one action stops every moving material.
 freeze.value='1';context.localLiquidPaused=false;context.syncVolumeViewerPlay({active:fire});
 if(water){assert.equal(button.dataset.state,'playing');listeners.click();assert.equal(context.localLiquidPaused,true);}
}
console.log('viewport Pause/Play controls all active authored water and flame');
