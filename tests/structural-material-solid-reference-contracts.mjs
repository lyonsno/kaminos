import assert from 'node:assert/strict';
let solid={};
try{solid=await import('../structural-material-solid-reference.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
assert.equal(typeof solid.graphTetrahedron,'function','A deformable elastic/damage material reference must exist before the shard comparison');
assert.equal(typeof solid.correspondencePoint,'function','The peridynamic challenger must be a distinct constitutive model');
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const X=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],material={young:1000,poisson:.25};
const graph=solid.graphTetrahedron(X,material);
const undeformed=graph.evaluate(X);close(undeformed.energy,0);
assert(undeformed.forces.flat().every(v=>Math.abs(v)<1e-10));
const rotated=X.map(([x,y,z])=>[3-y,2+x,z-1]);close(graph.evaluate(rotated).energy,0);
const stretched=X.map(([x,y,z])=>[1.01*x,y,z]);
const response=graph.evaluate(stretched),strain=(1.01**2-1)/2,mu=400,lambda=400;
close(response.energy,(lambda/2+mu)*strain**2/6);
close(response.stress[0],(lambda+2*mu)*strain);
close(response.stress[4],lambda*strain);
close(response.stress[8],lambda*strain);
for(let axis=0;axis<3;axis++)close(response.forces.reduce((sum,f)=>sum+f[axis],0),0);
for(let vertex=0;vertex<4;vertex++)for(let axis=0;axis<3;axis++){
  const a=structuredClone(stretched),b=structuredClone(stretched),h=1e-6;a[vertex][axis]+=h;b[vertex][axis]-=h;
  close(response.forces[vertex][axis],-(graph.evaluate(a).energy-graph.evaluate(b).energy)/(2*h),1e-6);
}
const broken=graph.evaluate(stretched,[false,false,false,false,false,false]);close(broken.energy,0);assert(broken.forces.flat().every(v=>Math.abs(v)<1e-10));
for(let mask=0;mask<64;mask++){
  const alive=Array.from({length:6},(_,i)=>Boolean(mask&(1<<i)));
  assert.ok(graph.evaluate(stretched,alive).energy<=response.energy+1e-12,`Releasing directions must not inject stored energy at fixed deformation: mask ${mask}`);
}
const separated=[false,true,true,false,false,true];
const separatedResponse=graph.evaluate(stretched,separated);
assert.equal(separatedResponse.active,false,'A disconnected tetrahedron must not retain cross-fragment constitutive coupling');
assert(separatedResponse.forces.flat().every(v=>Math.abs(v)<1e-10));
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const pd=solid.correspondencePoint([0,0,0],directions,{...material,volume:1,neighborVolumes:directions.map(()=>1),weights:directions.map(()=>1),stabilization:.1});
const pdr=pd.evaluate([0,0,0],directions.map(([x,y,z])=>[1.01*x,y,z]));
close(pdr.energy,(lambda/2+mu)*strain**2);
close(pdr.stress[0],response.stress[0]);
close(pd.evaluate([3,2,-1],directions.map(([x,y,z])=>[3-y,2+x,z-1])).energy,0);
const nonaffine=directions.map(p=>[...p]);nonaffine[0][1]=.1;nonaffine[1][1]=.1;
const hourglass=pd.evaluate([0,0,0],nonaffine);
assert(hourglass.stabilizationEnergy>0,'Nonaffine rank-deficient displacement needs explicit stabilization');
const free=pd.evaluate([0,0,0],directions,directions.map(()=>false));
assert.equal(free.active,false);close(free.energy,0);
assert.throws(()=>solid.graphTetrahedron([[0,0,0],[1,0,0],[2,0,0],[3,0,0]],material),/degenerate/i);
assert.throws(()=>solid.graphTetrahedron(X,{young:1000,poisson:.5}),/material/i);
const bonds=solid.microelasticBonds(X,[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],{...material,horizon:1.5,volumes:X.map(()=>1/24)});
close(bonds.evaluate(rotated).energy,0);
const bondResponse=bonds.evaluate(stretched);
for(let mask=0;mask<64;mask++)assert(bonds.evaluate(stretched,Array.from({length:6},(_,i)=>Boolean(mask&(1<<i)))).energy<=bondResponse.energy+1e-12);
for(let vertex=0;vertex<4;vertex++)for(let axis=0;axis<3;axis++){
  const a=structuredClone(stretched),b=structuredClone(stretched),h=1e-6;a[vertex][axis]+=h;b[vertex][axis]-=h;
  close(bondResponse.forces[vertex][axis],-(bonds.evaluate(a).energy-bonds.evaluate(b).energy)/(2*h),1e-6);
}
assert.throws(()=>solid.microelasticBonds(X,[],{...material,poisson:.3,horizon:1.5,volumes:X.map(()=>1/24)}),/Poisson/);
console.log('Two material reference controls pass: independent uniform-strain energy/stress, rigid motion, force gradient/balance, damaged state and explicit nonaffine penalty; no GPU or fracture-surface claim');
