import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
test('Generate has a runnable TRELLIS route returning a run-owned mesh',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../../../pipelines/asset-pipelines.json',import.meta.url)));
  const route=manifest.pipelines.find(p=>p.id==='trellis-image-to-mesh-webgpu-v0');
  assert.ok(route,'the Generate placeholder must point to a callable TRELLIS model route');
  assert.equal(route.artifacts.mesh.role,'textured-mesh');
  assert.equal(route.artifacts.mesh.pathTemplate,'artifacts/trellis-output.glb');
  const stage=route.stages.find(s=>s.outputArtifact==='mesh');
  assert.equal(stage.route.effectiveBackend,'browser-webgpu');
  assert.equal(stage.route.executesModel,true);
  assert.equal(stage.route.commandDefault,'scripts/run-trellis-greenroom-adapter.mjs');
});
