import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import * as core from '../finger-fluid-webgpu-core.js';import {createIPBFGridShader} from '../finger-fluid-ipbf-wgsl.mjs';
const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
function body(text,name){const start=text.indexOf('fn '+name+'(');assert.ok(start>=0,`shared host operation missing: ${name}`);const open=text.indexOf('{',start);let depth=1,i=open+1;for(;depth;i++){if(text[i]==='{')depth++;if(text[i]==='}')depth--;if(i>=text.length)throw Error('unterminated function');}return text.slice(open+1,i-1);}
test('both pressure candidates use the same inlet and reservoir host operation',()=>{
 const host=body(source,'pressure_candidate_position');
 const main=body(source,'apply_position_delta');const alternate=body(createIPBFGridShader({radius:.185,volume:.000166}), 'ipbf_delta');
 assert.match(main,/pressure_candidate_position\(/);assert.match(alternate,/pressure_candidate_position\(/);
 const js=host.replace(/\blet\b/g,'const').replace('correction * (1.0 - inletCoreWeight)','correction.map(v=>v*(1-inletCoreWeight))').replace('position + correction','position.map((v,a)=>v+correction[a])');
 const invoke=new Function('index','position','inputCorrection','params','particles','apply_active_inlet_boundary','collideDomain','constrain_active_inlet_reservoir',js);
 const params={particleShift:{z:1}},particles=[{velocity:{w:.08,xyz:[0,0,1]}}],delta=[.01,.02,-.03],inlet=()=>({w:.6}),collide=x=>x,reservoir=(_,x)=>x.map((v,a)=>a===2?Math.max(-.1,v):v);
 const a=invoke(0,[0,0,0],delta,params,particles,inlet,collide,reservoir),b=invoke(0,[0,0,0],delta,params,particles,inlet,collide,reservoir);
 for(let k=0;k<3;k++)assert.ok(Math.abs(a[k]-.4*delta[k])<1e-12);
 assert.deepEqual(a,b,'equal main and alternate pressure updates cannot acquire a host-only damping difference');
});
test('truth snapshot reports the chosen pressure boundary model',()=>{
 const x=core.measureFingerFluidTruthSnapshot(new Float32Array(16),1,{boundaryPressureContract:'ipbf-collision-projection-only-v0'});
 assert.equal(x.boundaryPressureContract,'ipbf-collision-projection-only-v0');
});
test('PBF-only optimizations are ineffective and explained under IPBF',()=>{
 assert.equal(typeof core.resolveFingerFluidPressureOptimizations,'function','pressure-specific effective configuration is missing');
 const x=core.resolveFingerFluidPressureOptimizations({pressureSolver:'ipbf',densityCellRejection:true,uniformVolumeDensityKernel:true});
 assert.equal(x.densityCellRejection,false);assert.equal(x.uniformVolumeDensityKernel,false);assert.ok(x.densityCellRejectionBypassReason);assert.ok(x.uniformVolumeDensityKernelBypassReason);
 const p=core.resolveFingerFluidPressureOptimizations({pressureSolver:'pbf',densityCellRejection:true,uniformVolumeDensityKernel:true});assert.equal(p.densityCellRejection,true);assert.equal(p.uniformVolumeDensityKernel,true);
});
