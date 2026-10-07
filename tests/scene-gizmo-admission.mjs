import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(process.env.KAMINOS_GIZMO_SOURCE||new URL('../index.html',import.meta.url),'utf8');
test('a gizmo property change before mouseDown cannot write authored roots',()=>{
 const start=html.indexOf("  transformControls.addEventListener('change', () => {\n    markDirty();");const end=html.indexOf('  initTransformInspector();',start);assert.ok(start>=0&&end>start);
 let listener,writes=0;const proxy={};const context=vm.createContext({transformControls:{object:proxy,dragging:true,addEventListener:(_,fn)=>listener=fn},selectionProxy:proxy,
  scenePlacementTools:{state:()=>({gizmoEditing:false}),edits:{state:()=>({active:null})},finish(){}},selectionTransforms:{read:()=>({}),write(){writes++;}},
  markDirty(){},splatCorrectionTransformTarget:()=>false,sceneObjectTransformState:()=>({}),updateTransformInspector(){}});
 vm.runInContext(html.slice(start,end),context);listener();assert.equal(writes,0,'only the transaction-owned gizmo gesture may write roots');
});
