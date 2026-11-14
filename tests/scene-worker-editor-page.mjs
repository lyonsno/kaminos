// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSceneWorkerEditor} from '../scene-worker-editor-page.mjs';

function fixture(request){
 const listeners=new Map(),document={getElementById:()=>null,querySelectorAll:()=>[]};
 const window={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 const editor=mountSceneWorkerEditor({document,window,page:{request},readCamera:()=>({}),readUi:()=>null});
 return {editor,window,listeners};
}
test('page editor forwards retained Add intent and awaits its accepted worker identity without private scene state',async()=>{
 let finish;const calls=[],f=fixture((operation,input)=>{calls.push({operation,input});return {completion:new Promise(resolve=>{finish=resolve;})};});
 try{
  assert.equal(typeof f.editor.importAsset,'function','asset drawer needs the canonical worker editor admission method');
  const asset={source:'/api/read?root=generated-meshes&path=mesh.glb',generation:{runId:'kept'},provenance:{job:'existing'}};
  const task=f.editor.importAsset(asset);assert.deepEqual(calls,[{operation:'scene.importAsset',input:asset}]);
  assert.equal(f.editor.edits.state().pending,1);
  finish({output:{objectId:'accepted',mutationApplied:true,ui:{history:{undoCount:1}}}});
  assert.equal((await task).objectId,'accepted');assert.equal(f.editor.edits.state().pending,0);
 }finally{f.editor.dispose();}
});
test('an applied failure refreshes canonical editor state and still rejects without resubmitting the edit',async()=>{
 const calls=[],error=Object.assign(Error('presentation failed'),{mutationApplied:true});
 const f=fixture((operation,input)=>{calls.push(operation);return {completion:operation==='scene.importAsset'?Promise.reject(error):Promise.resolve({output:{ui:{objects:[],history:{undoCount:1}}}})};});
 try{
  assert.equal(typeof f.editor.importAsset,'function');
  await assert.rejects(f.editor.importAsset({source:'/retained.glb'}),value=>value===error);
  assert.deepEqual(calls,['scene.importAsset','scene.editorState']);assert.equal(f.editor.edits.state().pending,0);
 }finally{f.editor.dispose();}
});
