import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('const GLB_EXPORT_SKIPPED_TYPES =');
const end=source.indexOf('\n// --- Greenroom Browser ---',start);
test('camera-only GLB export refuses before cloning its editor wire',async()=>{
  let message='';
  const context={window:{},CAMERA_TYPE:'camera',FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',selectedSceneGroupEntry:()=>null,selectedSceneObjectEntry:()=>({type:'camera',object:{}}),sceneObjectDisplayLabel:()=> 'Camera',setInfo:value=>{message=value;},sanitizeFileStem:()=>{throw Error('camera reached export filename/geometry path');}};
  vm.runInNewContext(source.slice(start,end),context);
  assert.equal(await context.window.exportGLB({name:'Camera'}),false);
  assert.equal(message,'Nothing in the selection can be exported as GLB');
});
