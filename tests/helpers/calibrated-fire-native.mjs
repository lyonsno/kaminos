import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evalWgslBatch,extractWgslFunction,withKaminosGpu} from '../../tools/shader-herder.mjs';
const core=readFileSync(new URL('../../volume-core.js',import.meta.url),'utf8');
const fn=name=>extractWgslFunction(core,name);
const between=(start,end)=>core.slice(core.indexOf(start),core.indexOf(end,core.indexOf(start)));
const near=(rows,expected)=>rows.forEach((row,i)=>{const a=Array.isArray(row)?row:[row],b=Array.isArray(expected[i])?expected[i]:[expected[i]];a.forEach((x,j)=>assert.ok(Math.abs(x-b[j])<2e-6,`${a} != ${b}`));});
function compileCase({label,options:o}){return {label,entryPoint:'main',code:`${o.preamble}\nfn evaluate(${o.argTypes.map((t,i)=>`arg${i}:${t}`).join(',')})->${o.returnType}{${o.body}}\n@group(0) @binding(0) var<storage,read_write> output:array<${o.returnType}>;@compute @workgroup_size(1) fn main(){output[0]=evaluate(${o.argTypes.map(t=>`${t}(0)`).join(',')});}`};}
// Intact production helpers and statement blocks, controlled dependencies.
// These isolate arithmetic and routing; full-kernel dynamics and bindings have
// separate native source/scene witnesses. Fallback compiles these exact cases.
const cases=[];
function add(label,options,expected,{negative=false}={}){cases.push({label,options,check:rows=>negative?assert.notDeepEqual(rows,expected):near(rows,expected)});}
const base=`struct Params {transport_controls:vec4<f32>,reserved_source_extension_2:vec4<f32>,fire_smoke_curl_speed:vec4<f32>};var<private> u:Params;const VELOCITY_UNIT_SCALE=1.0;var<private> gain:f32;fn calibrationCellGain()->f32{return gain;}\n${['transportBacktraceScale','timeStepScale','dynamicsSpeed','dynamicsBacktraceScale','boundVelocity'].map(fn).join('\n')}`;
const bound={preamble:base,argTypes:['f32','f32','f32'],returnType:'vec4<f32>',body:`gain=arg0;u.transport_controls=vec4<f32>(arg1,0,2,0);u.reserved_source_extension_2=vec4<f32>(0,0,arg2,1);u.fire_smoke_curl_speed=vec4<f32>(0,0,0,.5);let v=boundVelocity(vec3<f32>(-10,10,0));return vec4<f32>(v,length(v));`,inputs:[[1,0,0],[2,0,0],[.5,0,0],[1,1,1]]};
const boundExpected=[1,2,.5].map(g=>[-.34*g,.52*g,0,Math.hypot(.34*g,.52*g)]);const maximum=2/((2.55+.55)*.5);boundExpected.push([-maximum/Math.SQRT2,maximum/Math.SQRT2,0,maximum]);
add('calibrated velocity bound',bound,boundExpected);add('missing calibration negative control',{...bound,preamble:base.replace(fn('boundVelocity'),fn('boundVelocity').replaceAll(' * calibrationCellGain()',''))},boundExpected,{negative:true});
const fold=between('  let forceIncrement = (vel - velTransported','  // Immersed source momentum:');
const foldBase=`const VELOCITY_UNIT_SCALE=1.0;var<private> gain:f32;var<private> faces:bool;var<private> written:vec3<f32>;fn calibrationCellGain()->f32{return gain;}fn faceForcesOn()->bool{return faces;}fn forceDeltaStore(c:vec3<i32>,v:vec3<f32>){written=v;}`;
const foldOptions={preamble:foldBase,argTypes:['f32','f32','f32'],returnType:'vec4<f32>',body:`gain=arg0;faces=arg2>0.0;written=vec3<f32>(0);let cellI=vec3<i32>(0);let timeStep=arg1;let velTransported=vec3<f32>(.1,.2,0);let centredForce=vec3<f32>(.05,.06,0);var vel=velTransported+vec3<f32>(.3,.4,0)+centredForce;${fold}return vec4<f32>(vel.xy,written.xy);`,inputs:[[1,0,0],[1,.5,0],[2,1,0],[2,.5,1]]},foldExpected=[[.1,.2,0,0],[.275,.43,0,0],[.5,.72,0,0],[.25,.4,.05,.06]];
add('calibrated centred force fold',foldOptions,foldExpected);add('missing fold conversion negative control',{...foldOptions,body:foldOptions.body.replace(fold,fold.replace(' * calibrationCellGain()',''))},foldExpected,{negative:true});
const detail=between('  vel = vel + detailForce *','  vel = vel + microForce');
add('calibrated detail increment',{preamble:'const VELOCITY_UNIT_SCALE=1.0;var<private> gain:f32;fn calibrationCellGain()->f32{return gain;}',argTypes:['f32'],returnType:'vec3<f32>',body:`gain=arg0;let detailForce=vec3<f32>(.2,.3,.4);var vel=vec3<f32>(.1);${detail}return vel;`,inputs:[[0],[1],[2]]},[[.1,.1,.1],[.3,.4,.5],[.5,.7,.9]]);
const confinement=between('  vel = vel + confinement *','  // Wavelet turbulence:');
add('calibrated confinement increment',{preamble:'var<private> confGain:f32;fn calibrationConfinementGain()->f32{return confGain;}',argTypes:['f32'],returnType:'vec3<f32>',body:`confGain=arg0;let confinement=vec3<f32>(.2,.3,.4);var vel=vec3<f32>(.1);${confinement}return vel;`,inputs:[[0],[1],[2]]},[[.1,.1,.1],[.3,.4,.5],[.5,.7,.9]]);
for(const [field,start,end,a,b,expected]of[
 ['heat','  heat = min(heat * stepRate','  fuel = fuel * stepRate','materialWallFade','materialHeatTopFade',[2,.096,.28]],
 ['fuel','  fuel = fuel * stepRate','  reactantFreshBurnRate =','materialWallFade','materialHeatTopFade',[2,.232,0]],
 ['flame','  flame = flame * stepRate(mix(0.12','  ember = ember * stepRate(mix(0.18','wallFade','fireTopFade',[2,.0192,0]],
])add('production '+field+' sponge and containment',{preamble:'fn stepRate(v:f32)->f32{return v;}',argTypes:['f32','f32','f32'],returnType:'f32',body:`var ${field}=2.0;let ${a}=arg0;let ${b}=arg1;let worldSmokeOnlyFlameEnvelope=arg2;${between(start,end)}return ${field};`,inputs:[[1,1,1],[0,0,1],[1,1,0]]},expected);
const velocityLine=between('  let advectVelocity = select(materialTransportVelocity','  let backtraceScale =');
add('material-only characteristic uses predicted momentum only for MacCormack',{preamble:'struct P{transport_controls:vec4<f32>};var<private> u:P;var<private> fluidPredict:array<vec4<f32>,1>;fn materialTransportVelocity(c:vec3<f32>,v:vec3<f32>)->vec3<f32>{return v;}',argTypes:['f32','f32'],returnType:'vec3<f32>',body:`let MATERIAL_ONLY=arg0>0.0;u.transport_controls=vec4<f32>(arg1,0,0,0);fluidPredict[0]=vec4<f32>(.8,.7,.6,0);let base=0u;let cell=vec3<f32>(0);let centreVelocity=vec3<f32>(.1,.2,.3);${velocityLine}return advectVelocity;`,inputs:[[0,0],[0,2],[1,0],[1,2]]},[[.1,.2,.3],[.1,.2,.3],[.1,.2,.3],[.8,.7,.6]]);
let result;
export function assertCalibratedFireNumerics(){return result??=withKaminosGpu(async ctx=>{for(const c of cases)c.check(await evalWgslBatch(ctx,c.options));},{wgslSources:cases.map(compileCase)});}
