// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Execute the page's actual bridge reservation with controlled startup and host
// dependencies. Native browser exercise covers the real host and scene join.
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=page.indexOf('  const ensureTrellisHistory=()=>{');
const end=page.indexOf('  const trellisHistoryBridge=',begin);
assert.ok(begin>=0&&end>begin,'page history bridge must be present');
const source=page.slice(begin,end).replace("import('./authoring-trellis-history.mjs')",'loadHistoryModule()');
function bridge({ready,host,create}){
 return new Function('workbenchViewerReady','appGpuHost','loadHistoryModule',`
  let trellisHistoryController=null,trellisHistoryPending=null,trellisHistoryError=null;
  const renderer={},workbenchSceneHost={},document={},authoringAssetsUI=null;
  const mountTrellisHistory=value=>value;
  ${source}
  return {ensure:ensureTrellisHistory,error:()=>trellisHistoryError};
 `)(ready,host,async()=>({createAuthoringTrellisHistory:create}));
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('cold concurrent history requests wait for scene startup before acquiring their one host',async()=>{
 let resolveReady,hostCalls=0,createCalls=0,started=false;
 const ready=new Promise(resolve=>{resolveReady=resolve;});
 const controller={kind:'history'},foreground={};
 const history=bridge({ready,host:async()=>{hostCalls++;return started?{foreground}:null;},create:async options=>{createCalls++;assert.equal(options.foreground,foreground);return controller;}});
 const first=history.ensure(),second=history.ensure();
 // Observe both failures, too, so the pre-fix regression fails on its concrete
 // ordering invariant rather than an unhandled rejection from the test harness.
 const settled=Promise.allSettled([first,second]);
 await tick();
 assert.equal(hostCalls,0,'host acquisition must not run before the scene is initialized');
 assert.equal(createCalls,0);
 started=true;resolveReady();
 assert.deepEqual(await settled,[{status:'fulfilled',value:controller},{status:'fulfilled',value:controller}]);
 assert.equal(hostCalls,1);assert.equal(createCalls,1);
 assert.equal(await history.ensure(),controller);assert.equal(hostCalls,1);
});

test('a real startup failure is preserved and never promoted into a usable host',async()=>{
 const failure=new Error('Scene restoration failed');let hostCalls=0;
 const ready=Promise.reject(failure);ready.catch(()=>{});
 const history=bridge({ready,host:async()=>{hostCalls++;return {};},create:async()=>{throw Error('must not construct');}});
 await assert.rejects(history.ensure(),error=>error===failure);
 assert.equal(hostCalls,0);assert.equal(history.error(),failure.message);
});

test('host construction failure clears the reservation so the next request can recover',async()=>{
 let hostCalls=0,createCalls=0;const controller={kind:'history'};
 const history=bridge({ready:Promise.resolve(),host:async()=>{hostCalls++;if(hostCalls===1)throw Error('Device temporarily unavailable');return {foreground:{}};},create:async()=>{createCalls++;return controller;}});
 await assert.rejects(history.ensure(),/Device temporarily unavailable/);
 assert.equal(history.error(),'Device temporarily unavailable');
 assert.equal(await history.ensure(),controller);assert.equal(history.error(),null);
 assert.equal(hostCalls,2);assert.equal(createCalls,1);
});
