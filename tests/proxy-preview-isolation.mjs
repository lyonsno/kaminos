// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {configureMaterialSideAODepth} from '../scene-ao-depth.mjs';
import {createInterfaceSurfelProducer} from '../proxy-snapshot.mjs';
import {fireSweepArmAdmission,waterCadenceWindowAdmission} from '../proxy-evidence-admission.mjs';

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

import {decodeHeatBlocks,HEAT_BLOCK_FLOATS} from '../proxy-snapshot.mjs';
test('residual probe partials decode into a world-space heat-block snapshot',()=>{
 // grid 8 wide, 8 tall: 2 x 2 x 2 blocks of 4^3 cells, 20 floats per block.
 const grid=8,wx=2,wy=2,wz=2,partials=new Float32Array(wx*wy*wz*20);
 const put=(bx,by,bz,{vertical=0,heat=0,smoke=0,hot=0,heatX=0,heatZ=0})=>{const at=(bx+by*wx+bz*wx*wy)*20;partials.set([vertical,heat,smoke,hot,heatX,heatZ,0,0],at+12);};
 // A hot block at (1,0,0): 64 cells of heat 0.5 centred at cell x=5.5, z=1.5.
 put(1,0,0,{heat:32,smoke:6.4,hot:32*0.8,heatX:32*5.5,heatZ:32*1.5});
 put(0,1,1,{smoke:0.001});
 const snapshot=decodeHeatBlocks({partials,grid,gridY:8,workgroupsX:wx,workgroupsY:wy,workgroupsZ:wz,floatsPerWorkgroup:20,step:48},
  {domain:{translation:[0,0.5,0],scale:2},heatThreshold:1e-3,smokeThreshold:1e-2,capturedAtMs:7});
 assert.equal(snapshot.schema,'kaminos.proxy-snapshot.v0');
 assert.equal(snapshot.kind,'heat-blocks');
 assert.equal(snapshot.count,1,'blocks below both thresholds are dropped');
 assert.equal(snapshot.floatsPerBlock,HEAT_BLOCK_FLOATS);
 const [x,y,z,heat,smoke,rise,size]=Array.from(snapshot.data.slice(0,HEAT_BLOCK_FLOATS));
 // cell 5.5 -> local -1 + (5.5+0.5)*(2/8) = 0.5; world = 0 + 2*0.5 = 1
 assert.ok(Math.abs(x-1)<1e-6&&Math.abs(z-(2*(-1+2*(2/8))))<1e-6,`lateral centroid from moments: ${x},${z}`);
 assert.ok(Math.abs(y-(0.5+2*(-1+2*(2/8))))<1e-6,`block centre height: ${y}`);
 assert.ok(Math.abs(heat-0.5)<1e-6&&Math.abs(smoke-0.1)<1e-6,'block means per cell');
 assert.ok(Math.abs(rise-0.8)<1e-6,'heat-weighted rise speed');
 assert.ok(Math.abs(size-2*4*(2/8))<1e-6,'block world size');
 assert.equal(snapshot.writeTick,48);
 assert.deepEqual(snapshot.summary.count,1);
 assert.ok(Math.abs(snapshot.summary.heatCentroid[0]-1)<1e-6);
 assert.throws(()=>decodeHeatBlocks({partials:new Float32Array(3),grid,gridY:8,workgroupsX:wx,workgroupsY:wy,workgroupsZ:wz,floatsPerWorkgroup:20},{domain:{translation:[0,0,0],scale:1}}),/partials/);
});

test('a fire sweep arm without a complete primary frame is excluded',()=>{
 const requested={steps:6,scale:0.5,mode:'numerical'},effective={raySteps:6,renderScale:0.5,opticalStepping:'numerical'};
 assert.equal(fireSweepArmAdmission(requested,effective,null,{frame:{ok:true,width:4,height:2,bytes:32}}).admitted,true);
 const missing=fireSweepArmAdmission(requested,effective,null,{frame:{ok:false,reason:'inactive'}});
 assert.equal(missing.admitted,false);
 assert.match(missing.reasons.join(' '),/frame/);
 assert.equal(fireSweepArmAdmission(requested,effective,null,{frame:{ok:true,width:4,height:2,bytes:8}}).admitted,false,'a partial frame is not a frame');
 assert.equal(fireSweepArmAdmission(requested,effective,null,{renders:{ok:3,failed:1}}).admitted,false,'failed timed renders are not timed renders');
});

test('a water cadence window is admitted only with the requested workload in effect',()=>{
 const proxy4={label:'proxy-step4',water:'proxy',stepEvery:4};
 const good={presentation:'proxy',timePolicy:'one-fixed-1/60-step-every-4-rendered-frames',surfels:3100,producerError:null};
 assert.deepEqual(waterCadenceWindowAdmission(proxy4,good),{admitted:true,reasons:[]});
 assert.equal(waterCadenceWindowAdmission(proxy4,{...good,timePolicy:'one-fixed-1/60-step-per-rendered-frame'}).admitted,false,'ineffective step interval');
 assert.equal(waterCadenceWindowAdmission(proxy4,{...good,surfels:0}).admitted,false,'empty proxy');
 assert.equal(waterCadenceWindowAdmission(proxy4,{...good,producerError:'map failed'}).admitted,false,'producer failure');
 assert.equal(waterCadenceWindowAdmission({label:'full',water:'full',stepEvery:1},{presentation:'full',timePolicy:'one-fixed-1/60-step-per-rendered-frame',surfels:null,producerError:null}).admitted,true,'full needs no proxy');
 assert.equal(waterCadenceWindowAdmission({label:'full',water:'full',stepEvery:1},{presentation:'proxy',timePolicy:'one-fixed-1/60-step-per-rendered-frame'}).admitted,false);
});

import {checkedViewportDisplay as checkedDisplay,VIEWPORT_FIRE_TOGGLE_HTML} from '../viewport-display-settings.mjs';
test('fire display is a validated viewport preference and heat-block summaries carry the peak',()=>{
 assert.equal(checkedDisplay().fire,'full');
 assert.equal(checkedDisplay({fire:'proxy'}).fire,'proxy');
 assert.throws(()=>checkedDisplay({fire:'wire'}),/fire/);
 assert.match(VIEWPORT_FIRE_TOGGLE_HTML,/data-fire="proxy"/);
 const grid=4,partials=new Float32Array(20);partials.set([0,32,6.4,0,32*1.5,32*1.5,0,0],12);
 const snapshot=decodeHeatBlocks({partials,grid,gridY:4,workgroupsX:1,workgroupsY:1,workgroupsZ:1,floatsPerWorkgroup:20,step:16},{domain:{translation:[0,0,0],scale:1}});
 assert.ok(Math.abs(snapshot.summary.heatMax-0.5)<1e-6&&Math.abs(snapshot.summary.smokeMax-0.1)<1e-6);
});
