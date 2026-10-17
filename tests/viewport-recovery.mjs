// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as picker from '../scene-load-picker.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n}',start)+2);};
test('Load gives the author chosen file name precedence over inherited basin label',()=>{
 assert.equal(typeof picker.scenePickerTitle,'function','title policy must expose chosen filename');
 assert.equal(picker.scenePickerTitle({name:'dj-with-a-kiln-pretty.kaminos.json',label:'Immersed source authoring'}),'dj-with-a-kiln-pretty');
});
test('visible emitter helper can be picked through nearer kiln geometry; hidden helper cannot',()=>{
 const mesh={object:{visible:true}},emitter={object:{visible:true}},hits=[{object:'kiln'},{object:'emitter'}];
 const ctx={scenePointerNdc:{set(){}},renderer:{domElement:{getBoundingClientRect:()=>({left:0,top:0,right:100,bottom:100,width:100,height:100})}},camera:{},sceneObjects:[mesh,emitter],SCENE_OBJECT_POINT_PICK_THRESHOLD:.1,
 sceneRaycaster:{params:{Points:{}},setFromCamera(){},intersectObjects:()=>hits},sceneObjectRecordForDescendant:o=>o==='kiln'?mesh:emitter,
 FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'water-emitter'};
 mesh.type='glb';emitter.type='flame-emitter';vm.createContext(ctx);vm.runInContext(grab('sceneHitsFromViewportPointer')+'\n'+grab('pickSceneObjectFromViewportPointer'),ctx);
 assert.equal(ctx.pickSceneObjectFromViewportPointer({clientX:50,clientY:50}),emitter);
 emitter.object.visible=false;ctx.sceneRaycaster.intersectObjects=()=>[{object:'kiln'}];assert.equal(ctx.pickSceneObjectFromViewportPointer({clientX:50,clientY:50}),mesh);
});
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
test('viewport display preferences round-trip independently of authored fire settings',()=>{
 const editorDisplay={overlays:true,outlines:false,domains:true,emitters:false,outlineWidth:3,outlineOpacity:.4,domainWidth:2,domainOpacity:.5,emitterWidth:4,emitterOpacity:.3};
 const doc=buildSceneDocument({objects:[{id:'kiln',type:'glb',source:'/kiln.glb'}],editorDisplay});
 assert.deepEqual(planSceneRestore(doc).editorDisplay,doc.editorDisplay);
 assert.equal(doc.editorDisplay?.outlineWidth,3);
 assert.throws(()=>buildSceneDocument({editorDisplay:{domainOpacity:2}}),/opacity/i);
});
import {checkedViewportDisplay,viewportShortcut} from '../viewport-display-settings.mjs';
test('overlay master retains category settings and shortcuts leave typing/repeat alone',()=>{
 const original=checkedViewportDisplay({outlines:false,domainOpacity:.4,emitterOpacity:.2});
 const hidden=checkedViewportDisplay({...original,overlays:false});
 assert.deepEqual(checkedViewportDisplay({...hidden,overlays:true}),original);
 assert.equal(viewportShortcut({code:'KeyZ',shiftKey:true,altKey:true}),'overlays');
 assert.equal(viewportShortcut({code:'Backquote',ctrlKey:true}),'gizmos');
 assert.equal(viewportShortcut({code:'Backquote'}),null);
 assert.equal(viewportShortcut({code:'KeyZ',shiftKey:true,altKey:true,repeat:true}),null);
 assert.throws(()=>checkedViewportDisplay({emitterWidth:NaN}),/width/);
 assert.throws(()=>checkedViewportDisplay({outlines:1}),/outlines/);
});
