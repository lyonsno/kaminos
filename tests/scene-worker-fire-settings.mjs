// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {projectFireSettingsToSchema} from '../scene-fire-domain.mjs';
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
const observed=JSON.parse(readFileSync(new URL('./fixtures/fire-scene-816e82aa1.json',import.meta.url)));
const before=JSON.parse(readFileSync(new URL('./fixtures/volume-runtime-controls/page-b99.json',import.meta.url)))[0];
const definitions=JSON.parse(execFileSync('python3',[new URL('../tools/scene-worker-control-definitions.py',import.meta.url).pathname,'--page',new URL('../index.html',import.meta.url).pathname],{encoding:'utf8'})).controls;
const path=new URL('../scene-worker-fire-settings.mjs',import.meta.url);
const api=await import(path).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===path.href)return {};throw error;});
const options={schema,definitions,mappingOptions:{route:before.route}};
test('actual observed saved fire settings map after canonical projection without fabricating persisted coefficients',()=>{
 assert.equal(typeof api.prepareSceneWorkerFireSettings,'function','actual saved fire consumer must join schema and page values');
 const saved=structuredClone(observed.settings),original=structuredClone(saved);
 const result=api.prepareSceneWorkerFireSettings(saved,options);
 assert.equal(result.controls.resolution,Number(saved.domControls['volume-resolution'].value));
 assert.equal(result.controls.volumeScene,'flame');assert.equal(result.controls.emitterAperturePattern,String(saved.domControls['volume-emitter-aperture-pattern'].value));
 assert.equal(result.controls.worldSmokeMaterial,Number(projectFireSettingsToSchema(saved,schema).domControls['volume-world-smoke-material'].value));
 assert.equal(result.controls.immersedFuel,Number(saved.domControls['volume-immersed-fuel'].value));
 assert.equal(result.presentation,'on');assert.deepEqual(saved,original);
 const bad=structuredClone(saved);delete bad.domControls['volume-density'];
 assert.throws(()=>api.prepareSceneWorkerFireSettings(bad,options),/Missing authored fire control volume-density/);
});
test('the worker uses actual page bounds and preserves continuous saved precision and retired requests',()=>{
 assert.equal(typeof api.prepareSceneWorkerFireSettings,'function');
 const saved=projectFireSettingsToSchema(observed.settings,schema);
 saved.domControls['volume-wind-strength'].value=999;
 saved.domControls['volume-immersed-centre-x'].value=7.345678901234;
 saved.domControls['volume-immersed-radius'].value=4.5678901234;
 saved.domControls['volume-immersed-fuel'].value=.7890123456789;
 saved.domControls['volume-emitter-aperture-pattern'].value='spiral';
 const result=api.prepareSceneWorkerFireSettings(saved,options);
 assert.equal(result.controls.windStrength,Number(definitions['volume-wind-strength'].max));
 assert.equal(result.controls.immersedCentreX,7.345678901234);assert.equal(result.controls.immersedRadius,4.5678901234);
 assert.equal(result.controls.immersedFuel,.7890123456789);assert.equal(result.controls.emitterAperturePattern,'spiral');
 assert.ok(result.clamps.some(row=>row.id==='volume-wind-strength'&&row.requested===999));
 const invalid=structuredClone(saved);invalid.domControls['volume-wind-model'].value='missing-model';
 assert.throws(()=>api.prepareSceneWorkerFireSettings(invalid,options),/Unsupported.*volume-wind-model/);
});

// Synthetic canonical receipts exercise this local admission policy. The real
// observed saved coefficient inventory above bears the mapping claim.
function artifact(){
 const values=projectFireSettingsToSchema(observed.settings,schema),route=new URL('http://localhost/');route.searchParams.set(schema.activationParam.key,schema.activationParam.value);
 for(const axis of ['domControls','rendererControls','presentationControls'])for(const descriptor of Object.values(values[axis]))route.searchParams.set(descriptor.param,String(descriptor.rawValue??descriptor.value));
 for(const param of schema.routeExtraParams??[])route.searchParams.set(param,'fixture');
 const hash='a'.repeat(64),preset={identity:'kaminos-volume-settings-preset-v2',kind:'settings-preset',schemaIdentity:schema.identity,
  ...values,controlCount:schema.controlCount,rendererControlCount:schema.rendererControls.length,presentationControlCount:schema.presentationControls.length,route:route.href,
  stateExclusions:Object.fromEntries((schema.excludedStateFields??[]).map(field=>[field,true]))};
 return {identity:'kaminos-volume-settings-preset-artifact-v2',presetId:'vsp-'+hash,contentHash:'sha256:'+hash,schemaIdentity:schema.identity,controlCount:schema.controlCount,preset};
}
const context=()=>{const abort=new AbortController();return {signal:abort.signal,assertCurrent:()=>abort.signal.throwIfAborted(),abort};};
test('pinned basin is validated but cannot replace authoritative saved fire coefficients',async()=>{
 assert.equal(typeof api.createSceneWorkerFireSettingsLoader,'function');const source=artifact(),calls=[],ctx=context();
 const loader=api.createSceneWorkerFireSettingsLoader({...options,fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('schema')?schema:source};}});
 const saved=projectFireSettingsToSchema(observed.settings,schema);saved.domControls['volume-immersed-fuel'].value=.4567890123;
 const result=await loader.prepare({composition:{flame:{presetId:source.presetId}},fireSettings:saved},ctx);
 assert.equal(result.controls.immersedFuel,.4567890123);assert.equal(result.source.presetId,source.presetId);
 assert.notEqual(result.source.preset.domControls['volume-immersed-fuel'].value,.4567890123);
 await loader.prepare({composition:{flame:{presetId:source.presetId}},fireSettings:saved},ctx);
 assert.equal(calls.filter(url=>url.includes('schema')).length,1,'same runtime reuses its schema');
 const wrong=api.createSceneWorkerFireSettingsLoader({...options,fetch:async url=>({ok:true,json:async()=>url.includes('schema')?schema:{...source,presetId:'vsp-'+'b'.repeat(64)}})});
 await assert.rejects(wrong.prepare({composition:{flame:{presetId:source.presetId}},fireSettings:saved},ctx),/requested\/effective identity/);
});
test('late saved settings cannot publish after replacement and failed schema acquisition can retry',async()=>{
 assert.equal(typeof api.createSceneWorkerFireSettingsLoader,'function');const ctx=context();let release,attempt=0;
 const wait=new Promise(resolve=>{release=resolve;});
 const stale=api.createSceneWorkerFireSettingsLoader({...options,fetch:async()=>{await wait;return {ok:true,json:async()=>schema};}});
 const pending=stale.prepare({fireSettings:observed.settings},ctx);ctx.abort.abort(Error('replaced'));release();await assert.rejects(pending,/replaced/);
 const retry=api.createSceneWorkerFireSettingsLoader({...options,fetch:async()=>{if(!attempt++)throw Error('offline');return {ok:true,json:async()=>schema};}});
 await assert.rejects(retry.prepare({fireSettings:observed.settings},context()),/offline/);
 assert.ok((await retry.prepare({fireSettings:observed.settings},context())).controls);
 assert.equal(await retry.prepare({composition:null,fireSettings:null},context()),null);
});
