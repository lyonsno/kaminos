// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {VOLUME_SETTINGS_PRESET_VISUAL_VIEWS,buildVolumeSettingsPresetVisualTarget,validateVolumeSettingsPresetVisualTarget,validateVolumeSettingsPresetTarget} from '../volume-settings-preset-contract.mjs';
const receipt={presetId:'vsp-test',sourcePresetAuthority:'shared-volume-settings-preset-v2',routeEntries:[['kaminos_volume_smoke','1'],['volume_resolution','8'],['volume_raymarch_smoke','off']],routeVolumeEntries:[['volume_resolution','8'],['volume_raymarch_smoke','off']]};
test('saved preset inspection reaches the retained cockpit with every saved value',()=>{
 assert.deepEqual(Object.keys(VOLUME_SETTINGS_PRESET_VISUAL_VIEWS),['raymarch-only']);
 const target=buildVolumeSettingsPresetVisualTarget(receipt,'http://localhost','raymarch-only');
 assert.equal(target.pathname,'/');assert.equal(target.searchParams.get('kaminos_volume_smoke'),'1');assert.equal(target.searchParams.get('volume_resolution'),'8');assert.equal(target.searchParams.get('volume_raymarch_smoke'),'off');
 assert.equal(validateVolumeSettingsPresetTarget(receipt,target.searchParams),true);assert.equal(validateVolumeSettingsPresetVisualTarget(receipt,target.searchParams),true);
 const changed=new URL(target);changed.searchParams.set('volume_resolution','16');assert.throws(()=>validateVolumeSettingsPresetVisualTarget(receipt,changed.searchParams));
});
test('retired preset renderers and their diagnostic toolbar cannot be selected',()=>{
 for(const view of ['splat-only','smoke-hybrid','full-hybrid-diagnostic'])assert.throws(()=>buildVolumeSettingsPresetVisualTarget(receipt,'http://localhost',view));
 assert.throws(()=>buildVolumeSettingsPresetVisualTarget(receipt,'http://localhost','raymarch-only',{assayToolbar:true}));
});
