// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as prompt from '../authoring-prompt-expansion.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
test('selected original reference and full text reach the replaceable provider, with disposal before idle',async()=>{
 assert.equal(typeof prompt.createAuthoringPromptExpansion,'function');
 let input,disposed=0;const gate=deferred();
 const c=prompt.createAuthoringPromptExpansion({createHelper:()=>({expand:async x=>{input=x;x.onText('complete expansion');return gate.promise;},dispose:async()=>{disposed++;}})});
 const request={prompt:'Turn it blue',model:'flux3',reference:{kind:'image',source:'/original.png',name:'kettle'}};
 const running=c.expand(request);await tick();assert.equal(c.busy(),true);assert.deepEqual(input.images,['/original.png']);assert.equal(input.prompt,'Turn it blue');assert.equal(c.read().draft,'complete expansion');
 await assert.rejects(c.expand(request),/already/);gate.resolve({text:'complete expansion',partial:false,stopReason:'eos',backend:'test',modelRevision:'source'});await running;
 assert.equal(disposed,1);assert.equal(c.busy(),false);assert.equal(c.read().request.reference.source,'/original.png');assert.equal(c.read().result.text,'complete expansion');
});
test('blocked host never constructs a provider; cancelled work stays busy until provider settlement',async()=>{
 let creates=0;const blocked=prompt.createAuthoringPromptExpansion({blocked:()=> 'Image is generating',createHelper:()=>{creates++;}});
 await assert.rejects(blocked.expand({prompt:'blue',model:'flux3'}),/Image is generating/);assert.equal(creates,0);
 const gate=deferred();let signal;const c=prompt.createAuthoringPromptExpansion({createHelper:()=>({expand:async x=>{signal=x.signal;return gate.promise;},dispose:async()=>{}})});
 const run=c.expand({prompt:'blue',model:'flux3'});await tick();c.stop();assert.equal(signal.aborted,true);assert.equal(c.busy(),true);gate.reject(signal.reason);await run;assert.equal(c.busy(),false);assert.equal(c.read().status,'stopped');
});
test('a changed selected reference/model cannot silently receive an earlier expansion',()=>{
 assert.equal(typeof prompt.promptExpansionMatches,'function');
 const request={model:'flux3',reference:{kind:'image',source:'/a.png'}};
 assert.equal(prompt.promptExpansionMatches(request,{model:'flux3',reference:{kind:'image',source:'/a.png'}}),true);
 assert.equal(prompt.promptExpansionMatches(request,{model:'flux3',reference:{kind:'image',source:'/b.png'}}),false);
 assert.equal(prompt.promptExpansionMatches(request,{model:'flux2',reference:{kind:'image',source:'/a.png'}}),false);
 assert.equal(prompt.promptExpansionMatches(request,{model:'flux3',reference:null}),false);
});
test('failed disposal preserves the generated caption and prevents a clean completion claim',async()=>{
 const c=prompt.createAuthoringPromptExpansion({createHelper:()=>({expand:async()=>({text:'useful caption',partial:false}),dispose:async()=>{throw Error('cleanup failed');}})});
 await assert.rejects(c.expand({prompt:'blue',model:'flux3'}),/cleanup failed/);assert.equal(c.read().result.text,'useful caption');assert.equal(c.read().status,'failed');
});

test('an empty provider result is a visible failure, never a completed expansion',async()=>{
 const c=prompt.createAuthoringPromptExpansion({createHelper:()=>({expand:async()=>({text:'  ',partial:false}),dispose:async()=>{}})});
 await assert.rejects(c.expand({prompt:'blue',model:'flux3'}),/empty/);assert.equal(c.read().status,'failed');
});

test('weight download callbacks do not redraw the application when visible operation state is unchanged',async()=>{
 let notifications=0,callbacks;const gate=deferred();
 const c=prompt.createAuthoringPromptExpansion({changed:()=>{notifications++;},createHelper:x=>{callbacks=x;return{expand:()=>gate.promise,dispose:async()=>{}};}});
 const run=c.expand({prompt:'blue',model:'flux3'});await tick();const before=notifications;
 for(let i=0;i<1000;i++)callbacks.onProgress({phase:'model',status:'progress',loaded:i});
 assert.equal(notifications,before,'unchanged status must not trigger whole-app redraw per download chunk');
 gate.resolve({text:'blue enamel kettle',partial:false});await run;assert.equal(c.read().status,'complete');
});

test('ordinary servers resolve the explicit prompt-helper mount and never invent a local package',()=>{
 assert.equal(typeof prompt.authoringPromptWeightRoot,'function');
 assert.equal(prompt.authoringPromptWeightRoot({pup:{mounted:true,modelUrl:'/pup-weights'}}),'/pup-weights');
 assert.throws(()=>prompt.authoringPromptWeightRoot({}),/unavailable/i);
 assert.throws(()=>prompt.authoringPromptWeightRoot({pup:{mounted:false,modelUrl:'/pup-weights'}}),/unavailable/i);
});
test('resident application operation reuses its provider and explicit unload releases it',async()=>{
 let creates=0,disposed=0;
 const c=prompt.createAuthoringPromptExpansion({keepLoaded:true,createHelper:()=>{creates++;return{resident:true,expand:async()=>({text:'caption',partial:false}),dispose:async()=>{disposed++;}};}});
 await c.expand({prompt:'first'});await c.expand({prompt:'second'});assert.equal(creates,1);assert.equal(disposed,0);assert.equal(c.read().resident,true);
 await c.setKeepLoaded(false);assert.equal(disposed,1);assert.equal(c.read().resident,false);assert.equal(c.read().keepLoaded,false);
});

test('waiting operation exposes queue position and skip choice to the retained provider',async()=>{
 let callbacks,input;const gate=deferred();
 const c=prompt.createAuthoringPromptExpansion({keepLoaded:true,createHelper:x=>{callbacks=x;return{expand:async options=>{input=options;callbacks.onWait({jobId:'canonical',position:4,heldBy:['other-job']});return gate.promise;},dispose:async()=>{}};}});
 const run=c.expand({prompt:'a kettle'});await tick();
 assert.equal(input.admission,'queue');assert.equal(c.read().queue.jobId,'canonical');assert.match(c.read().progress,/position 4/);
 assert.equal(c.runOutsideQueue(),true);assert.equal(input.bypassSignal.aborted,true);
 gate.resolve({text:'expanded',gpuLease:{status:'bypassed'}});await run;
 assert.match(c.read().coordination,/outside Greenroom/);assert.equal(c.runOutsideQueue(),false);
 await c.dispose();
});

test('prompt availability reports the selected package diagnosis',()=>{
 assert.throws(()=>prompt.authoringPromptWeightRoot({modelAvailability:{pup:{status:'unavailable',reason:'Missing decoder payload on this installation'}}}),/Missing decoder payload/);
});

test('image description needs no existing prompt and keeps its source independent of conditioning',async()=>{
 let input;const c=prompt.createAuthoringPromptExpansion({createHelper:()=>({expand:async x=>{input=x;return{text:'A copper kettle',task:'describe',partial:false};},dispose:async()=>{}})});
 await assert.rejects(c.expand({task:'describe',prompt:''}),/image/i);
 const image={kind:'image',source:'/copper.png'};
 await c.expand({task:'describe',prompt:'',reference:image});
 assert.equal(input.task,'describe');assert.deepEqual(input.images,['/copper.png']);
 assert.equal(c.read().request.task,'describe');assert.equal(c.read().result.text,'A copper kettle');
});

test('describe uses the viewed image; adoption disables conditioning, supports undo and rejects changed selection',async()=>{
 const nodes=new Map();class Element{
  constructor(){this.value='';this.checked=false;this.classList={toggle(){}};this.events={};}
  set innerHTML(text){for(const m of text.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],new Element());}
  append(){} insertAdjacentElement(){} addEventListener(k,f){this.events[k]=f;} dispatchEvent(e){this.events[e.type]?.();}
 }
 for(const id of ['asset-prompt','asset-image-model','asset-use-reference'])nodes.set(id,new Element());
 const document={createElement:()=>new Element(),getElementById:id=>nodes.get(id),defaultView:{localStorage:{getItem:()=>null},addEventListener(){}}};
 let viewed={kind:'image',source:'/viewed.png'},input;
 const controller=prompt.createAuthoringPromptExpansion({createHelper:()=>({expand:async x=>{input=x;return{text:'Copper kettle on white',task:x.task,partial:false};},dispose:async()=>{}})});
 const ui=prompt.installAuthoringPromptExpansion({document,controller,assets:{},imageController:{busy:()=>false,read:()=>({})},reference:()=>({kind:'image',source:'/pinned.png'}),describeReference:()=>viewed});
 nodes.get('asset-prompt').value='old instruction';nodes.get('asset-image-model').value='flux3';nodes.get('asset-use-reference').checked=true;
 await ui.describe();assert.deepEqual(input.images,['/viewed.png']);assert.equal(nodes.get('asset-prompt').value,'old instruction','description waits for explicit adoption');
 viewed={kind:'image',source:'/other.png'};ui.render();assert.equal(nodes.get('asset-prompt-use').disabled,true);assert.equal(nodes.get('asset-prompt-use').onclick(),false);
 viewed={kind:'image',source:'/viewed.png'};ui.render();nodes.get('asset-prompt-use').onclick();
 assert.equal(nodes.get('asset-use-reference').checked,false);assert.equal(nodes.get('asset-prompt').value,'Copper kettle on white');
 nodes.get('asset-prompt').value='A blue kettle on white';nodes.get('asset-prompt').dispatchEvent(new Event('input'));
 assert.equal(nodes.get('asset-prompt-draft').hidden,true,'editing adopted text must not resurrect the stale description');
 assert.equal(nodes.get('asset-prompt-undo').hidden,false);
 assert.equal(ui.descriptionProvenance().source.source,'/viewed.png');
 assert.equal(ui.descriptionProvenance().result.text,'Copper kettle on white');
 nodes.get('asset-prompt-undo').onclick();assert.equal(nodes.get('asset-prompt').value,'old instruction');assert.equal(nodes.get('asset-use-reference').checked,true);
});
