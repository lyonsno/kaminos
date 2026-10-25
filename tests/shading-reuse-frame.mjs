// kaminos-test: node
import assert from 'node:assert/strict';
import {NodeFrame,Scene,PerspectiveCamera,TSL} from '../lib/three.webgpu.js';
import {drawShadingFrame} from '../tools/shading-reuse-frame.mjs';

// Real Three FRAME scheduling: queue completion and a second renderId do not
// refresh a pass. A changed uniform must reach the producer before capture.
const clock=new NodeFrame(),pass=TSL.pass(new Scene(),new PerspectiveCamera());
let selected=false,observed=[];
pass.updateBefore=()=>{observed.push(selected);};
const renderer={info:{get frame(){return clock.frameId;}},backend:{device:{queue:{async onSubmittedWorkDone(){}}}}};
const pipeline={render(){clock.renderId++;clock.updateBeforeNode(pass);}};
clock.update();pipeline.render();
selected=true;
const result=await drawShadingFrame({renderer,pipeline,producerFrame:()=>observed.length,waitFrame:async()=>clock.update()});
assert.deepEqual(observed,[false,true],'capture must execute the producer in the changed state');
assert.equal(result.after,result.before+1);
assert.ok(result.frame>1);
await assert.rejects(()=>drawShadingFrame({renderer,pipeline:{render(){}},producerFrame:()=>0,waitFrame:async()=>clock.update()}),/producer did not advance/);
console.log('Shading capture rejects stale FRAME output');
