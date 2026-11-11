// kaminos-test: node
import assert from 'node:assert/strict';
import {EarthSpecimen} from '../earth-specimen.mjs';
import {planEarthSurface,createEarthSurfaceTask} from '../earth-surface-task.mjs';
const model=new EarthSpecimen({columns:3,layers:2,grains:0}),snapshot=model.snapshot();model.dispose();
const limits={maxBufferSize:256*2**20,heapBytes:2**30};
const p=planEarthSurface(snapshot,24,limits);assert.ok(p.cells>0);assert.throws(()=>planEarthSurface(snapshot,400,limits),/too large/);assert.throws(()=>planEarthSurface(snapshot,4.5,limits),/integer/);
class Worker{static instances=[];constructor(){Worker.instances.push(this);}postMessage(data){this.data=data;}terminate(){this.terminated=true;}}
const task=createEarthSurfaceTask({WorkerType:Worker,limits:()=>limits});
const before=structuredClone(snapshot);const pending=task.build(snapshot,12);const worker=Worker.instances.at(-1);assert.equal(worker.data.resolution,12);task.cancel();await assert.rejects(pending,/stopped/);assert.ok(worker.terminated);assert.deepEqual(snapshot,before);
const next=task.build(snapshot,10),current=Worker.instances.at(-1);worker.onmessage({data:{source:{stale:true}}});assert.equal(task.pending,true);current.onmessage({data:{source:{schema:'test-source'}}});assert.equal((await next).schema,'test-source');assert.ok(current.terminated);
const failure=task.build(snapshot,10);Worker.instances.at(-1).onerror({message:'worker broke'});await assert.rejects(failure,/worker broke/);task.dispose();await assert.rejects(task.build(snapshot,10),/disposed/);
console.log('Surface planning, rejection before work, cancellation, stale result exclusion and error cleanup pass');
