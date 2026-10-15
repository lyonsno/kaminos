// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {configureMaterialSideAODepth} from '../scene-ao-depth.mjs';
import {createInterfaceSurfelProducer} from '../proxy-snapshot.mjs';
import {fireSweepArmAdmission} from '../scripts/fire-proxy-sweep-admission.mjs';

test('an active proxy mesh stays out of the AO depth draw while ordinary meshes enter it',()=>{
 const drawn=[];
 const renderer={target:null,objectFunction:null,
  setRenderTarget(t){this.target=t;},setRenderObjectFunction(fn){this.objectFunction=fn;},renderObject(object){drawn.push(object.name);},
  render(scene){for(const object of scene.children)this.objectFunction(object,scene,null,null,{side:0},null);}};
 const aoPass={setDepthPass(){},updateBefore(){return 'ao';}};
 const scene={overrideMaterial:null,children:[{name:'kiln',userData:{}},{name:'Water proxy surfels',userData:{kaminosProxyPreview:true}}]};
 const RendererUtils={resetRendererAndSceneState:()=>({}),restoreRendererAndSceneState(){}};
 configureMaterialSideAODepth(aoPass,{scene,camera:{},depthRT:{},depthMaterial:{side:0}},RendererUtils);
 assert.equal(aoPass.updateBefore({renderer}),'ao');
 assert.deepEqual(drawn,['kiln'],'the proxy is a viewport presentation, not scene occlusion');
});

function fakeDevice({failCountersMap=false}={}) {
 const buffers=[],maps=[];
 const buffer=(label,size)=>{const b={label,size,state:'unmapped',destroyed:false,unmaps:0,
  mapAsync(){this.state='pending';return new Promise((resolve,reject)=>maps.push({buffer:this,resolve:()=>{this.state='mapped';resolve();},reject:()=>{this.state='unmapped';reject(Error('map failed'));}}));},
  getMappedRange(){return new ArrayBuffer(this.size);},unmap(){this.state='unmapped';this.unmaps++;},destroy(){this.destroyed=true;}};buffers.push(b);return b;};
 const submitted=[];
 const device={createBuffer:({label,size})=>buffer(label,size),
  createCommandEncoder:()=>({copies:[],copyBufferToBuffer(src,so,dst){this.copies.push(dst);},finish(){return this;}}),queue:{submit:list=>submitted.push(...list)}};
 const settle=async()=>{for(const m of maps.splice(0)){if(failCountersMap&&m.buffer.label.includes('counters'))m.reject();else m.resolve();}await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));};
 return {device,buffers,submitted,settle};
}
const descriptorFor=device=>()=>({device,recordsBuffer:{},countersBuffer:{},recordFloats:20,recordBytes:80,counterBytes:40,capacity:4,activeCountCounterIndex:0,
 fields:{positionId:0,velocityConfidence:4,normalCurvature:8,thicknessContactWetnessMaterial:12},writeTick:1});

test('disposing during a pending readback releases the staging pair once the maps settle',async()=>{
 const f=fakeDevice(),published=[];
 const producer=createInterfaceSurfelProducer({descriptor:descriptorFor(f.device),everyFrames:1,onSnapshot:s=>published.push(s)});
 producer.tick();producer.dispose();
 await f.settle();
 assert.equal(published.length,0,'nothing is published after disposal');
 for(const b of f.buffers){assert.notEqual(b.state,'mapped',`${b.label} left mapped`);assert.equal(b.destroyed,true,`${b.label} not destroyed`);}
});

test('a partial map failure retires the staging pair instead of copying into a mapped buffer',async()=>{
 const f=fakeDevice({failCountersMap:true});
 const producer=createInterfaceSurfelProducer({descriptor:descriptorFor(f.device),everyFrames:1,onSnapshot:()=>{}});
 producer.tick();await f.settle();
 const first=f.buffers.slice(0,2);
 for(const b of first){assert.notEqual(b.state,'mapped',`${b.label} left mapped after the failure`);assert.equal(b.destroyed,true,`${b.label} reused after the failure`);}
 assert.match(producer.state().lastError,/map failed/);
 producer.tick();
 const lastCopy=f.submitted.at(-1).copies;
 assert.ok(lastCopy.every(b=>!first.includes(b)&&b.state!=='mapped'),'the next copy targets a fresh unmapped pair');
 producer.dispose();
});

test('a fire sweep arm whose requested mode or controls did not take effect is excluded, not compared',()=>{
 const requested={steps:6,scale:0.5,mode:'numerical'};
 assert.deepEqual(fireSweepArmAdmission(requested,{raySteps:6,renderScale:0.5,opticalStepping:'numerical'},null),{admitted:true,reasons:[]});
 const refused=fireSweepArmAdmission(requested,{raySteps:6,renderScale:0.5,opticalStepping:'current'},'optical stepping comparison requires native emissive beauty raymarch');
 assert.equal(refused.admitted,false);
 assert.match(refused.reasons.join(' '),/stepping/);
 assert.equal(fireSweepArmAdmission(requested,{raySteps:12,renderScale:0.5,opticalStepping:'numerical'},null).admitted,false,'capped ray steps are a different arm');
 assert.equal(fireSweepArmAdmission(requested,{raySteps:6,renderScale:0.75,opticalStepping:'numerical'},null).admitted,false,'changed render scale is a different arm');
});
