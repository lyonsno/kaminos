// kaminos-test: node
import test from 'node:test';
import {createSceneFrameComposition} from '../scene-frame-composition.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const a=page.indexOf('    const localWaterActive = waterFeature.active;');
const b=page.indexOf('  compositionHost = {',a);
assert.ok(a>0&&b>a,'actual animation admission block');

test('a skipped ordinary draw retains invalidation until a frame can render',()=>{
 let held=true,draws=0;
 const context={waterFeature:{active:false},needsRender:true,idleFrames:0,IDLE_THRESHOLD:3,
  motionAgencyActive:false,motionDecisionActive:false,motionPhraseControlActive:false,motionTrackActive:false,
  motionOutputMapActive:false,motionTemporalActive:false,forgeHostActive:false,volumeBridgeActive:false,fireLightFieldActive:false,
  foregroundServiceActive:false,mainRendererNeeded:true,sceneRenderedForVolume:false,
  sceneGI:{requestHistoryFrames(){},needsHistoryFrame:()=>false},
  renderSceneFrame(){if(held)return false;draws++;return true;}};
 context.frameComposition=createSceneFrameComposition({readInputs:()=>({radianceReady:!held}),draw:()=>context.renderSceneFrame(),frameCount:()=>draws});
 vm.runInNewContext('function tick(){'+page.slice(a,b)+';tick();',context);
 assert.equal(draws,0);
 assert.equal(context.needsRender,true,'a skipped draw has not consumed the requested redraw');
 assert.equal(context.idleFrames,0,'a held draw does not count as an idle rendered frame');
 held=false;context.tick();
 assert.equal(draws,1);assert.equal(context.needsRender,false);
});

function fixture(){
 let count=7,prepares=0;
 const input={};const observed=[];
 const owner=createSceneFrameComposition({readInputs:()=>input,frameCount:()=>count,
  prepare:()=>prepares++,draw:()=>{observed.push(owner.transportFrame);count++;}});
 return {owner,input,observed,count:()=>count,prepares:()=>prepares};
}
for(const [property,reason] of [['lightingHeld','lighting-preparation'],['exclusiveInspection','exclusive-inspection'],['transportRequired','transport-not-supplied']]){
 test(`${reason} gates ordinary, depth and foreground drawing consistently`,()=>{
  const f=fixture();f.input[property]=true;
  assert.equal(f.owner.renderOrdinary(),false);assert.equal(f.owner.renderDepth(),false);
  f.owner.setForegroundServiceActive(true);
  const result=f.owner.runForegroundFrame(()=>({submitted:true}));
  assert.equal(result.sceneDrawn,false);assert.equal(result.sceneFrameCountBefore,7);assert.equal(result.sceneFrameCountAfter,7);
  assert.equal(f.owner.state().lastBlockedReason,reason);
  f.owner.setForegroundServiceActive(false);f.input[property]=false;
  assert.equal(f.owner.renderOrdinary(),true);assert.equal(f.count(),8);
 });
}
test('manual inspection overrides only exclusive inspection, never lighting or transport holds',()=>{
 const f=fixture();f.input.exclusiveInspection=true;f.input.manualInspection=true;
 assert.equal(f.owner.render(),true);
 f.input.lightingHeld=true;assert.equal(f.owner.render(),false);
 f.input.lightingHeld=false;f.input.transportRequired=true;assert.equal(f.owner.render(),false);
});
test('transport scope reaches depth and restores after nested scopes and failed callbacks',()=>{
 const f=fixture();f.input.transportRequired=true;const outer={},inner={};
 assert.equal(f.owner.renderDepth(),false);
 f.owner.withTransport(outer,()=>{
  assert.equal(f.owner.renderDepth(),true);
  assert.throws(()=>f.owner.withTransport(inner,()=>{assert.equal(f.owner.render(),true);throw Error('consumer failed');}),/consumer failed/);
  assert.equal(f.owner.transportFrame,outer);
 });
 assert.equal(f.owner.transportFrame,null);assert.deepEqual(f.observed,[outer,inner]);
});
test('ordinary RAF consumes one successful depth draw without rendering twice',()=>{
 const f=fixture();assert.equal(f.owner.renderDepth(),true);
 assert.equal(f.owner.renderOrdinary(),true);assert.equal(f.count(),8);
 assert.equal(f.owner.renderOrdinary(),true);assert.equal(f.count(),9);
});
test('foreground scope excludes ordinary draw, counts its own depth draw, and releases after errors',()=>{
 const f=fixture();assert.throws(()=>f.owner.runForegroundFrame(()=>{}),/invalid/);
 f.owner.setForegroundServiceActive(true);assert.equal(f.owner.renderOrdinary(),false);
 const receipt=f.owner.runForegroundFrame(()=>{
  assert.throws(()=>f.owner.runForegroundFrame(()=>{}),/invalid/);
  assert.equal(f.owner.renderDepth(),true);return {submitted:true};
 });
 assert.equal(receipt.sceneDrawn,true);assert.equal(receipt.sceneFrameCountAfter,8);assert.equal(f.prepares(),0);
 assert.throws(()=>f.owner.runForegroundFrame(()=>{throw Error('submission failed');}),/submission failed/);
 assert.equal(f.owner.state().insideService,false);
 f.input.radianceReady=false;
 const skipped=f.owner.runForegroundFrame(()=>({submitted:true}));
 assert.equal(skipped.sceneDrawn,false);assert.equal(skipped.sceneFrameCountAfter,8);
 f.owner.setForegroundServiceActive(false);assert.equal(f.owner.renderOrdinary(),false,'prior service depth cannot satisfy a later RAF');
 f.input.radianceReady=true;assert.equal(f.owner.renderOrdinary(),true);assert.equal(f.count(),9);
});
