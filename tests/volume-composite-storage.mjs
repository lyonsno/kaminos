// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createCompositeGrid,compositeDivergence,projectComposite} from '../volume-composite-grid.mjs';
const path=new URL('../volume-composite-storage.mjs',import.meta.url);
test('shared flux survives fine upper-face / coarse lower-face storage and lower ghosts',async()=>{
  assert.ok(existsSync(path),'joined pressure lacks a fine/coarse storage bridge');
  const {createCompositeStorageLayout,gatherCompositeFlux,scatterCompositeFlux}=await import(path);
  const grid=createCompositeGrid({shape:[4,5,4],min:[-2,-2,-2],cellWidth:1,fine:{min:[-1,-1,-1],max:[1,2,1],ratio:2}});
  const layout=createCompositeStorageLayout(grid),v=[.125,-.25,.375];
  const fine=new Float32Array(layout.fineLength).fill(17),coarse=new Float32Array(layout.coarseLength).fill(29);
  const lower=new Float32Array(layout.lowerLength);
  for(let i=0;i<fine.length;i+=16)for(let a=0;a<3;a++)fine[i+a]=v[a]/layout.fineWidth;
  for(let i=0;i<coarse.length;i+=8)for(let a=0;a<3;a++)coarse[i+a]=v[a];
  for(let a=0;a<3;a++)lower.fill(v[a]/layout.fineWidth,layout.lowerOffsets[a],layout.lowerOffsets[a+1]);
  assert.throws(()=>gatherCompositeFlux(layout,{fine,coarse,lower}),/interface source/);
  assert.throws(()=>gatherCompositeFlux(layout,{fine,coarse,interfaceSource:'fine'}),/lower/);
  const q=gatherCompositeFlux(layout,{fine,coarse,lower,interfaceSource:'fine'});
  grid.faces.forEach((f,i)=>assert.ok(Math.abs(q[i]-v[f.axis]*f.area*f.side)<1e-8));
  assert.ok(compositeDivergence(grid,q).every(x=>Math.abs(x)<1e-7));
  const output=scatterCompositeFlux(layout,q,{fine,coarse});
  assert.ok(output.lower.every((x,i)=>Math.abs(x-lower[i])<1e-7));
  for(let i=0;i<fine.length;i++)if(i%16>=3)assert.equal(output.fine[i],17);
  for(let i=0;i<coarse.length;i++)if(i%8>=3)assert.equal(output.coarse[i],29);
  const roundTrip=gatherCompositeFlux(layout,{...output,interfaceSource:'fine'});
  roundTrip.forEach((x,i)=>assert.ok(Math.abs(x-q[i])<1e-8));
  assert.ok(fine.every((x,i)=>i%16<3||x===17),'inputs stay untouched');
  const disagree=coarse.map((x,i)=>i%8<3?2*x:x);
  const coarseChosen=gatherCompositeFlux(layout,{fine,coarse:disagree,lower,interfaceSource:'coarse'});
  grid.faces.forEach((f,i)=>{if(f.b>=0&&grid.cells[f.a].level!==grid.cells[f.b].level)assert.ok(Math.abs(coarseChosen[i]-2*q[i])<1e-8);});
});
test('projected subface flow is restricted by summed flux, not a single sample',async()=>{
  assert.ok(existsSync(path),'joined pressure lacks a fine/coarse storage bridge');
  const {createCompositeStorageLayout,gatherCompositeFlux,scatterCompositeFlux}=await import(path);
  const grid=createCompositeGrid({shape:[4,4,4],cellWidth:1,fine:{min:[1,1,1],max:[3,3,3],ratio:2},solid:p=>p[0]<1&&p[1]<1});
  const layout=createCompositeStorageLayout(grid);
  const input=Float64Array.from(grid.faces,(f,i)=>Math.sin(i)*.03*f.area);
  const result=projectComposite(grid,input,{tolerance:1e-9});assert.ok(result.converged);
  const output=scatterCompositeFlux(layout,result.flux,{fine:new Float32Array(layout.fineLength).fill(7),coarse:new Float32Array(layout.coarseLength).fill(9)});
  const got=gatherCompositeFlux(layout,{...output,interfaceSource:'fine'});
  got.forEach((x,i)=>assert.ok(Math.abs(x-result.flux[i])<2e-8));
  const sums=new Map();layout.faces.forEach((m,i)=>{if(m.coarseOffset!==null)sums.set(m.coarseOffset,(sums.get(m.coarseOffset)||0)+result.flux[i]*m.sign);});
  for(const [offset,sum] of sums)assert.ok(Math.abs(output.coarse[offset]*grid.geometry.cellWidth**2-sum)<2e-8);
  // Omitted wall faces must not retain stale nonzero velocity.
  assert.equal(output.coarse[0],0);
});
