import assert from 'node:assert/strict';

export function assertGlossySourceEvidence(glossy,{samples=12}={}){
 assert.ok(Number.isSafeInteger(samples)&&samples>0,'requested capture count must be a positive integer');
 for(const arm of [glossy.small,glossy.broad]){
  assert.equal(arm.frames.length,samples,'all requested glossy captures must be retained');
  let previous=arm.before;
  assert.ok(Number.isSafeInteger(previous?.frame),'fresh reflection frame requires an initial counter');
  assert.ok(Number.isSafeInteger(previous?.pyramid),'fresh source-pyramid frame requires an initial counter');
  for(const frame of arm.frames){
   assert.equal(frame.frame,previous.frame+1,'each capture requires a fresh reflection frame');
   assert.equal(frame.pyramid,previous.pyramid+1,'each capture requires a fresh source-pyramid frame');
   previous=frame;
  }
 }
 assert.ok(glossy.small.sourcePeak>=4000&&glossy.broad.sourcePeak>=4000,'full HDR sources retain small and broad bright emitters');
 assert.ok(glossy.small.peak<glossy.small.sourcePeak*.125,'glossy ray footprints must filter isolated sub-footprint HDR highlights');
 assert.ok(glossy.broad.peak>glossy.broad.sourcePeak*.25,'broad bright reflections must survive without an HDR clamp');
}
