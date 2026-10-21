// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('fn waveletLowPassSample(');
const body=source.slice(start,source.indexOf('\n}\n',start));
// Execute the actual component-wise return path with a uniform L1 field.
// Trilinear interpolation of that field is exact. This is a local numerical
// invariant, not evidence of GPU execution or of resolved plume dynamics.
const tail=body.slice(body.indexOf('\n',body.indexOf('let c11 =')))
  .replaceAll(/(\d)u\b/g,'$1');
const sample=new Function('p','c00','c10','c01','c11','f','mix','openWorldBoundary','ghostOutsideAmount','clamp',tail);
const evaluate=(v,outside,open)=>sample(null,v,v,v,v,{x:.3,y:.6,z:.7},
  (a,b,t)=>a*(1-t)+b*t,()=>open,()=>outside,(x,a,b)=>Math.max(a,Math.min(b,x)));
test('open inflow does not invent a wavelet high-pass from uniform bulk motion',()=>{
  for(const v of [-1.2,.7])for(const outside of [.25,1,2]){
    const transported=v*(1-Math.min(outside,1));
    assert.ok(Math.abs(transported-evaluate(v,outside,true))<1e-12,
      `uniform ${v}, outside ${outside}: boundary baseline must match transport`);
  }
});
test('interior and standalone wavelet baselines retain the measured velocity',()=>{
  for(const v of [-1.2,.7])for(const [outside,open] of [[0,true],[0,false],[2,false]])
    assert.ok(Math.abs(evaluate(v,outside,open)-v)<1e-12);
});
