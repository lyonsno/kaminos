// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {installGenerationFlame} from '../authoring-generation-flame.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('admitting words into an existing kiln retains its renderer and prepares the exact request',async()=>{
 const element=()=>({dataset:{},append(){},setAttribute(){},remove(){}});let created=0,disposed=0,prepared=[];
 const input={value:'draft'};const view=installGenerationFlame({document:{createElement:element,getElementById:()=>input},slot:element(),createRenderer:async()=>{created++;return {prepare:async x=>prepared.push(x),setActive:async()=>{},dispose:()=>disposed++,debugState:()=>({})};}});
 await view.setVisible(true);input.value='changed words';view.render({status:'loading',request:{id:'one',prompt:'changed words'}});await tick();await tick();
 assert.equal(created,1,'typing and admission must not reconstruct the kiln');assert.equal(disposed,0);assert.equal(prepared.at(-1).prompt,'changed words');
 input.value='next draft';view.render({status:'running',request:{id:'one',prompt:'changed words'}});await tick();assert.equal(prepared.length,1,'draft changes cannot mutate the admitted burn');await view.dispose();
});
