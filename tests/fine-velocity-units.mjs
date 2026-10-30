// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fineGridPlan} from '../volume-fine-grid.mjs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const smoothstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
const thermalBody=source.match(/fn thermalExpansionForce\([^]*?\) -> vec3<f32> \{([^]*?)\n\}/)[1];
const force=new Function('heatGradientAtCell','VELOCITY_UNIT_SCALE','smoothstep',`return (c,heat,amount)=>{${thermalBody}}`);
const close=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-10,`${label}: ${a} versus ${b}`);
test('a fixed physical heat gradient keeps its force across Fine velocity widths',()=>{
 const material=64;
 for(const velocity of [32,48,49,64,80])for(const derivative of [-.3,.1,.4]){
  const scale=velocity/material;
  const actual=force(()=>derivative*2/velocity,scale,smoothstep)(0,.8,.048)*scale*2/velocity;
  const expected=-derivative*2/material*smoothstep(.08,1.35,.8)*.048*2/material;
  close(actual,expected,`material${material}/velocity${velocity} derivative${derivative}`);
 }
});
test('velocity force evaluation packs diffusion for its own physical cell width',()=>{
 const begin=source.indexOf('    const u=uniforms.slice();',source.indexOf('  function prepareFineVelocity()'));
 const code=source.slice(begin,source.indexOf('    return fineVelocity;',begin));
 for(const velocity of [32,48,49,80]){
  const uniforms=new Float32Array(64),material=64,D=1.5e-4;uniforms[35]=D*(material/2)**2;
  let uploaded;
  const context={uniforms,plan:fineGridPlan({materialDims:[material,material,material],velocity}),GRID_SHAPE_UNIFORM_OFFSET:0,IMMERSED_SOURCE_UNIFORM_OFFSET:8,REACTANT_COMBUSTION_UNIFORM_OFFSET:32,immersedSourceUniformValues:()=>Array(24).fill(0),device:{queue:{writeBuffer:(_b,_o,u)=>{uploaded=u;}}},fineVelocity:{uniform:{},residentBytes:0},state:{immersedSource:{},fineGrid:{}}};
  vm.runInNewContext(code,context);
  assert.ok(Math.abs(uploaded[35]-D*(velocity/2)**2)<1e-7,`velocity${velocity} diffusion: ${uploaded[35]} versus ${D*(velocity/2)**2}`);
 }
});
test('lateral excitation cap preserves physical strength on the velocity lattice',()=>{
 const body=source.match(/let transportedLateralExcitation = clamp\(([^]*?)\n    \);/)[1];
 for(const velocity of [32,48,49,64,80]){
  const scale=velocity/64;
  // Run each independent vector component through the actual clamp expression.
  const scalar=body.replaceAll('vec2<f32>','Number');
  const value=new Function('transportedLateralDelta','transportedLateralGain','VELOCITY_UNIT_SCALE','clamp',`return clamp(${scalar});`)(1,.24,scale,(x,a,b)=>Math.min(b,Math.max(a,x)));
  close(value*2/velocity,.006*2/64,`velocity${velocity} excitation cap`);
 }
});
