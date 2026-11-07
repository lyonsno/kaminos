// kaminos-test: node
import assert from 'node:assert/strict';
import {createLatestConditioningTask} from '../image-conditioning-tasks.mjs';
const sent=[],applied=[],errors=[];const task=createLatestConditioningTask({send:x=>sent.push(x),apply:x=>applied.push(x),onError:x=>errors.push(x)});let finished=false;
const requests=Array.from({length:20},(_,i)=>task.request(i+1));requests.at(-1).then(()=>{finished=true;});
assert.equal(sent.length,1,'one smoothing request in flight while dragging');assert.equal(finished,false,'opening must await an applied preview');
task.complete({id:sent[0].id,positions:'old'});assert.equal(applied.length,0,'obsolete preview cannot become current');assert.equal(sent.length,2);assert.equal(sent[1].value,20);assert.equal(finished,false);
task.complete({id:sent[1].id,positions:'latest'});await Promise.all(requests);assert.equal(finished,true);assert.equal(applied.length,1);assert.equal(applied[0].positions,'latest');assert.equal(task.read().pending,false);
const broken=task.request(21);task.complete({id:sent.at(-1).id,error:'worker broke'});await assert.rejects(broken,/worker broke/);assert.equal(errors.length,1);
const closing=task.request(22);task.close();await assert.rejects(closing,/closed/);
console.log('latest smoothing and awaited preview settlement pass');
