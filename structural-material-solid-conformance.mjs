import { graphTetrahedron, microelasticBonds } from './structural-material-solid-reference.mjs';

export function materialConformanceCases(){
  const rest=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],material={young:1000,poisson:.25};
  const graph=graphTetrahedron(rest,material),links=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],pmb=microelasticBonds(rest,links,{...material,horizon:1.5,volumes:Array(4).fill(1/24)});
  const cases=[];
  for(const [name,current] of [
    ['rest',rest],['rigid',rest.map(([x,y,z])=>[3-y,x-2,z+.5])],
    ['stretch',rest.map(([x,y,z])=>[1.01*x,y,z])],
    ['mixed',rest.map(([x,y,z])=>[1.04*x+.025*y,y+.03*z,.98*z])],
  ]){
    const positions=current.map(p=>p.map(Math.fround));
    for(let mask=0;mask<64;mask++){
      const alive=Array.from({length:6},(_,i)=>!(mask&(1<<i))),expected=graph.evaluate(positions,alive);
      cases.push({name:`graph-${name}-${mask}`,input:{kind:'graph',positions,indices:[[0,1,2,3]],parameters:[graph.gradients.flatMap((p,i)=>[...p,i===0?graph.volume:0])],coefficients:[graph.stiffnessForEdges(alive)]},expected:{energy:expected.energy,active:expected.active,forces:expected.forces,cauchyStress:expected.cauchyStress}});
    }
    const alive=[true,false,true,true,false,true],expected=pmb.evaluate(positions,alive);
    cases.push({name:`pmb-${name}`,input:{kind:'pmb',positions,indices:pmb.bonds.map((b,i)=>[b.a,b.b,Number(alive[i]),0]),parameters:pmb.bonds.map(b=>[b.restLength,b.stiffness,0,0])},expected:{energy:expected.energy,forces:expected.forces}});
  }
  return cases;
}

export function inspectMaterialEvaluation(test,result){
  const errors=[],{input,expected}=test,stride=input.kind==='graph'?48:8;
  if(result?.route!=='kaminos.material-energy-gradient.webgpu.v0'||result.kind!==input.kind||result.count!==input.indices.length||result.stride!==stride)errors.push('effective material route/shape mismatch');
  const values=result?.values;
  if(!Array.isArray(values)||values.length!==input.indices.length*stride||!values.every(Number.isFinite))return[...errors,'complete finite material output required'];
  const close=(name,a,b)=>{if(Math.abs(a-b)>2e-4*Math.max(1,Math.abs(b)))errors.push(`${name}: ${a} differs from ${b}`);};
  let energy=0;const forces=input.positions.map(()=>[0,0,0]);
  for(let i=0;i<input.indices.length;i++){
    const base=i*stride,ids=input.indices[i];energy+=values[base];
    if(values[base+3]!==0)errors.push(`element ${i}: invalid deformation`);
    if(input.kind==='graph'){
      if(values[base+2]!==Number(expected.active))errors.push('effective graph connectivity mismatch');
      for(let k=0;k<4;k++)for(let a=0;a<3;a++)forces[ids[k]][a]+=values[base+4+k*4+a];
      for(let col=0;col<3;col++)for(let row=0;row<3;row++)close('Cauchy stress',values[base+20+col*4+row],expected.cauchyStress[row*3+col]);
    }else{
      if(values[base+2]!==ids[2])errors.push(`bond ${i}: effective connectivity mismatch`);
      for(let a=0;a<3;a++){forces[ids[0]][a]+=values[base+4+a];forces[ids[1]][a]-=values[base+4+a];}
    }
  }
  close('energy',energy,expected.energy);
  for(let i=0;i<forces.length;i++)for(let a=0;a<3;a++)close(`force ${i}:${a}`,forces[i][a],expected.forces[i][a]);
  return errors;
}
