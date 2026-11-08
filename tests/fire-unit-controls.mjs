// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {mountFireUnitControls} from '../fire-unit-controls.mjs';import {createSceneEdits} from '../scene-edit-session.mjs';
test('unit controls use ordinary object placement and register only component/data targets',()=>{
 const node=()=>({dataset:{},append(){},remove(){}}),document={createElement:node,createTextNode:()=>({})};let data={moveEmitterWithGrid:true,emitter:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};
 const edits=createSceneEdits({read:()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}),write(){}}),owner={capture:()=>structuredClone(data),linkState:()=>data,setData:v=>{data=v;},setEmitter:v=>{data.emitter=v;},pose(){},setPose(){}};
 const panel=mountFireUnitControls({document,owner,asset:{id:'fire-a',root:{}},edits,components:{register:()=>({dispose(){}})},mountObject:()=>({dispose(){}}),select(){},redraw(){},onError:e=>{throw e;}});
 edits.apply('@fire-unit-data:fire-a',{...data,moveEmitterWithGrid:false});assert.equal(data.moveEmitterWithGrid,false);edits.clear();panel.dispose();
});
