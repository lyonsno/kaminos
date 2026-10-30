// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {installImageZoom} from '../authoring-image-zoom.mjs';
test('zoomed caret pans into its viewport without resetting scale',()=>{
 const handlers={},frame={dataset:{},getBoundingClientRect:()=>({left:0,top:0,right:400,bottom:200,width:400,height:200}),addEventListener:(name,fn)=>handlers[name]=fn},target={style:{}},resetButton={};
 const zoom=installImageZoom({frame,targets:[target],resetButton});assert.equal(resetButton.hidden,true);assert.ok(resetButton.textContent);
 handlers.wheel({ctrlKey:true,deltaY:-100,clientX:200,clientY:100,preventDefault(){},stopPropagation(){}});const scale=zoom.read().scale;
 zoom.reveal({left:-50,right:-48,top:60,bottom:80});assert.equal(zoom.read().scale,scale);assert.equal(zoom.read().x,58);
 zoom.reveal({left:200,right:202,top:190,bottom:220});assert.equal(zoom.read().y,-28);
});
