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
