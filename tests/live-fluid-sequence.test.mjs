// kaminos-test: node
import assert from 'node:assert/strict';
import {createLiveFluidSequenceAdapter} from '../live-fluid-sequence.mjs';
import {renderSequence} from '../simulation-sequence.mjs';
function fixture(){
 let step=0,mode='legacy_shading',renders=0;
 const runtime=()=>({available:true,solver_backend:'webgpu_compute',effectiveRendererMode:'screen_space_refraction',opticalDebugMode:'shaded',effectiveOpticalLightingMode:mode,effectiveOpticalFootprintMode:'resolved_detail',effectiveTransmissionFootprintMode:'resolved_exit',effectiveBodyTransportMode:'parametric_slab',effectiveInterfaceFrequencyMode:'normal_resolved'});
 const window={kaminosWorkbenchExperiments:{state:()=>({id:'lazarus/finite-pbf'}),read:()=>({settings:{},sampling:{}})},kaminosFingerFluidBenchSessionState:()=>({available:true,generation:1,step,fixedTimeStepSeconds:1/240,paused:true}),kaminosFingerFluidBenchDebugState:()=>({runtime:runtime(),config:{effectiveRendererMode:'screen_space_refraction',effectiveOpticalDebugMode:'shaded',requestedOpticalLightingMode:'transport_only'}}),kaminosFingerFluidBenchViewportState:()=>({effective:'shared',lastFrame:{presentedByHost:true,width:2,height:1,opticalDebugMode:'shaded'}}),kaminosCameraDebugState:()=>({position:[0,0,1]}),kaminosFingerFluidBenchRenderCurrentStateForWitness:(renderer,debug,lighting)=>{mode=lighting;renders++;},document:{getElementById:()=>({toBlob:cb=>cb(new Blob([new Uint8Array([1,2,3])]))})}};
 const adapter=createLiveFluidSequenceAdapter({window,source:{fixture:true},hold(){},advance(n){step=n;mode='transport_only';}});
 return {adapter,mode:()=>mode,change:()=>{mode=mode==='legacy_shading'?'transport_only':'legacy_shading';},renders:()=>renders};
}
if(!process.argv.includes('--drift-only')){
const f=fixture(),frames=[];let initial,terminal;
await renderSequence({adapter:f.adapter,sink:{async begin(){},async initial(v){initial=v;},async frame(v){frames.push({...v,mode:f.mode()});},async finish(v){terminal=v;}},request:{startSeconds:0,endSeconds:1/240,fps:240}});
assert.deepEqual(frames.map(f=>f.mode),['legacy_shading','legacy_shading'],'Export must preserve the actual current lighting across initial render and advance');
assert.equal(initial.initial.view.optics.effectiveOpticalLightingMode,'legacy_shading');assert.equal(terminal.status,'complete');
}
const d=fixture();let result;
await assert.rejects(renderSequence({adapter:d.adapter,sink:{async begin(){},async initial(){},async frame(){d.change();},async finish(v){result=v;}},request:{startSeconds:0,endSeconds:1/240,fps:240}}),/changed/);
assert.equal(result.status,'failed');assert.equal(result.completedFrames,1);
console.log('Effective optics preserved through initial render/advance; optical drift rejects mixed output');
