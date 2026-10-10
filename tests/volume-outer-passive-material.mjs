import assert from 'node:assert/strict';
import {outerSmokeConfig, outerSmokeShader} from '../volume-outer-smoke.mjs';

// Execute the actual material statements emitted for the native outer kernel.
// The source contract is Doctor's main-landed 62cce4a5 passive law; this is
// numeric local conformance, not a substitute for GPU/browser execution.
const shader=outerSmokeShader(outerSmokeConfig({grid:32,extent:4,nearHeightRatio:1}),32);
const advect=shader.slice(shader.indexOf('fn advect('),shader.indexOf('fn face('));
const statements=advect.match(/let end=clipCharacteristic[^;]+;([\s\S]*?)if\(nearPoint\(p\)\)/)?.[1];
assert.ok(statements,'actual outer material update must be identifiable');
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function shaderFunction(name,args) {
  const body=shader.match(new RegExp(`fn ${name}\\([^]*?\\)\\s*->\\s*f32\\s*\\{([^]*?)\\}`))?.[1];
  if(!body)return undefined; // old kernel has no conversion helper
  return new Function(...args,body.replaceAll('let ','const '));
}
const conversion=shaderFunction('heatToSmokeConversion',['heat','fuel','y','smoothstep']);
const passive=(heat,y)=>conversion?.(heat,0,y,smoothstep);
const constants=Object.fromEntries([...shader.matchAll(/const (MATERIAL_\w+):f32=([\d.]+);/g)].map(m=>[m[1],Number(m[2])]));
const execute=new Function('sampleChannel','params','p','end','pow','vec4','passiveHeatToSmokeRate',...Object.keys(constants),
  'const result={};'+statements.replaceAll('let ','const ').replaceAll('vec4<f32>','vec4')+';return result.material;');
function material(smoke,heat,y,dt) {
  return execute((end,ch)=>ch===3?smoke:heat,{stepScale:dt,cooling:.998},{y},{},Math.pow,(...v)=>v,passive,...Object.values(constants));
}
const expectedRate=(heat,y)=>smoothstep(.16,1.05,heat)*(1-smoothstep(1.18,1.85,heat))*smoothstep(-.55,.72,y)*.064;
for(const dt of [0,.25,1,2])for(const y of [-1,0,1,4])for(const heat of [0,.8,2]){
  const actual=material(.7,heat,y,dt),cooled=heat*.982**dt;
  assert.ok(Math.abs(actual[1]-cooled)<1e-12,`heat survival must match fine law at dt=${dt}: ${actual[1]} versus ${cooled}`);
  const expectedSmoke=.7*.990**dt+expectedRate(cooled,y)*dt;
  assert.ok(Math.abs(actual[0]-expectedSmoke)<1e-12,`smoke survival/conversion at heat=${heat}, y=${y}, dt=${dt}: ${actual[0]} versus ${expectedSmoke}`);
  assert.deepEqual(actual.slice(2),[0,0],'passive outer transport must not manufacture fuel or flame');
}
assert.equal(material(.7,.8,1,1)[0],material(.7,.8,4,1)[0],'upper-air conversion saturates in fine-normalised height, not outer-grid height');
assert.match(advect,/if\(nearPoint\(p\)\)\{result\.material=nearMaterial\(c\);\}/,'fine donors already aged this step replace rather than add to outer material');
console.log('actual outer passive survival, cooled-heat conversion, height and donor overwrite passed');
