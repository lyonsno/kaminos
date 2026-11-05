// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const moduleURL=new URL('../experiments/hill-terrain/lod.mjs',import.meta.url);
assert.ok(existsSync(moduleURL),'Hill detail needs a world-aligned lattice so moving it cannot retriangulate coarse ridges');
const {detailLattice}=await import(moduleURL);
const config={resolution:193,width:8,length:9},count=193;
test('detail lattice nests in both coarse axes and retains the requested footprint',()=>{
 for(const radius of [.24,.36,.57,.999,1.001,1.12,1.999,2.001,3.4])for(const focus of [[0,0],[.137,-.419],[3.75,4.25]]){
  const g=detailLattice(config,{x:focus[0],z:focus[1],radius},count);
  assert.ok(Number.isInteger(g.level)&&g.level>=0);
  for(let a=0;a<2;a++){
   const base=[8,9][a]/192,step=g.spacing[a],origin=-[8,9][a]/2;
   const sub=base/step;assert.ok(Math.abs(sub-2**g.level)<1e-9);
   assert.ok(Math.abs((g.center[a]-origin)/step-Math.round((g.center[a]-origin)/step))<1e-9);
   assert.ok(96*step-Math.abs(g.center[a]-focus[a])>=radius,'allocated lattice must cover the continuous collar');
  }
 }
});
test('panning below one lattice step preserves shared vertex coordinates',()=>{
 const a=detailLattice(config,{x:.1,z:.2,radius:.8},count),b=detailLattice(config,{x:.1+aStep(),z:.2,radius:.8},count);
 function aStep(){return (8/192)/16;}
 assert.deepEqual(a.spacing,b.spacing);
 const shift=(b.center[0]-a.center[0])/a.spacing[0];assert.ok(Math.abs(shift-Math.round(shift))<1e-9);
 for(let i=0;i<count-Math.abs(shift);i++)assert.ok(Math.abs(a.center[0]+(i-96+shift)*a.spacing[0]-(b.center[0]+(i-96)*b.spacing[0]))<1e-9);
});
test('invalid lattice inputs fail visibly',()=>{
 for(const f of [{x:NaN,z:0,radius:1},{x:0,z:0,radius:0},{x:0,z:0,radius:Infinity}])assert.throws(()=>detailLattice(config,f,count));
 assert.throws(()=>detailLattice({...config,resolution:1},{x:0,z:0,radius:1},count));
});
test('nested triangles preserve a sharp coarse ridge between original vertices',()=>{
 // Independent piecewise-linear ridge crossing the cell diagonal. A sliding or
 // radially warped grid crosses it and changes height when retriangulated.
 const c={resolution:9,width:8,length:9};
 const source=(x,z)=>{const gx=x+4,gz=(z+4.5)/1.125,ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz;
  const h=(i,j)=>((i*7+j*3)%5)*.2+(i===4?2:0);
  return u+v<=1?h(ix,iz)+u*(h(ix+1,iz)-h(ix,iz))+v*(h(ix,iz+1)-h(ix,iz)):h(ix+1,iz+1)+(1-u)*(h(ix,iz+1)-h(ix+1,iz+1))+(1-v)*(h(ix+1,iz)-h(ix+1,iz+1));};
 for(const f of [{x:.137,z:.419,radius:.8},{x:.451,z:-.253,radius:1.31}]){
  const g=detailLattice(c,f,193);
  for(const [x,z]of [[.137,.419],[-.173,.197],[.239,-.117]]){
   const [sx,sz]=g.spacing,ix=Math.floor((x-g.center[0])/sx),iz=Math.floor((z-g.center[1])/sz),x0=g.center[0]+ix*sx,z0=g.center[1]+iz*sz,u=(x-x0)/sx,v=(z-z0)/sz;
   const a=source(x0,z0),b=source(x0+sx,z0),d=source(x0,z0+sz),e=source(x0+sx,z0+sz);
   const h=u+v<=1?a+u*(b-a)+v*(d-a):e+(1-u)*(d-e)+(1-v)*(b-e);
   assert.ok(Math.abs(h-source(x,z))<1e-10,'detail triangles must not bridge across a coarse ridge');
  }
 }
});
test('the shared alpha-map transform cuts the same world rectangle in color and depth passes',async()=>{
 const {baseMaskTransform}=await import('../experiments/hill-terrain/lod.mjs');
 assert.equal(typeof baseMaskTransform,'function','base coverage needs the renderer-propagated alpha-map contract');
 const f={x:.71,z:-.42,radius:1.12},m=baseMaskTransform(config,f,true);
 const hole=(x,z)=>{const u=(x/8+.5)*m[0]+m[1],v=(z/9+.5)*m[2]+m[3];return u>1/3&&u<2/3&&v>1/3&&v<2/3;};
 assert.equal(hole(f.x,f.z),true);
 for(const a of [[f.x+1.10,f.z],[f.x-1.10,f.z],[f.x,f.z+1.10],[f.x,f.z-1.10]])assert.equal(hole(...a),false);
 for(const a of [[f.x+1.0,f.z],[f.x,f.z-1.0]])assert.equal(hole(...a),true);
 assert.deepEqual(baseMaskTransform(config,f,false),[0,0,0,0]);
});
test('a patch coarser than the source does not claim to refine or cut out that source',()=>{
 assert.equal(detailLattice({...config,resolution:513},{x:0,z:0,radius:3.2}).refining,false);
 assert.equal(detailLattice({...config,width:1,length:1},{x:.2,z:.2,radius:3.2}).refining,false);
 assert.equal(detailLattice(config,{x:0,z:0,radius:.8}).refining,true);
});
test('the continuous relief filter covers both axes on elongated and transposed terrain',()=>{
 for(const [width,length]of [[8,9],[8,80],[80,8]]){
  const c={...config,width,length};
  const transition=(193-2)*Math.min(width,length)/192/16;
  for(const radius of [.36,transition*(1-1e-6),transition*(1+1e-6)]){
   const g=detailLattice(c,{x:.13,z:-.17,radius});
   assert.ok(g.filterSpacing>=Math.max(...g.spacing),'filter must bound the larger actual axis spacing');
  }
  const before=detailLattice(c,{x:0,z:0,radius:transition*(1-1e-6)}),after=detailLattice(c,{x:0,z:0,radius:transition*(1+1e-6)});
  assert.notEqual(before.level,after.level);
  assert.ok(Math.abs(after.filterSpacing/before.filterSpacing-1)<3e-6,'filter must stay continuous across allocation changes');
 }
});
