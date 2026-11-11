// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {mountFireUnitControls} from '../fire-unit-controls.mjs';import {createSceneEdits} from '../scene-edit-session.mjs';
import {createSceneComponentEdit} from '../scene-component-edit.mjs';
test('unit controls use ordinary object placement and register only component/data targets',()=>{
 const node=()=>({dataset:{},append(){},remove(){}}),document={createElement:node,createTextNode:()=>({})};let data={moveEmitterWithGrid:true,emitter:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};
 const edits=createSceneEdits({read:()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),write(){}}),owner={capture:()=>structuredClone(data),linkState:()=>data,setData:v=>{data=v;},setEmitter:v=>{data.emitter=v;},pose(){},setPose(){}};
 const panel=mountFireUnitControls({document,owner,asset:{id:'fire-a',root:{}},edits,components:{register:()=>({dispose(){}})},mountObject:()=>({dispose(){}}),select(){},redraw(){},onError:e=>{throw e;}});
 edits.apply('@fire-unit-data:fire-a',{...data,moveEmitterWithGrid:false});assert.equal(data.moveEmitterWithGrid,false);edits.clear();panel.dispose();
});
test('native component editing enters Fine, picks the emitter and exits without sidebar selection buttons',()=>{
 const created=[],node=tag=>({dataset:{},append(){},remove(){},tag}),document={createElement:tag=>{const n=node(tag);created.push(n);return n;},createTextNode:()=>({})};
 const pose=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});let data={moveEmitterWithGrid:true,emitter:pose()},fine=pose(),picked='emitter';
 const owner={root:{},fine:{},emitter:{},fineProxy:{},proxy:{},capture:()=>structuredClone(data),linkState:()=>data,setData:v=>{data=v;},finePose:()=>structuredClone(fine),setFinePose:v=>{fine=v;},setEmitter:v=>{data.emitter=v;},pickComponent:()=>picked};
 const edits=createSceneEdits({read:()=>pose(),write(){}}),components=createSceneComponentEdit({selected:()=> 'fire-a',cancel:()=>edits.cancel(),refresh(){}});
 const panel=mountFireUnitControls({document,owner,asset:{id:'fire-a',root:{}},edits,components,mountObject:()=>({dispose(){}}),redraw(){},onError:e=>{throw e;}});
 assert.equal(created.filter(n=>n.tag==='button').length,0,'component selection belongs to the native editor');
 components.toggle('fire-a');assert.equal(components.target().id,'@fire-unit-fine:fire-a');
 edits.apply(components.target().id,{...pose(),position:[1,2,3]});assert.deepEqual(fine.position,[1,2,3]);assert.deepEqual(data.emitter.position,[0,0,0]);
 components.pick({},{});assert.equal(components.target().id,'@fire-unit-emitter:fire-a');
 picked='fine';components.pick({},{});assert.equal(components.target().id,'@fire-unit-fine:fire-a');
 components.toggle('fire-a');assert.equal(components.target(),null);edits.clear();panel.dispose();
});
