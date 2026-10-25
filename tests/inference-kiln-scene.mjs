// kaminos-test: node
import assert from 'node:assert/strict';
import {ensureKilnSceneDomain} from '../inference-kiln-scene.mjs';
const objects=[],calls=[];
const host={fire:{async add(id){calls.push(id);objects.push({id:'flame-field'});}}};
const flame={read:()=>({scene:{objects}}),saveBasin:async()=>({effective:{presetId:'vsp-test'}})};
assert.deepEqual(await ensureKilnSceneDomain(host,flame),{created:true,presetId:'vsp-test'});
assert.deepEqual(await ensureKilnSceneDomain(host,flame),{created:false});assert.deepEqual(calls,['vsp-test']);
await assert.rejects(ensureKilnSceneDomain(host,{read:()=>({scene:{objects:[]}}),saveBasin:async()=>({})}),/not retained/);
