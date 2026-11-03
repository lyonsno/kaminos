// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createGenerationArrival,arrivalTranslation} from '../generation-arrival.mjs';
test('arrival reverses from its held point and returns surrounding visibility without changing the camera',()=>{
 const frames=[];let placed=0;const c=createGenerationArrival({duration:2,present:x=>frames.push(x),place:()=>placed++});
 c.enter();c.advance(.5);assert.equal(c.read().amount,.25);c.hold();c.advance(9);assert.equal(c.read().amount,.25);
 c.exit();c.advance(.25);assert.equal(c.read().amount,.125);c.advance(4);assert.equal(c.read().amount,0);assert.equal(c.read().direction,0);
 c.enter();c.advance(2);assert.equal(c.read().amount,1);assert.equal(placed,2);c.dispose();assert.equal(frames.at(-1),null);
});
test('invalid scrubs cannot poison presentation; enter while arriving does not reanchor',()=>{
 let placed=0;const c=createGenerationArrival({present(){},place:()=>placed++});c.enter();c.enter();assert.equal(placed,1);
 assert.throws(()=>c.seek(NaN));assert.throws(()=>c.seek(1.1));c.seek(.5);assert.equal(c.read().direction,0);
});
test('an entry-relative sphere fits even for vertical and oblique views',()=>{
 for(const direction of [[0,-1,0],[0,1,0],[.7,-.2,-.8]]){
 const position=[13,8,-4],target=position.map((x,i)=>x+direction[i]);const view={position,target,fov:38,aspect:.7,zoom:1};
 const result=arrivalTranslation({view,center:[1,2,3],radius:4});const point=result.translation.map((x,i)=>x+[1,2,3][i]);
 const v=point.map((x,i)=>x-position[i]),length=Math.hypot(...v),norm=Math.hypot(...direction);
 v.forEach((x,i)=>assert.ok(Math.abs(x/length-direction[i]/norm)<1e-12));assert.ok(length>4/Math.sin(Math.atan(Math.tan(19*Math.PI/180)*.7)));
 }
});
