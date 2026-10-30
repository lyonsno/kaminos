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
test('hiding an idle kiln stops compute but preserves the assembled scene',async()=>{
 const element=()=>({dataset:{},append(){},setAttribute(){},remove(){}});let created=0,disposed=0;
 const view=installGenerationFlame({document:{createElement:element,getElementById:()=>({value:'same'})},slot:element(),createRenderer:async()=>{created++;return {setActive:async()=>{},dispose:()=>disposed++,debugState:()=>({})};}});
 await view.setVisible(true);await view.setVisible(false);assert.equal(disposed,0);await view.setVisible(true);assert.equal(created,1);await view.dispose();assert.equal(disposed,1);
});
for(const transition of ['admit','hide'])test(`retained warmup survives ${transition}`,async()=>{
 const element=()=>({dataset:{},append(){},setAttribute(){},remove(){}});let release,active=false,signal;
 const wait=new Promise(r=>release=r);
 const view=installGenerationFlame({document:{createElement:element,getElementById:()=>({value:'draft'})},slot:element(),createRenderer:async(_,options)=>{signal=options.signal;const warmup=wait.then(()=>signal.throwIfAborted());return {prepare:()=>warmup,setActive:async value=>{if(value)await warmup;active=value;},dispose(){},debugState:()=>({active})};}});
 await view.setVisible(true);
 if(transition==='hide'){await view.setVisible(false);await view.setVisible(true);}
 view.render({status:'running',request:{id:'one',prompt:'draft'}});release();await tick();await tick();
 assert.equal(view.read().error,null);assert.equal(active,true);assert.equal(signal.aborted,false);await view.dispose();
});
test('successful generation hands the remaining physical strip to completion instead of replacing it with the draft',async()=>{
 const element=()=>({dataset:{},append(){},setAttribute(){},remove(){}});let finished=0,prepared=[];
 const view=installGenerationFlame({document:{createElement:element,getElementById:()=>({value:'draft'})},slot:element(),createRenderer:async()=>({prepare:async x=>prepared.push(x.prompt),finish(){finished++;},setActive:async()=>{},dispose(){},debugState:()=>({})})});
 await view.setVisible(true);view.render({status:'running',request:{id:'one',prompt:'full strip'}});await tick();await tick();view.render({status:'complete'});await tick();await tick();
 assert.equal(finished,1);assert.deepEqual(prepared,['full strip']);await view.dispose();
});
