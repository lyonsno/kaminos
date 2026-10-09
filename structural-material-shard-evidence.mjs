import {materialComponents} from './structural-material-solid-surface.mjs';
import {applyComponentAffineField} from './structural-material-component-affine.mjs';
import {bindComponentTransport,applyComponentTransport,COMPONENT_TRANSPORT_ROUTE} from './structural-material-component-transport.mjs';
export function inspectInteriorShardWitness(w){return inspectShardWitness(w,{interior:true});}
function inspectGpuSurface(w){
 if(!w.pieces?.some(p=>p.renderedPositionsSource==='cpu-transport-reference-for-picking')&&w.identity?.surface!=='resident-vertex-transport')return[];
 const s=w.surfaceObservation,route='kaminos.deformable-surface.resident-vertex-transport.webgpu.v0';
 if(w.identity.renderer!=='three-webgpu-visual-consumer'||w.identity.surface!=='resident-vertex-transport'||w.identity.surfaceState!=='published-gpu-copy'||s?.source!=='native-webgpu-transport-compute-readback'||s.runId!==w.runId||s.steps!==w.state?.steps||!Array.isArray(s.pieces)||s.pieces.length!==w.pieces.length||new Set(s.pieces.map(p=>p.pieceId)).size!==s.pieces.length)return['GPU surface identity or current native observation absent'];
 for(const p of w.pieces){const actual=s.pieces.find(x=>x.pieceId===p.id);if(p.surfaceRoute!==route||actual?.route!==route||actual.runId!==w.runId||actual.step!==w.state.steps||!Array.isArray(actual.gpu)||actual.gpu.length*3!==p.renderedPositions?.length||actual.gpu.some((v,i)=>!Array.isArray(v)||v.length!==3||v.some((x,k)=>!Number.isFinite(x)||Math.abs(x-p.renderedPositions[i*3+k])>3e-6)))return['GPU surface differs from the complete current picking reference'];}
 return[];
}
export function inspectShardWitness(w,{model=w?.state?.model,interior=false}={}){
 const errors=[];if(w?.route!==(interior?'kaminos.picked-stone.interior-shards.webgpu.v0':'kaminos.picked-stone.stress-shards.webgpu.v0')||w.phase!=='interactive'||w.failure)return['Live picked-stone route failed or substituted'];
 if(w.identity?.backend!=='webgpu'||w.identity.adapterFallback!==false)errors.push('Native GPU material authority absent');
 errors.push(...inspectGpuSurface(w));
 if(w.state?.route!=='kaminos.deformable-material.colored-vbd.webgpu.v0'||w.state.kind!=='graph'||!w.runId||w.runId!==w.state.runId)errors.push('Resident material identity differs');
 if(w.sourceSha256!=='33eb6f774a3b2bd52751c052029b529359957a71ec3eeee2e93c51bee46d8011'||!w.preparationSha256)errors.push('Admitted imported source absent');
 if(model?.kind!=='graph'||!['points','elements','bonds'].every(k=>Number.isInteger(model[k])&&model[k]>0))return[...errors,'Effective material inventory required; historical replay needs its explicit admitted model'];
 if(w.state?.model&&['kind','points','elements','bonds'].some(k=>w.state.model[k]!==model[k]))errors.push('Reported material inventory differs from expected model');
 const matrix=m=>Array.isArray(m)&&m.length===3&&m.every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite));
 if(!Array.isArray(w.state?.state)||w.state.state.length!==model.points*16||!w.state.state.every(Number.isFinite)||!Array.isArray(w.state?.bonds)||w.state.bonds.length!==model.bonds*4||!Array.isArray(w.state?.diagnostics)||w.state.diagnostics.length!==model.points*24||!w.state.diagnostics.every(Number.isFinite)||!Array.isArray(w.state?.stresses)||w.state.stresses.length!==model.elements||w.state.stresses.some(s=>s.invalid!==false||typeof s.active!=='boolean'||!matrix(s.stress)||!matrix(s.F)||![s.volume,s.energy].every(Number.isFinite)))return[...errors,'Incomplete or invalid material output'];
 if(!Array.isArray(w.pieces)||!w.pieces.length||new Set(w.pieces.map(p=>p.id)).size!==w.pieces.length||!Array.isArray(w.events)||w.events.length!==(interior?w.interior?.epoch:w.state.damageEpoch))errors.push('Fragment inventory or damage history incomplete');
 try{
  const n=w.state.state.length/16,current=Array.from({length:n},(_,i)=>w.state.state.slice(i*16+4,i*16+7)),components=materialComponents(n,w.state.bonds);
  if(interior){
   if(w.interior?.law!=='stvk-log-volume-barrier-v0'||!(w.configuration.volumeBarrier>0)||w.state.volumeBarrier!==Math.fround(w.configuration.volumeBarrier))throw new Error('Explicit resident compression law identity is missing or substituted');
   const m=w.interior?.mesh;if(w.interior?.route!=='kaminos.conservative-interior-plane-cut.v0'||!Array.isArray(m?.positions)||m.positions.length!==n||!Array.isArray(m.tetrahedra)||m.tetrahedra.length!==model.elements||!Array.isArray(m.domains)||m.domains.length!==model.elements||w.interior.nodeDomains?.length!==n||w.interior.transfers?.length!==w.interior.epoch||!w.interior.materialRuns?.includes(w.runId))throw new Error('Complete supported interior and generation history required');
   const incidence=Array(n).fill(0);for(let t=0;t<m.tetrahedra.length;t++){const ids=m.tetrahedra[t];if(!Array.isArray(ids)||ids.length!==4||new Set(ids).size!==4||ids.some(i=>!Number.isInteger(i)||i<0||i>=n||w.interior.nodeDomains[i]!==m.domains[t])||!w.state.stresses[t].active)throw new Error('Interior has absent or foreign elastic families');ids.forEach(i=>incidence[i]++);}if(incidence.some(v=>v===0))throw new Error('Interior contains unsupported material points');
   for(let i=0;i<n;i++)if(m.positions[i].some((v,k)=>Math.abs(v-w.state.state[i*16+k])>1e-6))throw new Error('Interior rest identity differs from resident material');
   if(w.pieces.some(p=>p.nodes.some(i=>w.interior.nodeDomains[i]!==p.id)))throw new Error('Visible fragment differs from supported interior domain');
   if(w.state.bonds.some((v,i)=>i%4===2&&v!==1))throw new Error('Interior cut route cannot substitute edge-energy removal');
  }
  const owned=(w.pieces??[]).flatMap(p=>p.nodes??[]);
  if(owned.length!==n||new Set(owned).size!==n||owned.some(i=>!Number.isInteger(i)||i<0||i>=n)||new Set((w.pieces??[]).map(p=>p.component)).size!==new Set(components).size)throw new Error('Visible fragments do not cover the complete material inventory');
  for(const piece of w.pieces??[]){
   if(!piece.nodes?.length||piece.nodes.some(i=>components[i]!==piece.component)||!(piece.volume>0)||piece.binding.component!==piece.component)throw new Error('Piece has foreign or absent material ownership');
   const g=piece.geometry;if(!Number.isInteger(g?.numProp)||g.numProp<12||!Array.isArray(g.properties)||!g.properties.length||g.properties.length%g.numProp||!g.properties.every(Number.isFinite)||!Array.isArray(g.indices)||!g.indices.length||g.indices.length%3||!g.indices.every(i=>Number.isInteger(i)&&i>=0&&i<g.properties.length/g.numProp)||!Array.isArray(g.exterior)||g.exterior.length!==g.indices.length/3||!g.exterior.every(v=>typeof v==='boolean')||!Array.isArray(piece.binding.entries)||piece.binding.entries.length!==g.properties.length/g.numProp)throw new Error('Complete nonempty fragment geometry and reconstruction required');
   if(piece.binding.route===COMPONENT_TRANSPORT_ROUTE){if(piece.binding.frame.ids.length!==piece.nodes.length||piece.binding.frame.ids.some((id,i)=>!piece.nodes.includes(id)||piece.binding.frame.rest[i].some((x,k)=>Math.abs(x-w.state.state[id*16+k])>1e-6))||piece.binding.entries.some((e,i)=>e.point.some((x,k)=>x!==g.properties[i*g.numProp+k])))throw new Error('Transport correspondence differs from actual rest material or surface');}
   if(piece.binding.route===COMPONENT_TRANSPORT_ROUTE){
    const radius=w.configuration?.reconstructionRadius,rest=Array.from({length:n},(_,i)=>w.state.state.slice(i*16,i*16+3)),volumes=Array.from({length:n},(_,i)=>w.state.state[i*16+3]);
    if(!(Number.isFinite(radius)&&radius>0)||piece.binding.radius!==radius)throw new Error('Transport construction law: effective radius differs');
    const derived=bindComponentTransport(rest,piece.binding.entries.map(e=>e.point),{components,component:piece.component,volumes,radius}),frameWeights=new Map(derived.frame.ids.map((id,i)=>[id,derived.frame.weights[i]]));
    if(piece.binding.frame.ids.some((id,i)=>Math.abs(piece.binding.frame.weights[i]-frameWeights.get(id))>1e-10))throw new Error('Transport construction law: frame weights differ');
    // CPU source positions and resident rest coordinates differ by f32 rounding; observed weight error is ~1.1e-7.
    for(let i=0;i<derived.entries.length;i++){const actual=piece.binding.entries[i],expected=derived.entries[i],weights=new Map(expected.ids.map((id,j)=>[id,expected.weights[j]])),supplied=new Map(actual.ids.map((id,j)=>[id,actual.weights[j]]));
     if(!(Number.isFinite(actual.effectiveRadius)&&actual.effectiveRadius>0)||Math.abs(actual.effectiveRadius-expected.effectiveRadius)>1e-6||actual.ids.some((id,j)=>Math.abs(actual.weights[j]-(weights.get(id)??0))>1e-6)||expected.ids.some((id,j)=>Math.abs(expected.weights[j]-(supplied.get(id)??0))>1e-6))throw new Error('Transport construction law: surface weights or support radius differ');
    }
   }
   const values=(piece.binding.route===COMPONENT_TRANSPORT_ROUTE?applyComponentTransport:applyComponentAffineField)(piece.binding,current,{components}),expected=piece.geometry.indices.flatMap(i=>values[i]);
   if(!Array.isArray(piece.renderedPositions)||expected.length!==piece.renderedPositions.length||!piece.renderedPositions.every((v,i)=>Number.isFinite(v)&&Math.abs(v-expected[i])<=2e-6))throw new Error('Rendered skin differs from current material field');
  }
  for(const event of w.events??[])if((interior?!w.interior.materialRuns.includes(event.material.runId):event.material.runId!==w.runId)||event.kind!==(interior?'component-tensile-interior-cut-v0':'component-tensile-through-cut-v0')||!(event.tension>=event.threshold)||!event.targetNodes?.length)throw new Error('Fracture event lacks measured criterion or component provenance');
 }catch(e){errors.push(e.message);}
 return errors;
}
