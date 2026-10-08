import {inspectShardWitness} from './structural-material-shard-evidence.mjs';
const determinant=F=>F[0][0]*(F[1][1]*F[2][2]-F[1][2]*F[2][1])-F[0][1]*(F[1][0]*F[2][2]-F[1][2]*F[2][0])+F[0][2]*(F[1][0]*F[2][1]-F[1][1]*F[2][0]);
export function summarizeShardReplay(w){
 const errors=inspectShardWitness(w);if(errors.length)throw new Error(`Incomplete shard replay evidence: ${errors.join('; ')}`);
 const current=Array.from({length:w.state.model.points},(_,i)=>w.state.state.slice(i*16+4,i*16+7)),rest=Array.from({length:current.length},(_,i)=>w.state.state.slice(i*16,i*16+3));
 const materialTravel=Math.max(...current.map((p,i)=>Math.hypot(...p.map((x,k)=>x-rest[i][k]))));let surfaceTravel=0,worst=null;
 for(const piece of w.pieces)for(let i=0;i<piece.geometry.indices.length;i++){const vertex=piece.geometry.indices[i],entry=piece.binding.entries[vertex],travel=Math.hypot(...piece.renderedPositions.slice(i*3,i*3+3).map((x,k)=>x-entry.point[k]));if(travel>surfaceTravel){surfaceTravel=travel;worst={piece:piece.id,vertex,weightL1:entry.weightL1,rankMeasure:entry.rankMeasure,ids:entry.ids,weights:entry.weights,rest:entry.point,current:piece.renderedPositions.slice(i*3,i*3+3)};}}
 return{steps:w.state.steps,events:w.events.length,pieces:w.pieces.length,materialTravel,surfaceTravel,amplification:materialTravel?surfaceTravel/materialTravel:0,minActiveJ:Math.min(...w.state.stresses.filter(s=>s.active).map(s=>determinant(s.F))),worst};
}
