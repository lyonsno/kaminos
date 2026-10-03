import assert from 'node:assert/strict';
import {evaluateJsonTransfer} from '../tools/cdp-json-transfer.mjs';
const value={payload:'abc'.repeat(4*1024*1024),tail:'complete'};
const text=JSON.stringify(value);
function client(fault){let released=false;return {get released(){return released;},async call(method,params){
 if(method==='Runtime.evaluate'){
  if(params.returnByValue)throw Error('CDP closed on large return-by-value response');
  if(fault==='evaluation')return {exceptionDetails:{text:'capture failed'}};
  return {result:{type:'object',objectId:'capture'}};
 }
 if(method==='Runtime.releaseObject'){released=true;if(fault==='closed')throw Error('cleanup socket closed');return {};}
 assert.equal(params.objectId,'capture');
 if(!params.arguments?.length)return {result:{value:text.length}};
 const [start,end]=params.arguments.map(x=>x.value);
 let chunk=text.slice(start,end);
 if(fault==='partial' && start>0)chunk=chunk.slice(1);
 if(fault==='closed' && start>0)throw Error('primary transport closed');
 if(fault==='exception' && start>0)return {exceptionDetails:{text:'read failed'}};
 return {result:{value:chunk}};
 }};}
const normal=client();assert.deepEqual(await evaluateJsonTransfer(normal,'capture()'),value);assert.ok(normal.released);
for(const [fault,message] of [['partial',/length/],['exception',/read failed/],['evaluation',/capture failed/],['closed',/primary transport closed/]]){
 const c=client(fault);await assert.rejects(evaluateJsonTransfer(c,'capture()'),message);if(fault!=='evaluation')assert.ok(c.released);
}
console.log('CDP JSON transfer contracts passed: complete payload, short chunk, exception, cleanup');
