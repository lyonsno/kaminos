// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthoringAssets} from '../authoring-assets.mjs';

test('a selected generated asset opens its own retained TRELLIS history',async()=>{
  const opened=[];
  const controller=createAuthoringAssets({request:async()=>{},history:{open:async value=>{opened.push(value);return value;}}});
  const entry={kind:'mesh',name:'kiln.glb',source:'/api/read?root=generated-meshes&path=kiln.glb',generation:{runId:'trellis-kiln',route:'trellis2.image-generation.webgpu.v0'}};
  controller.select(entry);
  assert.equal(typeof controller.openHistory,'function','asset browser must expose the retained generation history operation');
  await controller.openHistory();
  assert.equal(opened.length,1);assert.equal(opened[0].runId,'trellis-kiln');assert.equal(opened[0].assetSource,entry.source);
  controller.select({...entry,generation:{runId:'other',route:'sf3d'}});
  await assert.rejects(controller.openHistory(),/TRELLIS/);
  assert.equal(opened.length,1,'an unrelated model must not inherit the last TRELLIS history');
});
