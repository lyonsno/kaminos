// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {particleLightingOptions,particleLightingEdit,sameParticleLightField} from '../particle-lighting-controls.mjs';

test('restoring a displayed field after a failed request reuses it and invalidates obsolete work',()=>{
 const displayed=particleLightingOptions({width:8,transportWidth:8,directions:4}),failed={...displayed,width:65536};
 const edit=particleLightingEdit(failed,displayed,{width:8});
 assert.equal(edit.fieldChanged,true,'obsolete failed or pending request must be superseded');
 assert.equal(edit.usesDisplayedField,true);
 assert.equal(edit.requiresBuild,false,'restoring the actual displayed field must not solve it again');
});
test('display edits do not repeat a failed field solve; an explicit field retry can',()=>{
 const displayed=particleLightingOptions(),failed={...displayed,width:65536};
 assert.equal(particleLightingEdit(failed,displayed,{exposure:-3}).requiresBuild,false);
 assert.equal(particleLightingEdit(failed,displayed,{width:65536}).requiresBuild,true);
 for(const patch of [{albedo:.2},{mode:0},{exposure:2}]){
  const edit=particleLightingEdit(displayed,displayed,patch);
  assert.equal(edit.usesDisplayedField,true);assert.equal(edit.requiresBuild,false);
 }
});
test('field equality and validation preserve independent optical and sampling controls',()=>{
 const baseline=particleLightingOptions();
 for(const [key,value] of [['width',32],['transportWidth',17],['directions',48],['filterLength',.25]]){
  const edit=particleLightingEdit(baseline,baseline,{[key]:value});
  assert.equal(edit.requiresBuild,true);assert.equal(edit.usesDisplayedField,false);assert.equal(edit.settings[key],value);
 }
 for(const patch of [{width:9},{directions:3},{transportWidth:2.5},{filterLength:-1},{albedo:2},{mode:3},{exposure:Infinity}])assert.throws(()=>particleLightingEdit(baseline,baseline,patch));
 assert.equal(sameParticleLightField(baseline,null),false);
 assert.equal(particleLightingEdit(baseline,null,{}).usesDisplayedField,false);
});
