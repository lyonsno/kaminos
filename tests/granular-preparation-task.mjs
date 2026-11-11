// kaminos-test: node
import assert from 'node:assert/strict';
import {createPreparationTask} from '../granular-preparation-task.mjs';
import {createGranularPreparation} from '../granular-preparation.mjs';
// Transport fixture, real preparation kernel. Browser witness covers actual Worker.
class KernelWorker {
 postMessage(data){setTimeout(()=>{try{if(data.kind==='init')this.model=createGranularPreparation(data.recipe,data.snapshot);else if(data.kind==='start')this.model.start(data.operation,data.options);else if(data.kind==='advance')this.model.advance(data.seconds);this.onmessage({data:{id:data.id,state:this.model.read(),snapshot:this.model.snapshot()}});}catch(e){this.onmessage({data:{id:data.id,error:e.message}});}},0);}
 terminate(){this.model?.dispose();}
}
const t=await createPreparationTask({WorkerType:KernelWorker,recipe:{count:1,grainDetail:0}});
const pending=t.run('pour',{seconds:.1});t.pause();await pending;
assert.equal(t.read().paused,true,'Pause while start is in flight must remain paused');
assert.equal(t.read().phase.kind,'pour','Pause must retain incomplete operation');
const checkpoint=JSON.parse(JSON.stringify(t.snapshot()));
await assert.rejects(t.run('settle'),/continue/i);assert.equal(t.read().paused,true,'Rejected operation must not resume paused time');
assert.deepEqual(t.snapshot(),checkpoint);
const restored=await createPreparationTask({WorkerType:KernelWorker,snapshot:checkpoint});
assert.equal(restored.read().paused,true,'Restored active phase is paused');
await restored.run();assert.equal(restored.read().phase,null);assert.equal(restored.read().deposited,1);
await assert.rejects(restored.run(),/no preparation/i);
t.dispose();restored.dispose();
const broken=await createPreparationTask({WorkerType:class extends KernelWorker {postMessage(data){if(data.kind==='init')super.postMessage(data);else setTimeout(()=>this.onerror({message:'Lost physical worker'}),0);}},recipe:{count:1,grainDetail:0}});
await assert.rejects(broken.run('pour'),/lost physical worker/i);assert.equal(broken.read().failure,'Lost physical worker');broken.dispose();
console.log('Worker pause, JSON restore, rejected transition and failure custody pass');
