// kaminos-test: node
import assert from 'node:assert/strict';
import {forwardCompositionHash} from '../scene-authoring.mjs';
import {environmentResourceModeFromSearch} from '../scene-environment-loader.mjs';
import {buildVolumeSettingsPresetTarget,buildVolumeSettingsPresetVisualTarget,validateVolumeSettingsPresetTarget,validateVolumeSettingsPresetVisualTarget} from '../volume-settings-preset-contract.mjs';
const receipt={presetId:'vsp-'+ '1'.repeat(64),sourcePresetAuthority:'shared-volume-settings-preset-v2',routeEntries:[['kaminos_volume_smoke','1'],['volume_steps','1']],routeVolumeEntries:[['volume_steps','1']]};
for(const [target,validate]of [[buildVolumeSettingsPresetTarget(receipt,'http://localhost'),validateVolumeSettingsPresetTarget],[buildVolumeSettingsPresetVisualTarget(receipt,'http://localhost','raymarch-only'),validateVolumeSettingsPresetVisualTarget]]){
 const forwarded=new URL(forwardCompositionHash(target,'#scene=saved.kaminos.json','?environment_resources=off'));
 assert.equal(validate(receipt,forwarded.searchParams),true);
 assert.equal(environmentResourceModeFromSearch(forwarded.search),'none');
 const malformed=new URL(forwarded);malformed.searchParams.set('environment_resources','of');assert.throws(()=>validate(receipt,malformed.searchParams),/environment_resources/);
 const duplicate=new URL(forwarded);duplicate.searchParams.append('environment_resources','on');assert.throws(()=>validate(receipt,duplicate.searchParams),/environment_resources/);
 const tampered=new URL(forwarded);tampered.searchParams.set('volume_steps','999');assert.throws(()=>validate(receipt,tampered.searchParams),/settings route mismatch/);
}
