import {authoredMlsSetup,authoredMlsInlets} from './authored-mls-water.mjs';
export function authoredDropSetup(records,options={}){
 if(!records.some(r=>r.localLiquidEmitter?.mode==='finite_drop'))throw Error('No finite water source in the scene');
 return authoredMlsSetup(records,options);
}
export async function createAuthoredWaterHost(options){
 const initial=authoredMlsSetup(options.emitters??[],options.setup??{});
 const {createAuthoredMlsHost}=await import('./authored-mls-host.mjs');
 return createAuthoredMlsHost({...options,initial,makePacket:(records,epoch,generation)=>authoredMlsInlets(records,epoch,generation,initial.solver.cellSize)});
}
