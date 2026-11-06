// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {installRelativeNumberDrag} from '../scene-control-history.mjs';
import * as preferences from '../user-preferences.mjs';
class Target extends EventTarget{
 fire(type,fields={}){const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(fields))Object.defineProperty(event,key,{value});this.dispatchEvent(event);}
}
function defaults(path,value){const result={};let slot=result;const keys=path.split('.');for(const key of keys.slice(0,-1))slot=slot[key]={};slot[keys.at(-1)]=value;return result;}
const initial={'postprocessing.dof.focus':2.5,'postprocessing.dof.aperture':.002,'postprocessing.dof.maxblur':.01,backdropBrightness:1};
for(const [path,range]of Object.entries(preferences.SCENE_DEFAULT_RANGES))for(const fine of [false,true])test(path+' '+(fine?'fine':'ordinary')+' scrub stays on its admitted lattice, reverses and reaches limits',()=>{
 const doc=new Target();doc.defaultView=new Target();
 const input=new Target(),classes=new Set();Object.assign(input,{ownerDocument:doc,style:{},type:'number',value:String(initial[path]),min:String(range.min),max:String(range.max),setPointerCapture(){},hasPointerCapture:()=>false,classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}});
 input.addEventListener('input',()=>{input.value=String(preferences.quantizeSceneDefaultDrag?.(path,Number(input.value))??Number(input.value));});
 const drag=installRelativeNumberDrag({input,step:range.step});
 const admitted=()=>assert.doesNotThrow(()=>preferences.checkedSceneDefaults(defaults(path,Number(input.value))),'drag emitted an unsaveable value '+input.value);
 try{
  input.fire('pointerdown',{button:0,pointerId:1,clientX:100,clientY:0});
  const move=x=>{input.fire('pointermove',{pointerId:1,clientX:x,clientY:0,shiftKey:fine});admitted();};
  move(110);move(100);assert.equal(Number(input.value),initial[path]);
  move(100000);assert.equal(Number(input.value),range.max);
  move(100000-(fine?40:4));assert.ok(Number(input.value)<range.max,'reverse must leave the maximum without repaying outward motion');
  move(-100000);assert.equal(Number(input.value),range.min);
  move(-100000+(fine?40:4));assert.ok(Number(input.value)>range.min);
  input.fire('pointerup');admitted();
 }finally{drag.dispose();}
});
test('GI values retain their arbitrary fractional precision',()=>{
 assert.equal(typeof preferences.quantizeSceneDefaultDrag,'function');
 for(const value of [.0123,1.23456789])assert.equal(preferences.quantizeSceneDefaultDrag('postprocessing.sceneGI.estimator.depthPhi',value),value);
});
