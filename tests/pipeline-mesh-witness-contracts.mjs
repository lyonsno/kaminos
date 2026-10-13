import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../pipeline-ui-witness.mjs',import.meta.url),'utf8');
test('mesh output must take the Load Output witness branch, not Open Artifact',()=>{
  const start=source.indexOf('const expectedArtifactRole ='),end=source.indexOf('const expectsFixture =',start);
  const context={args:new Map([['artifact-role','textured-mesh']]),pipelineId:'trellis-image-to-mesh-webgpu-v0'};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.observedLoadable=expectsLoadableArtifact;',context);
  assert.equal(context.observedLoadable,true,'the actual UI witness still treats a generated GLB as a non-loadable report');
});
test('mesh source witness matches the actual run-root URL mapping, not an absolute filesystem URL',()=>{
  const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  function fn(text,name) {const start=text.indexOf('function '+name+'('),end=text.indexOf('\n}',start)+2;return text.slice(start,end);}
  const c={encodeURIComponent};vm.createContext(c);
  vm.runInContext(fn(source,'meshWitnessSource')+'\n'+fn(index,'pipelineRunReadUrlForPath'),c);
  const root='/caller-owned/pipeline-runs/run one',artifact=root+'/artifacts/trellis-output.glb';
  assert.equal(c.meshWitnessSource(root,artifact),c.pipelineRunReadUrlForPath({bundle:{document:{outputRoot:root}}},artifact));
  assert.equal(c.meshWitnessSource(root,'/unrelated/cached.glb'),null);
});
