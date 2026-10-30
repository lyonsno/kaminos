// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateVolumeSettingsPresetDocument} from '../volume-settings-preset-contract.mjs';
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const observed=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url))).settings;

// Local historical-policy replay derived from observed scene controls, not a
// claim that this generated preset is an observed operator preset artifact.
function historicalPreset(){
 const settings=structuredClone(observed);
 for(const entry of schema.controls)if(entry.additiveLineage||entry.additiveSinceControlCount>=260)delete settings.domControls[entry.key];
 const route=new URL('http://kaminos.invalid/');
 route.searchParams.set(schema.activationParam.key,schema.activationParam.value);
 for(const axis of ['domControls','rendererControls','presentationControls'])for(const entry of Object.values(settings[axis]))route.searchParams.set(entry.param,String(entry.rawValue??entry.value));
 for(const param of schema.routeExtraParams)route.searchParams.set(param,'history-replay');
 const count=Object.keys(settings.domControls).length,hash='7'.repeat(64);
 return {identity:'kaminos-volume-settings-preset-artifact-v2',presetId:`vsp-${hash}`,contentHash:`sha256:${hash}`,schemaIdentity:schema.identity,controlCount:count,preset:{identity:'kaminos-volume-settings-preset-v2',kind:'settings-preset',schemaIdentity:schema.identity,savedAt:'2026-10-21T18:48:15Z',...settings,route:route.href,controlCount:count,rendererControlCount:Object.keys(settings.rendererControls).length,presentationControlCount:Object.keys(settings.presentationControls).length,stateExclusions:Object.fromEntries(schema.excludedStateFields.map(key=>[key,true]))}};
}
test('public preset admission preserves historical controls across independent additions',()=>{
 const doc=historicalPreset(),original=structuredClone(doc);
 const result=validateVolumeSettingsPresetDocument(doc,doc.presetId,schema);
 assert.equal(result.preset.domControls['volume-reactant-soot-yield'].value,2);
 const active=new Set(schema.controls.map(entry=>entry.key));
 for(const [id,value] of Object.entries(doc.preset.domControls))if(active.has(id))assert.deepEqual(result.preset.domControls[id],value);
 assert.deepEqual(doc,original,'migration does not rewrite source');
 assert.equal(result.presetRoute.searchParams.get('volume_reactant_soot_yield'),'2');
});
test('public preset admission still rejects an earlier missing control',()=>{
 const doc=historicalPreset();delete doc.preset.domControls['volume-pressure-solver'];
 const route=new URL(doc.preset.route);route.searchParams.delete('volume_pressure_solver');doc.preset.route=route.href;
 doc.controlCount--;doc.preset.controlCount--;
 assert.throws(()=>validateVolumeSettingsPresetDocument(doc,doc.presetId,schema),/cannot bridge additive control history at volume-pressure-solver/);
});
