// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

const url=new URL('../volume-composite-grid.mjs',import.meta.url);
test('stationary two-way grid owns each physical cell and a shared interface flux',async()=>{
  assert.ok(existsSync(url),'current prescribed-overlap outer grid has no composite physical ownership or two-way pressure operator');
  const {createCompositeGrid,projectComposite,transportComposite}=await import(url);
  const opts={shape:[4,4,4],cellWidth:1,min:[0,0,0],fine:{min:[1,1,1],max:[3,3,3],ratio:2}};
  const grid=createCompositeGrid(opts);
  assert.equal(grid.cells.length,64-8+64);
  assert.equal(grid.cells.reduce((s,c)=>s+c.volume,0),64);
  const seam=grid.faces.filter(f=>f.b>=0&&grid.cells[f.a].level!==grid.cells[f.b].level);
  assert.equal(seam.length,96);
  assert.equal(seam.reduce((s,f)=>s+f.area,0),24);
  for(const f of seam)assert.equal(f.distance,.75);
  // A manufactured pressure impulse must be removed on both resolutions.
  const p=grid.cells.map(c=>Math.sin(c.center[0])+.3*c.center[1]);
  const flux=Float64Array.from(grid.faces,f=>f.area/f.distance*((f.b<0?0:p[f.b])-p[f.a]));
  const solved=projectComposite(grid,flux,{tolerance:1e-9});
  assert.ok(solved.converged,JSON.stringify(solved.receipt));
  assert.ok(Math.max(...solved.flux.map(Math.abs))<1e-9);
  // Transfer a nonreacting species in either direction across exactly one seam.
  const face=seam[0],fi=grid.faces.indexOf(face);
  for(const sign of [-1,1]){
    const donor=sign>0?face.a:face.b,receiver=sign>0?face.b:face.a;
    const rho=new Float64Array(grid.cells.length);rho[donor]=2;
    const q=new Float64Array(grid.faces.length);q[fi]=sign*.01;
    const next=transportComposite(grid,rho,q,{dt:1});
    assert.ok(Math.abs(next.values[donor]*grid.cells[donor].volume-(2*grid.cells[donor].volume-.02))<1e-12);
    assert.ok(Math.abs(next.values[receiver]*grid.cells[receiver].volume-.02)<1e-12);
    assert.ok(Math.abs(next.massAfter-next.massBefore)<1e-12);
  }
});

test('an exterior closure changes pressure and fine airflow without reaction',async()=>{
  assert.ok(existsSync(url),'two-way pressure capability is absent');
  const {createCompositeGrid,projectComposite}=await import(url);
  const opts={shape:[4,6,4],cellWidth:1,min:[0,0,0],fine:{min:[1,1,1],max:[3,3,3],ratio:2},
    boundary:(axis,side)=>axis===1?'open':'wall'};
  const run=closed=>{
    const g=createCompositeGrid({...opts,solid:c=>closed&&c[1]>4&&c[1]<5});
    // Localised buoyant acceleration: only the fine box receives the kick.
    const q=Float64Array.from(g.faces,f=>f.axis===1&&f.b>=0&&g.cells[f.a].level===1&&g.cells[f.b].level===1?.1*f.area:0);
    const r=projectComposite(g,q,{tolerance:1e-9});
    assert.ok(r.converged,JSON.stringify(r.receipt));
    const fineTop=g.faces.map((f,i)=>({f,q:r.flux[i]})).filter(({f})=>f.axis===1&&Math.abs(f.center[1]-3)<1e-12&&g.cells[f.a].level===1);
    return {flow:fineTop.reduce((s,f)=>s+f.q,0),max:r.receipt.maxDivergenceError};
  };
  const open=run(false),closed=run(true);
  assert.ok(open.flow>.01,JSON.stringify({open,closed}));
  assert.ok(Math.abs(open.flow-closed.flow)>.01,JSON.stringify({open,closed}));
});

test('physical refusal paths are explicit, not clipping or false convergence',async()=>{
  assert.ok(existsSync(url),'two-way pressure capability is absent');
  const {createCompositeGrid,projectComposite,transportComposite}=await import(url);
  const opts={shape:[2,2,2],cellWidth:1,min:[0,0,0],fine:{min:[0,0,0],max:[1,1,1],ratio:2}};
  assert.throws(()=>createCompositeGrid({...opts,fine:{...opts.fine,min:[.1,0,0]}}),/aligned/);
  const g=createCompositeGrid(opts),q=Float64Array.from(g.faces,(_,i)=>Math.sin(i));
  assert.equal(projectComposite(g,q,{maxIterations:0,tolerance:1e-10}).converged,false);
  assert.throws(()=>transportComposite(g,new Float64Array(g.cells.length).fill(1),q,{dt:100}),/CFL/);
  q[0]=NaN;assert.throws(()=>projectComposite(g,q),/finite/);
  const sealed=createCompositeGrid({...opts,boundary:()=> 'wall'});
  assert.throws(()=>projectComposite(sealed,new Float64Array(sealed.faces.length),{target:new Float64Array(sealed.cells.length).fill(1)}),/sealed.*incompatible/);
});

test('ratio-four faces preserve constant flow and symmetric pressure work',async()=>{
  const {createCompositeGrid,compositeDivergence,applyCompositePressure,transportComposite}=await import(url);
  const g=createCompositeGrid({shape:[3,3,3],min:[-1.5,-1.5,-1.5],cellWidth:1,
    fine:{min:[-.5,-.5,-.5],max:[.5,.5,.5],ratio:4}});
  const velocity=[.07,-.03,.04],flux=Float64Array.from(g.faces,f=>f.area*velocity[f.axis]*f.side);
  assert.ok(compositeDivergence(g,flux).every(v=>Math.abs(v)<1e-12));
  const x=Float64Array.from(g.cells,(_,i)=>Math.sin(i)),y=Float64Array.from(g.cells,(_,i)=>Math.cos(i));
  const ax=applyCompositePressure(g,x),ay=applyCompositePressure(g,y),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  assert.ok(Math.abs(dot(x,ay)-dot(y,ax))<1e-12);
  assert.ok(dot(x,ax)>0);
  const rho=new Float64Array(g.cells.length).fill(2);
  const moved=transportComposite(g,rho,flux,{dt:.5,ambient:2});
  assert.ok(moved.values.every(v=>Math.abs(v-2)<1e-12));
  assert.ok(Math.abs(moved.massAfter+moved.boundaryMassOut-moved.massBefore)<1e-12);
});
