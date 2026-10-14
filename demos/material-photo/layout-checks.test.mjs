import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as checks from './layout-checks.js';
const {validateLayoutFrame}=checks;
test('layout witness rejects hidden views, clipped captions, overflow and blocked controls',()=>{
  const frame={width:1440,stage:{height:600},overflow:false,tuningHit:true,runHit:true,
    tiles:['original','photo','relit','materials'].map(mode=>({mode,bottom:600,surface:{width:350,height:550,right:1400,bottom:550},label:{top:550,bottom:582}}))};
  assert.doesNotThrow(()=>validateLayoutFrame(frame));
  for(const change of [f=>{f.tiles.pop();},f=>{f.tiles[0].surface.height=0;},f=>{f.tiles[0].label.top=540;},f=>{f.overflow=true;},f=>{f.runHit=false;},f=>{f.tuningHit=false;}]){
    const bad=structuredClone(frame);change(bad);assert.throws(()=>validateLayoutFrame(bad));
  }
});
test('open tuning must expose a usable control, not merely an unobstructed toggle',()=>{
  const frame={width:667,stage:{height:180},overflow:false,tuningHit:true,runHit:true,open:true,giHit:false,
    tiles:['original','photo','relit','materials'].map(mode=>({mode,bottom:300,surface:{width:100,height:100,right:600,bottom:250},label:{top:250,bottom:282}}))};
  assert.throws(()=>validateLayoutFrame(frame),/tuning/);
});
test('browser source admission rejects missing and altered loaded modules',()=>{
  assert.equal(typeof checks.validateBrowserSources,'function','closing source identity must come from loaded browser responses');
  const expected={'main.js':'main','viewer.js':'viewer','style.css':'css'};
  assert.doesNotThrow(()=>checks.validateBrowserSources({...expected,'extra.js':'extra'},expected));
  assert.throws(()=>checks.validateBrowserSources({...expected,'viewer.js':'old'},expected),/viewer/);
  assert.throws(()=>checks.validateBrowserSources({'main.js':'main'},expected),/viewer/);
});
test('mounted and browser agreement cannot admit a different source revision',()=>{
  const expected={'main.js':'main','viewer.js':'viewer','style.css':'css'};
  assert.doesNotThrow(()=>checks.validateBrowserSources({...expected,'extra.js':'extra'},{...expected,'extra.js':'extra'},expected));
  const stale={...expected,'viewer.js':'old'};
  assert.throws(()=>checks.validateBrowserSources(stale,stale,expected),/viewer/);
  assert.throws(()=>checks.validateBrowserSources(expected,stale,expected),/viewer/);
  assert.throws(()=>checks.validateBrowserSources(expected,{'main.js':'main'},expected),/viewer/);
});
