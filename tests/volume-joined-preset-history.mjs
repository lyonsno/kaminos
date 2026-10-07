import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {migrateRetiredVolumeSettingsPresetDocument} from '../volume-retired-control-migration.mjs';
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const old=JSON.parse(execFileSync('git',['show','62b17192:volume-settings-preset-schema-v2.json'],{encoding:'utf8'}));
function fixture() {
  const domControls={}, route=new URL('http://kaminos.invalid/');
  for(const c of old.controls) {
    const value=c.key==='volume-domain-shape'?'cube':c.key==='volume-outer-resolution'?'48':c.additiveDefault??c.allowedValues?.[0]??0;
    domControls[c.key]={id:c.key,param:c.param,tagName:c.tagName,type:c.type,value};route.searchParams.set(c.param,String(value));
  }
  return {controlCount:old.controlCount,preset:{controlCount:old.controlCount,domControls,route:route.href}};
}
test('the exercised outer branch inventory composes with the landed emitter additions without resetting cube/grid',()=>{
  const result=migrateRetiredVolumeSettingsPresetDocument(fixture(),schema);
  assert.equal(result.document.preset.controlCount,schema.controlCount);
  assert.equal(result.document.preset.domControls['volume-domain-shape'].value,'cube');
  assert.equal(result.document.preset.domControls['volume-outer-resolution'].value,'48');
  assert.equal(result.document.preset.domControls['volume-velocity-staggering'].value,'collocated');
  assert.equal(result.document.preset.domControls['volume-heat-release-expansion'].value,0);
});
test('an incomplete historical inventory is not accepted as the known branch',()=>{
  const bad=fixture();delete bad.preset.domControls['volume-time-step'];
  bad.controlCount--;bad.preset.controlCount--;
  assert.throws(()=>migrateRetiredVolumeSettingsPresetDocument(bad,schema));
});
