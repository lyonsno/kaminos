// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import * as values from '../volume-runtime-control-values.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/volume-runtime-controls/initial-page-route-3a1.json',import.meta.url),'utf8'));
test('shared initial route preserves the actual prior selected-worker page coefficients',()=>{
 assert.equal(typeof values.createInitialVolumeRuntimeRoute,'function','standalone worker page needs the canonical initial route without importing legacy runtime owners');
 const expected=structuredClone(fixture.route);for(const key of fixture.undefinedKeys)expected[key]=undefined;
 const first=values.createInitialVolumeRuntimeRoute();assert.deepEqual(first,expected);first.routedBonfireAblationControls.bonfireShear=0;
 assert.equal(values.createInitialVolumeRuntimeRoute().routedBonfireAblationControls.bonfireShear,1);
});
const entryUrl=new URL('../scene-worker-page-entry.mjs',import.meta.url);const entry=await import(entryUrl).catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND'||e.url!==entryUrl.href)throw e;return {};});
test('the standalone page reader preserves actual full page startup control values and light-field hash precedence',async()=>{
 assert.equal(typeof entry.readSceneWorkerPageControls,'function','new entry must read the real controls without importing the legacy runtime graph');
 const {execFileSync}=await import('node:child_process');const definitions=JSON.parse(execFileSync('python3',[new URL('../tools/scene-worker-control-definitions.py',import.meta.url).pathname,'--page',new URL('../index.html',import.meta.url).pathname])).controls;
 const controls=Object.fromEntries(Object.entries(definitions).map(([id,d])=>[id,{...d,dataset:{}}]));
 const document={getElementById:id=>controls[id]},location={search:'?scene_worker=1&volume_light_field=0',hash:'#volume_light_field=1&volume_light_field_shared_source=0'};
 const actual=entry.readSceneWorkerPageControls({document,location});
 assert.equal(actual.fireLightField,true);assert.equal(actual.canonicalSourceMode,fixture.route.routedCanonicalSourceMode);assert.equal(actual.canonicalSourceY,fixture.route.routedCanonicalSourceY);assert.equal(actual.reactionFuelScale,1);
 assert.equal(controls['volume-resolution'].value,definitions['volume-resolution'].value);
});
