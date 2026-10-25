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
