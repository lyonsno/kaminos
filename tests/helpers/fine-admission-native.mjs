import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evalWgslBatch,withKaminosGpu} from '../../tools/shader-herder.mjs';
const core=readFileSync(new URL('../../volume-core.js',import.meta.url),'utf8');
const start=core.indexOf('    let flowKernelReconstructionActive ='),end=core.indexOf('    let state = reconstructed.velocityDensity;',start),block=core.slice(start,end);
const preamble=`
struct Params {reconstruction_kernel_controls:vec4<f32>,occupancy_controls:vec4<f32>};var<private> u:Params;
struct EmissiveMaterial {value:f32};struct RaymarchNeighborhood {value:f32};struct FlowReconstructionSample {value:f32};
const LEAN_EMISSIVE_RAYMARCH=true;var<private> display:bool;var<private> support:f32;var<private> raw:u32;var<private> filtered:u32;var<private> prepared:u32;
fn displayReconstructionActive()->bool{return display;}
fn sampleDisplayMaterialWithSupport(p:vec3<f32>,weight:f32,outSupport:ptr<function,f32>)->EmissiveMaterial{prepared++;*outSupport=support;return EmissiveMaterial(1.0);}
fn sampleRaymarchNeighborhood(p:vec3<f32>)->RaymarchNeighborhood{return RaymarchNeighborhood(support);}
fn raymarchNeighborhoodSupport(n:RaymarchNeighborhood)->f32{return n.value;}
fn directCellOpticalSupport(p:vec3<f32>)->f32{return support;}
fn directCellExitDistance(p:vec3<f32>,rd:vec3<f32>)->f32{return 1.0;}
fn sampleWorldFlowReconstruction(p:vec3<f32>)->FlowReconstructionSample{filtered++;return FlowReconstructionSample(1.0);}
fn reconstructRaymarchNeighborhood(n:RaymarchNeighborhood)->FlowReconstructionSample{raw++;return FlowReconstructionSample(1.0);}
fn sampleWorldFlowReconstructionRaw(p:vec3<f32>)->FlowReconstructionSample{raw++;return FlowReconstructionSample(1.0);}
`;
const body=`display=arg0>0.0;support=arg1;u.reconstruction_kernel_controls=vec4<f32>(arg2,0,0,0);u.occupancy_controls=vec4<f32>(1,0,0,0);raw=0u;filtered=0u;prepared=0u;
 let p=vec3<f32>(0);let rd=vec3<f32>(1,0,0);let worldActive=false;let opticalStepping=arg3>0.0;let fullGridCapture=false;let opticalTrace=false;let guided=false;let SPLIT_INTEGRAL=false;let dtBase=.1;let endT=2.0;var t=0.0;var expensiveSamples=0u;var rayMaterialSamples=0u;var iteration=0u;
 loop {if(iteration>0u){break;}iteration++;${block} }
 return vec4<f32>(f32(rayMaterialSamples),f32(raw),f32(filtered),f32(prepared));`;
 const options={preamble,argTypes:['f32','f32','f32','f32'],returnType:'vec4<f32>',body,inputs:[[0,0,0,0],[0,1,0,0],[0,1,1,0],[1,0,0,0],[1,0,0,1],[0,0,0,1]]};
 const expected=[[0,0,0,0],[1,1,0,0],[1,0,1,0],[1,0,0,1],[1,0,0,1],[1,1,0,0]];

const bad=body.replace('directSupport = raymarchNeighborhoodSupport(neighborhood);','directSupport = 1.0;');
const badPrepared=body.replace('if (displayReconstructionActive()) {\n      // The prepared field','if (false) {\n      // The prepared field');
const cases=[{label:'production Fine admission',...options},{label:'global support fault',...options,body:bad},{label:'duplicate reconstruction fault',...options,body:badPrepared}];
const modules=cases.map(o=>({label:o.label,entryPoint:'main',code:`${o.preamble}\nfn evaluate(arg0:f32,arg1:f32,arg2:f32,arg3:f32)->vec4<f32>{${o.body}}\n@group(0) @binding(0) var<storage,read_write> output:array<vec4<f32>>;@compute @workgroup_size(1) fn main(){output[0]=evaluate(0,0,0,0);}`}));
let result;
export function assertNativeFineAdmission(){return result??=withKaminosGpu(async ctx=>{
 assert.deepEqual(await evalWgslBatch(ctx,options),expected);
 assert.notDeepEqual(await evalWgslBatch(ctx,cases[1]),expected,'valid global support bypass must fail the empty-cell case');
 assert.notDeepEqual(await evalWgslBatch(ctx,cases[2]),expected,'prepared material must avoid repeated raw reconstruction');
},{wgslSources:modules});}
