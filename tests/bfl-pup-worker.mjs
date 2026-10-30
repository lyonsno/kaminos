// kaminos-test: node
import assert from 'node:assert/strict';
import {createWorkerPromptHelper} from '../models/bfl-pup/worker-client.mjs';
let workers=[];
class FakeWorker{
 constructor(){workers.push(this);this.terminated=false;}
 postMessage(request){this.request=request;}
 terminate(){this.terminated=true;}
 emit(data){this.onmessage?.({data:{requestId:this.request?.requestId,...data}});}
}
const helper=createWorkerPromptHelper({modelUrl:'/weights',WorkerClass:FakeWorker});
const controller=new AbortController();const first=helper.expand({prompt:'train',signal:controller.signal});
assert.equal(workers.length,1);controller.abort(Error('cancel while loading'));
await assert.rejects(first,/cancel while loading/);assert.equal(workers[0].terminated,true,'cancellation terminates the loader itself');
let progress=null,text=null;
const second=helper.expand({prompt:'kettle',images:['source'],onText:t=>text=t,onProgress:p=>progress=p});
workers[1].emit({type:'progress',value:{phase:'model'}});workers[1].emit({type:'text',value:'blue kettle'});
assert.equal(text,'blue kettle');assert.equal(progress.phase,'model');
workers[1].emit({type:'complete',value:{text:'blue kettle'}});
assert.equal((await second).text,'blue kettle');assert.equal(workers[1].terminated,true);
const failed=helper.expand({prompt:'x'});workers[2].emit({type:'error',value:'actual model failure'});await assert.rejects(failed,/actual model failure/);assert.equal(workers[2].terminated,true);
const disposed=helper.expand({prompt:'x'});await helper.dispose();await assert.rejects(disposed,/disposed/);assert.equal(workers[3].terminated,true);
console.log('BFL worker cancellation, cleanup and streamed results pass');
class BrokenWorker{constructor(){throw Error('worker constructor failed');}}
await assert.rejects(createWorkerPromptHelper({modelUrl:'/weights',WorkerClass:BrokenWorker}).expand({prompt:'x'}),/worker constructor failed/);
let staleText=null;
const isolated=createWorkerPromptHelper({modelUrl:'/weights',WorkerClass:FakeWorker});
const aborter=new AbortController(),stale=isolated.expand({prompt:'x',signal:aborter.signal,onText:t=>staleText=t});
const old=workers.at(-1);aborter.abort(Error('cancel old request'));await assert.rejects(stale,/cancel old/);
old.emit({type:'text',value:'stale output'});assert.equal(staleText,null,'late worker messages cannot mutate a cancelled request');

const resident=createWorkerPromptHelper({modelUrl:'/weights',WorkerClass:FakeWorker,keepLoaded:true});
const residentFirst=resident.expand({prompt:'first'}),residentWorker=workers.at(-1);
residentWorker.emit({type:'complete',value:{text:'first'}});await residentFirst;
assert.equal(residentWorker.terminated,false,'resident completion must retain its idle worker');
assert.equal(resident.resident,true);
const residentCount=workers.length,residentSecond=resident.expand({prompt:'different',images:['another']});
assert.equal(workers.length,residentCount,'next request must reuse the loaded runtime');
residentWorker.emit({type:'complete',value:{text:'different'}});assert.equal((await residentSecond).text,'different');
await resident.dispose();assert.equal(residentWorker.terminated,true);assert.equal(resident.resident,false);
const isolatedResident=createWorkerPromptHelper({modelUrl:'/weights',WorkerClass:FakeWorker,keepLoaded:true});
const one=isolatedResident.expand({prompt:'one'}),kept=workers.at(-1),oldId=kept.request.requestId;kept.emit({type:'complete',value:{text:'one'}});await one;
const two=isolatedResident.expand({prompt:'two'});let settled=false;two.then(()=>settled=true);kept.emit({type:'complete',requestId:oldId,value:{text:'stale'}});await Promise.resolve();assert.equal(settled,false,'a prior request cannot complete a resident successor');
kept.emit({type:'complete',value:{text:'two'}});assert.equal((await two).text,'two');
kept.emit({type:'error',requestId:null,value:'idle device loss'});assert.equal(kept.terminated,true);assert.equal(isolatedResident.resident,false);
await isolatedResident.dispose();
