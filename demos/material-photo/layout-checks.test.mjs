import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateLayoutFrame} from './layout-checks.js';
test('layout witness rejects hidden views, clipped captions, overflow and blocked controls',()=>{
  const frame={width:1440,stage:{height:600},overflow:false,tuningHit:true,runHit:true,
    tiles:['original','photo','relit','materials'].map(mode=>({mode,bottom:600,surface:{width:350,height:550,right:1400,bottom:550},label:{top:550,bottom:582}}))};
  assert.doesNotThrow(()=>validateLayoutFrame(frame));
  for(const change of [f=>{f.tiles.pop();},f=>{f.tiles[0].surface.height=0;},f=>{f.tiles[0].label.top=540;},f=>{f.overflow=true;},f=>{f.runHit=false;},f=>{f.tuningHit=false;}]){
    const bad=structuredClone(frame);change(bad);assert.throws(()=>validateLayoutFrame(bad));
  }
});
