// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateVolumeSettingsPresetDocument,validateVolumeSettingsPresetTarget,buildVolumeSettingsPresetTarget} from '../volume-settings-preset-contract.mjs';
import {projectFireSettingsToSchema} from '../scene-fire-domain.mjs';
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const observed=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url))).settings;

// Local historical-policy replay derived from observed scene controls, not a
// claim that this generated preset is an observed operator preset artifact.
function historicalPreset(){
 const settings=structuredClone(observed);
 settings.domControls['volume-appearance-model'].value='shred-only';
 // This replay isolates DOM history; renderer defaults arrive through the
 // existing server/scene schema projection before public preset validation.
 settings.rendererControls=projectFireSettingsToSchema(observed,schema).rendererControls;
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


test('saved targets predating the ambient controls inherit only the document-migrated defaults',()=>{
 const doc=historicalPreset(),receipt=validateVolumeSettingsPresetDocument(doc,doc.presetId,schema),target=buildVolumeSettingsPresetTarget(receipt,'http://kaminos.invalid');
 const params=schema.controls.filter(c=>c.additiveLineage==='ambient-boundary').map(c=>c.param);for(const key of params)target.searchParams.delete(key);
 assert.equal(validateVolumeSettingsPresetTarget(receipt,target.searchParams),true,'the old URL must reach the volume after validated default migration');
 assert.equal(target.searchParams.has(params[0]),false,'validation does not rewrite the caller URL');
 const conflict=new URL(target);conflict.searchParams.set(params[0],'10');assert.throws(()=>validateVolumeSettingsPresetTarget(receipt,conflict.searchParams),/route mismatch for volume_ambient_boundary_width/);
 const duplicate=new URL(target);duplicate.searchParams.append(params[0],'');duplicate.searchParams.append(params[0],'');assert.throws(()=>validateVolumeSettingsPresetTarget(receipt,duplicate.searchParams),/route mismatch for volume_ambient_boundary_width/);
 const missingAuthored=new URL(target);missingAuthored.searchParams.delete('volume_pressure_solver');assert.throws(()=>validateVolumeSettingsPresetTarget(receipt,missingAuthored.searchParams),/route mismatch for volume_pressure_solver/);
 const wrongAuthority=new URL(target);wrongAuthority.searchParams.set('settings_preset_authority','other');assert.throws(()=>validateVolumeSettingsPresetTarget(receipt,wrongAuthority.searchParams),/authority mismatch/);
});
test('current saved targets cannot omit an authored ambient control',()=>{
 const old=historicalPreset(),migrated=validateVolumeSettingsPresetDocument(old,old.presetId,schema),doc={...old,preset:structuredClone(migrated.preset),controlCount:schema.controlCount};
 const receipt=validateVolumeSettingsPresetDocument(doc,doc.presetId,schema),target=buildVolumeSettingsPresetTarget(receipt,'http://kaminos.invalid');target.searchParams.delete('volume_ambient_boundary_width');
 assert.throws(()=>validateVolumeSettingsPresetTarget(receipt,target.searchParams),/route mismatch for volume_ambient_boundary_width/);
});

test('server-projected defaults keep an older target loadable without admitting authored omissions',()=>{
 const old=historicalPreset(),migrated=validateVolumeSettingsPresetDocument(old,old.presetId,schema),doc={...old,preset:structuredClone(migrated.preset),controlCount:schema.controlCount};
 const additions=schema.controls.filter(c=>c.additiveLineage==='ambient-boundary');
 // Observed server API at5b7cde8cd projects the document before page validation,
 // carrying these IDs in schemaProjection.defaultsApplied rather than re-running
 // the client's retirement migration. The exact response/replay is retained in
 // the ambient-boundary implementation account; this fixture tests local policy.
 doc.schemaProjection={identity:'kaminos-volume-settings-schema-projection-v1',defaultsApplied:additions.map(c=>c.key)};
 let receipt=validateVolumeSettingsPresetDocument(doc,doc.presetId,schema),target=buildVolumeSettingsPresetTarget(receipt,'http://kaminos.invalid');
 assert.equal(receipt.retirementMigration.applied,false,'exercise the actual server-projected route');for(const c of additions)target.searchParams.delete(c.param);
 assert.equal(validateVolumeSettingsPresetTarget(receipt,target.searchParams),true);
 const inconsistent=structuredClone(doc);inconsistent.preset.domControls[additions[0].key].value='2';const route=new URL(inconsistent.preset.route);route.searchParams.set(additions[0].param,'2');inconsistent.preset.route=route.href;
 receipt=validateVolumeSettingsPresetDocument(inconsistent,inconsistent.presetId,schema);assert.throws(()=>validateVolumeSettingsPresetTarget(receipt,target.searchParams),/route mismatch for volume_ambient_boundary_width/,'a projection tag cannot admit omission of a nondefault value');
 const unknown=structuredClone(doc);unknown.schemaProjection.identity='unknown';receipt=validateVolumeSettingsPresetDocument(unknown,unknown.presetId,schema);assert.throws(()=>validateVolumeSettingsPresetTarget(receipt,target.searchParams),/route mismatch for volume_ambient_boundary_width/);
});
