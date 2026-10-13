// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompositeGrid, compositeDivergence, applyCompositePressure, projectComposite} from '../volume-composite-grid.mjs';
import {createCompositeStorageLayout, gatherCompositeFlux, scatterCompositeFlux} from '../volume-composite-storage.mjs';

// Same physical boxes, independently varied cell counts. The fine origin is
// deliberately not always a point on the outer-origin fine lattice.
for (const [ratio, span] of [[8/3,3],[3/2,2],[4/3,3]]) {
  test(`nonmatching ratio ${ratio} preserves volume, face area, pressure symmetry and storage flux`, () => {
    const shape=[span+2,span+3,span+2], min=[-.7,1.2,-2.1], H=.5;
    const fine={min:min.map(v=>v+H),max:min.map(v=>v+(span+1)*H),ratio};
    const grid=createCompositeGrid({shape,min,cellWidth:H,fine});
    const h=H/ratio, n=Math.round(span*ratio);
    assert.equal(grid.cells.filter(c=>c.level===1).length,n**3);
    assert.ok(Math.abs(grid.cells.reduce((s,c)=>s+c.volume,0)-grid.domainVolume)<1e-10);
    const areas=Array.from({length:grid.cells.length},()=>new Float64Array(6));
    for(const f of grid.faces){
      assert.ok(f.area>0&&f.distance>0);
      areas[f.a][2*f.axis+(f.side>0?1:0)]+=f.area;
      if(f.b>=0)areas[f.b][2*f.axis]+=f.area;
    }
    grid.cells.forEach((c,i)=>areas[i].forEach(a=>assert.ok(Math.abs(a-c.width**2)<1e-11,'each cell face covered once')));
    const v=[.125,-.25,.375], flux=Float64Array.from(grid.faces,f=>v[f.axis]*f.area*f.side);
    assert.ok(compositeDivergence(grid,flux).every(d=>Math.abs(d)<1e-10));
    const p=Float64Array.from(grid.cells,(_,i)=>Math.sin(i)), q=p.map((_,i)=>Math.cos(i));
    const ap=applyCompositePressure(grid,p),aq=applyCompositePressure(grid,q);
    assert.ok(Math.abs(p.reduce((s,x,i)=>s+x*aq[i]-q[i]*ap[i],0))<1e-10);
    assert.ok(p.reduce((s,x,i)=>s+x*ap[i],0)>0);
    const layout=createCompositeStorageLayout(grid);
    assert.deepEqual(layout.fineShape,[n,n,n]);
    const fineState=new Float64Array(layout.fineLength).fill(17),coarse=new Float64Array(layout.coarseLength).fill(29);
    const lower=new Float64Array(layout.lowerLength);
    for(let i=0;i<fineState.length;i+=16)for(let a=0;a<3;a++)fineState[i+a]=v[a]/h;
    for(let i=0;i<coarse.length;i+=8)for(let a=0;a<3;a++)coarse[i+a]=v[a];
    for(let a=0;a<3;a++)lower.fill(v[a]/h,layout.lowerOffsets[a],layout.lowerOffsets[a+1]);
    for(const interfaceSource of ['fine','coarse']){
      const got=gatherCompositeFlux(layout,{fine:fineState,coarse,lower,interfaceSource});
      got.forEach((x,i)=>assert.ok(Math.abs(x-flux[i])<1e-12));
    }
    const uniform=scatterCompositeFlux(layout,flux,{fine:fineState,coarse});
    uniform.fine.forEach((x,i)=>assert.ok(Math.abs(x-fineState[i])<1e-10));
    uniform.lower.forEach((x,i)=>assert.ok(Math.abs(x-lower[i])<1e-10));
    // A fine face may straddle coarse cells. Unequal patch values must sum to
    // the full-face flow; neither last-patch wins nor sum of patch velocities.
    const varying=flux.map((x,i)=>x*Math.sin(i*.31));
    const projected=projectComposite(grid,varying,{tolerance:1e-8});
    assert.ok(projected.converged);
    const output=scatterCompositeFlux(layout,projected.flux,{fine:fineState,coarse});
    const sums={fine:new Map(),lower:new Map(),coarse:new Map()};
    layout.faces.forEach((m,i)=>{for(const k of Object.keys(sums)){const o=m[k+'Offset'];if(o!==null)sums[k].set(o,(sums[k].get(o)||0)+projected.flux[i]*m.sign);}});
    for(const k of Object.keys(sums))for(const [offset,sum] of sums[k])assert.ok(Math.abs(output[k][offset]*(k==='coarse'?H**2:h**3)-sum)<1e-11,`${k} face loses flux`);
    output.fine.forEach((x,i)=>{if(i%16>=3)assert.equal(x,17);});
    output.coarse.forEach((x,i)=>{if(i%8>=3)assert.equal(x,29);});
    assert.ok([...sums.fine.keys()].some(offset=>layout.faces.filter(m=>m.fineOffset===offset).length>1),'fixture must split a fine face');
  });
}
