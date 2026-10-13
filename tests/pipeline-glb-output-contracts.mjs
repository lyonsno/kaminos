import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function definition(name){
  const start=source.search(new RegExp('(?:async )?function '+name+'\\('));
  if(start<0)return '';
  const next=source.slice(start+1).search(/\n(?:async )?function /);
  return source.slice(start,next<0?undefined:start+1+next);
}
const definitions=['pipelineArtifactRole','pipelineArtifactRoleLabel','pipelineArtifactIsLoadableSplat',
  'pipelineArtifactIsLoadableMesh','pipelineArtifactIsLoadable','pipelineLoadRunSplatArtifact'].map(definition).join('\n');
test('the existing Load Output action imports a GLB and records its actual scene identity',async()=>{
  const calls=[],state={};const context={console,Date,
    pipelineRunReadUrlForPath:(_run,path)=>'/api/read?root=pipeline-runs&path='+path,
    pipelineSetActionStatus:message=>calls.push({status:message}),pipelineDockState:state,
    renderPipelineGraphWorkbench(){},setActiveTab(){},
    async showGLB(url,options){calls.push({url,options});return {userData:{kaminosSceneObject:{id:'actual-glb',type:'glb'}}};},
    async greenroomImportSplat(){throw Error('GLB went to the splat importer');}};
  vm.createContext(context);vm.runInContext(definitions,context);
  const artifact={id:'mesh',role:'textured-mesh',path:'run-one/asset.glb'};
  const record=await context.pipelineLoadRunSplatArtifact({ok:true},artifact);
  assert.equal(record?.id,'actual-glb','a complete generated GLB must reach the existing GLB importer');
  const imported=calls.find(call=>call.url);
  assert.equal(imported.url,'/api/read?root=pipeline-runs&path=run-one/asset.glb');
  assert.equal(imported.options.clear,false,'loading one run must not remove other scene objects');
  assert.equal(state.loadedPipelineArtifactPaths[artifact.path].sceneObjectId,'actual-glb');
  assert.equal(state.loadedPipelineArtifactPaths[artifact.path].previewRoute,'glb-pbr');
});
