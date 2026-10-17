// kaminos-test: node
import assert from 'node:assert/strict';
import { pressureResolutionPlan, restrictPressureReference } from '../volume-pressure-resolution.mjs';

assert.deepEqual(pressureResolutionPlan({ dims: [32, 64, 32] }).pressureDims, [32, 64, 32]);
assert.deepEqual(pressureResolutionPlan({ dims: [32, 64, 32], mode: 'half' }).pressureDims, [16, 32, 16], 'pressure dimensions must vary independently of the material grid');
assert.deepEqual(pressureResolutionPlan({ dims: [48, 72, 48], mode: 'half' }).materialDims, [48, 72, 48]);
for (const unsupported of [{solver:'legacy'}, {inflow:true}, {joined:true}, {dims:[32,65,32]}]) {
  const p = pressureResolutionPlan({dims:[32,64,32], mode:'half', ...unsupported});
  assert.equal(p.effective, 'off');
  assert.ok(p.reason, 'fallback must identify the unsupported route');
}
assert.equal(pressureResolutionPlan({dims:[32,64,32], mode:'equal'}).effective, 'equal');
assert.throws(() => pressureResolutionPlan({dims:[32,0,32]}), /Invalid/);
console.log('pressure resolution admission passed');

const dims=[4,6,4], count=dims.reduce((a,b)=>a*b,1), fluid=new Float32Array(count*16), expansion=new Float32Array(count).fill(0.25);
const idx=([x,y,z],d)=>x+d[0]*(y+d[1]*z);
for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++) {
  const i=idx([x,y,z],dims);
  fluid.set([(x+1)*0.125,(y+1)*0.25,(z+1)*0.5,0],i*16);
  for(let s=4;s<16;s++) fluid[i*16+s]=s;
}
const equal=restrictPressureReference({dims,divisor:1,fluid,expansion});
assert.deepEqual(equal.fluid,fluid,'equal-grid restriction is identity');
assert.deepEqual(equal.expansion,expansion);
const coarse=restrictPressureReference({dims,divisor:2,fluid,expansion});
for(let z=0;z<coarse.dims[2];z++)for(let y=0;y<coarse.dims[1];y++)for(let x=0;x<coarse.dims[0];x++) {
  const p=[x,y,z],i=idx(p,coarse.dims);
  assert.equal(coarse.expansion[i],0.25,'expansion remains a divergence, not a velocity');
  let divergence=0;
  for(let axis=0;axis<3;axis++) {
    const lower=[...p];lower[axis]--;
    divergence+=coarse.fluid[i*16+axis]-(lower[axis]<0?0:coarse.fluid[idx(lower,coarse.dims)*16+axis]);
  }
  assert.equal(divergence,0.875,'coarse divergence equals volume-mean fine divergence');
  for(let s=4;s<16;s++)assert.equal(coarse.fluid[i*16+s],s,'constant materials preserved');
}
const solids=new Uint32Array(count);solids[idx([1,1,1],dims)]=1;
const blocked=restrictPressureReference({dims,divisor:2,fluid,expansion,solids});
assert.equal(blocked.solids[0],1,'thin obstacle is retained by conservative any-solid restriction');
assert.equal(blocked.solids.reduce((a,b)=>a+b),1);
assert.equal(blocked.expansion[0],0.25*7/8,'solid expansion is not injected');
console.log('face-flux units, scalar preservation and obstacle restriction passed');
// The normal scene inspector, not just hidden Volume controls, owns the choice.
const {FLAME_PROPERTY_GROUPS}=await import('../flame-authoring.mjs');
assert.ok(FLAME_PROPERTY_GROUPS.find(g=>g.name==='Quality').fields.some(([id])=>id==='volume-pressure-resolution'),'normal scene Quality exposes pressure resolution');
const profileModule=await import('../volume-pressure-resolution.mjs');
assert.equal(typeof profileModule.pressureProfileWindows,'function');
assert.deepEqual(profileModule.pressureProfileWindows([1000n,2000n,5000n,6000n]),{mainThroughProjectionUs:5,afterMainThroughProjectionUs:4});
for(const invalid of [[0n,2000n,5000n,6000n],[2000n,1000n,5000n,6000n],[1000n,2000n,0n,6000n],[1000n,2000n,5000n,4000n]])assert.equal(profileModule.pressureProfileWindows(invalid),null);
