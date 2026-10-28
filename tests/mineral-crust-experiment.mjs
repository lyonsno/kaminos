// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,AmbientLight} from '../lib/three.webgpu.js';
import experiment from '../experiments/mineral-crust.experiment.mjs';
async function mount(rate){const scene=new Scene(),light=new AmbientLight(0xffffff,1);scene.add(light);let frame,view={position:[2,2,2],target:[0,0,0],fov:40},root;
 const session={readView:()=>structuredClone(view),setView(value){if(value.position?.some(x=>!Number.isFinite(x)))throw Error('Invalid view');view={...view,...value};return structuredClone(view);},async attach(value){root=value;scene.add(root);return {id:'owned-crust',root,owned:true};},redraw(){},onFrame(callback){frame=callback;return ()=>{frame=null;};},async dispose(){scene.remove(root);}};
 const feature=await experiment.create({host:{scene:{open:async()=>session}},inputs:{rows:1,rate},record(){}});return {feature,frame:delta=>frame({deltaSeconds:delta}),scene,light};
}
test('live evolution keeps fixed physical steps across display cadences and stops at zero rate',async()=>{
 const a=await mount(8),b=await mount(8);a.feature.operations.play(true);b.feature.operations.play(true);for(let i=0;i<60;i++)a.frame(1/60);for(let i=0;i<120;i++)b.frame(1/120);
 assert.deepEqual(a.feature.operations.checkpoint().state,b.feature.operations.checkpoint().state);assert.equal(a.feature.read().tick,80);
 a.feature.operations.rate(0);const before=a.feature.operations.checkpoint().state;a.frame(1);assert.deepEqual(a.feature.operations.checkpoint().state,before);
 await a.feature.dispose();await b.feature.dispose();
});
test('invalid saved view leaves the running material intact and disposing restores borrowed lighting',async()=>{
 const x=await mount(1),before=x.feature.operations.checkpoint(),bad=structuredClone(before);bad.view.position=[NaN,1,1];assert.throws(()=>x.feature.operations.restore(bad),/view/i);assert.deepEqual(x.feature.operations.checkpoint().state,before.state);
 assert.equal(x.light.visible,false);await x.feature.dispose();assert.equal(x.light.visible,true);assert.equal(x.scene.children.length,1);
});
