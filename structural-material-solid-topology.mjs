import { graphTetrahedron,microelasticBonds } from './structural-material-solid-reference.mjs';

const edgePairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
export function packSolidTopology(model){
  const state=new Float32Array(model.positions.length*16);model.positions.forEach((p,i)=>state.set([...p,model.masses[i],...p,model.colors[i],0,0,0,0,...p,0],i*16));
  const elementBonds=Uint32Array.from(model.elementBonds.flatMap(edges=>[...edges,0,0]));
  return{state,elements:Uint32Array.from(model.elements.flat()),bonds:Uint32Array.from(model.bonds.flatMap(([a,b])=>[a,b,1,0])),
    incidence:Uint32Array.from([...model.incidenceOffsets,...model.incidence.flat(),...model.colorOffsets,...model.colorNodes]),parameters:model.parameters,coefficients:model.coefficients,
    elementBonds:elementBonds.length?elementBonds:new Uint32Array(4)};
}
export function prepareSolidTopology(mesh,{kind,young=1000,poisson=.25,density=1000,horizon}={}){
  if(mesh.status!=='passed'||mesh.route!=='ftetwild-cpu-wildmeshing-0.4.1')throw new Error('An admitted exterior-derived tetrahedral interior is required');
  if(!['graph','pmb'].includes(kind)||!(Number.isFinite(density)&&density>0))throw new Error('Explicit material kind and positive density required');
  const {positions,tetrahedra}=mesh;
  if(!Array.isArray(positions)||!positions.length||!positions.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw new Error('Finite material points required');
  if(!Array.isArray(tetrahedra)||!tetrahedra.length||!tetrahedra.every(ids=>Array.isArray(ids)&&ids.length===4&&new Set(ids).size===4&&ids.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length)))throw new Error('Complete valid tetrahedral indices required');
  const volumes=Array(positions.length).fill(0),references=tetrahedra.map(ids=>graphTetrahedron(ids.map(i=>positions[i]),{young,poisson}));
  references.forEach((tet,i)=>tetrahedra[i].forEach(node=>volumes[node]+=tet.volume/4));
  if(volumes.some(v=>!(v>0)))throw new Error('Unreferenced material points require explicit compaction before topology preparation');
  const totalVolume=volumes.reduce((a,b)=>a+b,0);if(!(mesh.volume>0)||Math.abs(totalVolume-mesh.volume)>mesh.volume*1e-6)throw new Error('Material topology must conserve admitted interior volume');
  const bonds=[],bondIds=new Map(),elementBonds=[];
  const bond=(a,b)=>{if(a>b)[a,b]=[b,a];const key=`${a}:${b}`;if(!bondIds.has(key)){bondIds.set(key,bonds.length);bonds.push([a,b]);}return bondIds.get(key);};
  let elements,parameters,coefficients;
  if(kind==='graph'){
    elements=tetrahedra.map(ids=>[...ids]);
    for(const ids of elements)elementBonds.push(edgePairs.map(([a,b])=>bond(ids[a],ids[b])));
    parameters=Float32Array.from(references.flatMap(tet=>tet.gradients.flatMap((g,i)=>[...g,i===0?tet.volume:0])));
    // Six binary edge states give exactly 64 possible local damage matrices.
    coefficients=new Float32Array(elements.length*64*36);
    references.forEach((tet,index)=>{for(let mask=0;mask<64;mask++)coefficients.set(tet.stiffnessForEdges(edgePairs.map((_,i)=>!(mask&(1<<i)))).flat(),(index*64+mask)*36);});
  }else{
    if(!(Number.isFinite(horizon)&&horizon>0))throw new Error('Explicit positive peridynamic horizon required');
    for(let a=0;a<positions.length;a++)for(let b=a+1;b<positions.length;b++)if(Math.hypot(...positions[a].map((v,i)=>v-positions[b][i]))<=horizon)bond(a,b);
    const reference=microelasticBonds(positions,bonds,{young,poisson,horizon,volumes});
    elements=bonds.map(([a,b])=>[a,b,1,0]);parameters=Float32Array.from(reference.bonds.flatMap(b=>[b.restLength,b.stiffness,0,0]));coefficients=new Float32Array(1);
  }
  const incidence=positions.map(()=>[]),neighbors=positions.map(()=>new Set());
  elements.forEach((ids,element)=>{
    const members=ids.slice(0,kind==='graph'?4:2);
    members.forEach((node,local)=>{incidence[node].push([element,local]);members.forEach(other=>{if(other!==node)neighbors[node].add(other);});});
  });
  if(incidence.some(list=>!list.length))throw new Error('Every admitted material point needs an active constitutive family');
  const colors=Array(positions.length).fill(-1),order=positions.map((_,i)=>i).sort((a,b)=>neighbors[b].size-neighbors[a].size||a-b);
  for(const node of order){const used=new Set([...neighbors[node]].map(i=>colors[i]));let color=0;while(used.has(color))color++;colors[node]=color;}
  const offsets=[0];for(const list of incidence)offsets.push(offsets.at(-1)+list.length);
  const colorCount=Math.max(...colors)+1,colorOffsets=[0],colorNodes=[];for(let color=0;color<colorCount;color++){colors.forEach((value,node)=>{if(value===color)colorNodes.push(node);});colorOffsets.push(colorNodes.length);}
  return{route:'kaminos.exterior-derived.material-topology.v0',bufferLayout:'compact-color-incidence-v1',kind,material:{young,poisson,density,horizon},positions:structuredClone(positions),volumes,masses:volumes.map(v=>v*density),volume:totalVolume,
    elements,bonds,elementBonds,parameters,coefficients,colors,colorCount,colorOffsets,colorNodes,incidence:incidence.flat(),incidenceOffsets:offsets,
    claim:'Prepared material topology and coefficients only; no dynamic or fracture-surface admission'};
}
