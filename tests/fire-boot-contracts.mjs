// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {fireAtBoot} from '../fire-boot.mjs';
const q=s=>new URLSearchParams(s);

test('an ordinary page starts without the fluid simulation',()=>{
 for(const s of ['','?workspace=authoring','?workspace=workbench','?asset=foo.glb']) assert.equal(fireAtBoot(q(s)).boot,false,s);
});

test('a URL that asks for fire still gets it',()=>{
 for(const s of ['?settings_preset=vsp-abc','?kaminos_volume_smoke=1','?volume_resolution=64','?volume_scene=tall_plume&x=1','?fire=on'])
  assert.equal(fireAtBoot(q(s)).boot,true,s);
 assert.equal(fireAtBoot(q('?settings_preset=vsp-abc')).reason,'settings_preset');
});

test('fire=off wins over any fire intent',()=>{
 assert.deepEqual(fireAtBoot(q('?settings_preset=vsp-abc&fire=off')),{boot:false,reason:'fire=off'});
});

test('fire without a named recipe uses the semantic flame basin, Noah’s smokeyfuckinkilndemo',async()=>{
 const {SEMANTIC_FLAME_BASIN}=await import('../fire-boot.mjs');
 assert.deepEqual(fireAtBoot(q('?fire=on')),{boot:true,reason:'fire=on',basin:SEMANTIC_FLAME_BASIN.url});
 assert.equal(fireAtBoot(q('?settings_preset=vsp-abc')).basin,undefined,'a named recipe keeps its own basin');
 const {readFileSync}=await import('node:fs');
 const artifact=JSON.parse(readFileSync(new URL('../'+SEMANTIC_FLAME_BASIN.url.replace(/^\.\//,''),import.meta.url)));
 assert.equal(artifact.identity,'kaminos-volume-settings-preset-artifact-v2');
 assert.equal(artifact.presetId,SEMANTIC_FLAME_BASIN.presetId);assert.equal(artifact.contentHash,`sha256:${artifact.presetId.slice(4)}`);
 assert.equal(artifact.initialLabel,'smokeyfuckinkilndemo-basin');
 assert.equal(artifact.preset.domControls['volume-resolution'].value,'64');
});

test('a saved-scene address boots the fluid, since the scene may hold fire',()=>{
 assert.deepEqual(fireAtBoot(new URLSearchParams(''),new URLSearchParams('authoring=1&scene=saved.json')),{boot:true,reason:'saved scene'});
 assert.equal(fireAtBoot(new URLSearchParams('fire=off'),new URLSearchParams('scene=saved.json')).boot,false,'fire=off still wins');
 assert.equal(fireAtBoot(new URLSearchParams(''),new URLSearchParams('authoring=1')).boot,false,'an empty Authoring page stays without fluid');
});
