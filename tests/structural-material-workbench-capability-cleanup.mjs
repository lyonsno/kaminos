import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const revision=process.env.STONE_PROVIDER_REVISION;
const module=revision?await import('data:text/javascript;base64,'+Buffer.from(execFileSync('git',['show',revision+':structural-material-workbench-host.mjs'],{encoding:'utf8'}).replace("'./structural-material-owner-host.mjs'",JSON.stringify(new URL('../structural-material-owner-host.mjs',import.meta.url).href))).toString('base64')):await import('../structural-material-workbench-host.mjs');
for(const complete of [false,true])test(`capability ${complete?'clears cleaned':'retains incomplete'} runtime after rejected disposal`,async()=>{
 const state={route:'kaminos.picked-stone.bounded-shards.webgpu.v0',backend:'webgpu',adapterFallback:false,connectivity:'elastic-support',runId:'fixture',submittedSteps:0,paused:true,threshold:180,failure:null,sourceSha256:'fixture'};
 const api={object:{userData:{}},experimentStatus:()=>state,pause:()=>{},release:async()=>{},dispose:async()=>{throw Error('release rejected');},disposalStatus:()=>({complete,errors:[{message:'release rejected'}]}),reportFailure:error=>{state.failure={message:error.message};}};
 const document={createElement:()=>({style:{},setAttribute(){},append(){},remove(){}})},capability=module.createStoneWorkbenchCapability({document},{createRuntime:async()=>api});
 const handle=await capability.stone.open({paused:true});await assert.rejects(handle.dispose(),/release rejected/);
 assert.equal(capability.current(),complete?null:api);
 if(!complete){assert.match(state.failure.message,/cleanup incomplete/);await assert.rejects(capability.stone.open(),/Close the current stone/);}
});
