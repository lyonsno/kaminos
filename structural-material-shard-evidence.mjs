import {materialComponents} from './structural-material-solid-surface.mjs';
import {applyComponentAffineField} from './structural-material-component-affine.mjs';
export function inspectShardWitness(w){
 const errors=[];if(w?.route!=='kaminos.picked-stone.stress-shards.webgpu.v0'||w.phase!=='interactive'||w.failure)return['Live picked-stone route failed or substituted'];
 if(w.identity?.backend!=='webgpu'||w.identity.adapterFallback!==false)errors.push('Native GPU material authority absent');
 if(w.state?.route!=='kaminos.deformable-material.colored-vbd.webgpu.v0'||w.state.kind!=='graph'||!w.runId||w.runId!==w.state.runId)errors.push('Resident material identity differs');
 if(w.sourceSha256!=='33eb6f774a3b2bd52751c052029b529359957a71ec3eeee2e93c51bee46d8011'||!w.preparationSha256)errors.push('Admitted imported source absent');
 if(!Array.isArray(w.state?.state)||!w.state.state.length||w.state.state.length%16||!w.state.state.every(Number.isFinite)||!Array.isArray(w.state?.stresses)||!w.state.stresses.length||w.state.stresses.some(s=>s.invalid||!Array.isArray(s.stress)||!Array.isArray(s.F)||![...s.stress.flat(),...s.F.flat(),s.volume,s.energy].every(Number.isFinite)))return[...errors,'Incomplete or invalid material output'];
 if(!Array.isArray(w.pieces)||!w.pieces.length||new Set(w.pieces.map(p=>p.id)).size!==w.pieces.length||!Array.isArray(w.events)||w.events.length!==w.state.damageEpoch)errors.push('Fragment inventory or damage history incomplete');
 try{
  const n=w.state.state.length/16,current=Array.from({length:n},(_,i)=>w.state.state.slice(i*16+4,i*16+7)),components=materialComponents(n,w.state.bonds);
  const owned=(w.pieces??[]).flatMap(p=>p.nodes??[]);
  if(owned.length!==n||new Set(owned).size!==n||owned.some(i=>!Number.isInteger(i)||i<0||i>=n)||new Set((w.pieces??[]).map(p=>p.component)).size!==new Set(components).size)throw new Error('Visible fragments do not cover the complete material inventory');
  for(const piece of w.pieces??[]){
   if(!piece.nodes?.length||piece.nodes.some(i=>components[i]!==piece.component)||!(piece.volume>0)||piece.binding.component!==piece.component)throw new Error('Piece has foreign or absent material ownership');
   const values=applyComponentAffineField(piece.binding,current,{components}),expected=piece.geometry.indices.flatMap(i=>values[i]);
   if(!Array.isArray(piece.renderedPositions)||expected.length!==piece.renderedPositions.length||!piece.renderedPositions.every((v,i)=>Number.isFinite(v)&&Math.abs(v-expected[i])<=2e-6))throw new Error('Rendered skin differs from current material field');
  }
  for(const event of w.events??[])if(event.material.runId!==w.runId||event.kind!=='component-tensile-through-cut-v0'||!(event.tension>=event.threshold)||!event.targetNodes?.length)throw new Error('Fracture event lacks measured criterion or component provenance');
 }catch(e){errors.push(e.message);}
 return errors;
}
