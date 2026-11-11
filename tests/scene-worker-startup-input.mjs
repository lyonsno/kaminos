// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {PREFERENCES_SCHEMA,resolveStartupSceneDefaults} from '../user-preferences.mjs';
const module=await import('../scene-worker-startup-input.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
function resolve(input){assert.equal(typeof module.resolveSceneWorkerStartupInput,'function','worker transport selection must preserve actual startup defaults');return module.resolveSceneWorkerStartupInput(input);}
const view={position:[1,2,4],target:[0,1,0],up:[0,1,0],fov:52,near:.1,far:200};
const preferences={schema:PREFERENCES_SCHEMA,sceneDefaults:{camera:view},agentSceneDefaults:{camera:{...view,position:[2,3,5]}}};
test('selecting the worker preserves scene and agent defaults while exposing only prepared input',()=>{
 for(const profile of ['', '&defaults=agent']){
  const location=`https://example.test/index.html?workspace=workbench&scene_worker=1${profile}`;
  const value=resolve({preferences,location:{href:location}});
  const ordinary=new URL(location);ordinary.searchParams.delete('scene_worker');
  assert.deepEqual(value.startupDefaults,resolveStartupSceneDefaults(preferences,ordinary.href));
  assert.deepEqual(value.camera,value.startupDefaults.defaults.camera);assert.equal(Object.hasOwn(value,'preferencesApplied'),false);
 }
});
test('explicit saved-scene camera and explicit route inputs retain their precedence',()=>{
 const saved={...view,position:[5,6,7]},location='https://example.test/?scene_worker=1#scene=authored.kaminos.json';
 const value=resolve({preferences,location:{href:location},admission:{data:{camera:saved}}});
 assert.equal(value.startupDefaults.effective,null);assert.equal(value.startupDefaults.reason,'explicit-scene-input');assert.deepEqual(value.camera,saved);
 saved.position[0]=999;assert.equal(value.camera.position[0],5,'prepared camera does not alias its source document');
 const explicit=resolve({preferences,location:{href:'https://example.test/?scene_worker=1&volume_resolution=32'}});
 assert.equal(explicit.startupDefaults.effective,null);assert.equal(explicit.camera,null);
});
test('preferences remain checked and selector values cannot silently change the scene defaults decision',()=>{
 assert.throws(()=>resolve({preferences:{...preferences,schema:'wrong'},location:{href:'https://example.test/?scene_worker=1'}}),/preferences/i);
 assert.throws(()=>resolve({preferences,location:{href:'https://example.test/?scene_worker=0'}}),/worker.*selector/i);
 assert.throws(()=>resolve({preferences,location:{href:'https://example.test/?scene_worker=1&scene_worker=0'}}),/worker.*selector/i);
 assert.equal(resolve({preferences:null,location:{href:'https://example.test/?scene_worker=1'}}).camera,null);
});
