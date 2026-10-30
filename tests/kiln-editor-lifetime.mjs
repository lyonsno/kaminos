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
for(const duringPreparation of [false,true])test(`real saving/complete sequence finishes the admitted strip (pending preparation=${duringPreparation})`,async()=>{
 const element=()=>({dataset:{},append(){},setAttribute(){},remove(){}});let release,active=false,finished=0;
 const gate=new Promise(r=>release=r);
 const view=installGenerationFlame({document:{createElement:element,getElementById:()=>({value:'draft'})},slot:element(),createRenderer:async()=>({prepare:()=>gate,setActive:async x=>{active=x;},finish(){if(active)finished++;},dispose(){},debugState:()=>({})})});
 await view.setVisible(true);view.render({status:'running',request:{id:'one',prompt:'full strip'}});await tick();
 if(!duringPreparation){release();await tick();await tick();}
 view.render({status:'saving',request:{id:'one',prompt:'full strip'}});await tick();view.render({status:'complete',request:{id:'one',prompt:'full strip'}});
 release();await tick();await tick();assert.equal(finished,1);await view.dispose();
});
test('a recipe refresh waits for physical completion and then replaces the kiln',async()=>{
 const element=()=>({dataset:{},append(){},setAttribute(){},remove(){}});let created=0,release;
 const drained=new Promise(r=>release=r);
 const view=installGenerationFlame({document:{createElement:element,getElementById:()=>({value:'draft'})},slot:element(),createRenderer:async()=>{created++;return {prepare:async()=>{},setActive:async()=>{},finish:()=>drained,dispose(){},debugState:()=>({})};}});
 await view.setVisible(true);view.render({status:'running',request:{id:'one',prompt:'full strip'}});await tick();await tick();await view.refresh();view.render({status:'complete'});await tick();await tick();assert.equal(created,1);release();await tick();await tick();assert.equal(created,2);await view.dispose();
});
for(const refresh of [false,true])test(`visibility pauses and resumes completion (deferred recipe=${refresh})`,async()=>{
 const element=()=>({dataset:{},append(){},setAttribute(){},remove(){}});let created=0,active=false,finishing=false,done;
 const view=installGenerationFlame({document:{createElement:element,getElementById:()=>({value:'draft'})},slot:element(),createRenderer:async()=>{created++;return {prepare:async()=>{},setActive:async value=>{active=value;if(!value){finishing=false;done?.();}},finish(){finishing=true;return new Promise(r=>done=r);},dispose(){},debugState:()=>({active,finishing})};}});
 await view.setVisible(true);const request={id:'one',prompt:'full strip'};for(const status of ['running','saving','complete']){view.render({status,request});await tick();await tick();}
 if(refresh)await view.refresh();await view.setVisible(false);assert.equal(active,false);await view.setVisible(true);assert.equal(active,true);assert.equal(finishing,true);assert.equal(created,1);done();await tick();await tick();assert.equal(created,refresh?2:1);await view.dispose();
});
test('a second hide during asynchronous reactivation preserves the outstanding admitted burn',async()=>{
 const element=()=>({dataset:{},append(){},setAttribute(){},remove(){}});let active=false,finishing=false,done,release,gate=null;
 const view=installGenerationFlame({document:{createElement:element,getElementById:()=>({value:'next draft'})},slot:element(),createRenderer:async()=>({prepare:async()=>{},async setActive(value){if(value&&gate)await gate;active=value;if(!value){finishing=false;done?.();}},finish(){finishing=true;return new Promise(r=>done=r);},dispose(){},debugState:()=>({active,finishing})})});
 await view.setVisible(true);for(const status of ['running','saving','complete']){view.render({status,request:{id:'one',prompt:'admitted words'}});await tick();await tick();}
 await view.setVisible(false);gate=new Promise(r=>release=r);const first=view.setVisible(true);await tick();const hide=view.setVisible(false);release();await first;await hide;gate=null;await view.setVisible(true);
 assert.equal(finishing,true,'the unfinished admitted burn must resume after the second hide');await view.dispose();
});
