import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('pose preview preserves the current gizmo attachment and visibility',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const source=html.slice(html.indexOf('function applyAuthoredScenePose('),html.indexOf('window.kaminosSetSceneObjectTransform ='));
  const object={},record={id:'kiln',object,type:'glb'};
  let attachments=0,refreshes=0;
  const context={LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',sceneObjects:[record],activeSceneObjectId:'kiln',
    applySceneObjectTransformState:(o,pose)=>Object.assign(o,pose),updateTransformInspector:()=>refreshes++,
    transformControls:{object,visible:false,detach(){},attach(){attachments++;this.visible=true;}},
    splatCorrectionTransformTarget:()=>null,
    document:{getElementById:()=>({classList:{add(){}}})},
    window:{kaminosSceneObjectDebugState:()=>[record],_kaminosDirty(){}}};
  vm.createContext(context);vm.runInContext(source,context);
  context.applyAuthoredScenePose('kiln',{position:[1,2,3]});
  assert.deepEqual(object.position,[1,2,3]);assert.equal(refreshes,1);
  assert.equal(attachments,0,'updating pose must not reattach a deliberately hidden gizmo');
  assert.equal(context.transformControls.visible,false);
});
