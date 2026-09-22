import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=source.indexOf('async function loadSceneFile(');
const end=source.indexOf('// File input handler for Load Scene',begin);
assert.ok(begin>=0 && end>begin,'extract the actual scene loader');
const body=source.slice(begin,end);

for(const [name,href] of [
  ['a different scene fragment','http://127.0.0.1:63814/#authoring=1&scene=old.kaminos.json'],
  ['the same scene fragment','http://127.0.0.1:63814/#authoring=1&scene=chosen.kaminos.json'],
  ['a different document query','http://127.0.0.1:63814/?preset=basin#authoring=1'],
]) test(`saved-row Load reconstructs exactly once for ${name}`,async()=>{
  const location={origin:'http://127.0.0.1:63814',href,documentLoads:0,
    assign(href){const a=new URL(this.href),b=new URL(href);if(a.origin+a.pathname+a.search!==b.origin+b.pathname+b.search)this.documentLoads++;this.href=href;},
    reload(){this.documentLoads++;}};
  const context=vm.createContext({URL,location,authoringBusy:false,currentSceneFile:'old.kaminos.json',sceneSaveBlockedByFailedRestore:false,
    getVolumePrimitiveState:()=>({primitives:[]}),planSceneRestore:()=>({objects:[],hasVolumePrimitiveScene:false,composition:null}),
    assertSceneObjectsReloadable:()=>{},isCompositionAuthoring:()=>true,compositionRestoreUrl,setInfo:()=>{}});
  vm.runInContext(body,context);
  context.file={name:'chosen.kaminos.json',text:async()=>'{"version":3}'};
  await vm.runInContext("loadSceneFile(file,{sceneFile:'chosen.kaminos.json'})",context);
  assert.equal(new URL(location.href).hash,'#authoring=1&scene=chosen.kaminos.json');
  assert.equal(location.documentLoads,1,'hash-only assignment must not leave the previous authored scene alive');
});
