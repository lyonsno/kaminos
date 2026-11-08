// Allocation targets admit new detail; they never discard occupied history.
export const ashActivityKeys=['showAirborne','showDeposited','moveAirborne','settleDeposited'];
export function ashActivity(settings={}){return Object.fromEntries(ashActivityKeys.map(key=>{if(settings[key]!==undefined&&typeof settings[key]!=='boolean')throw Error('Invalid ash activity switch: '+key);return [key,settings[key]??true];}));}
export function checkedHierarchyPolicy(refinement,depth,capacity){
 const maxDepth=refinement.maxDepth??depth,planningRounds=refinement.planningRounds??1;
 if(!Number.isSafeInteger(maxDepth)||maxDepth<0||maxDepth>depth)throw Error('Invalid ash maximum depth for the receiving grid');
 if(!Number.isSafeInteger(planningRounds)||planningRounds<1)throw Error('Invalid ash planning rounds');
 if(refinement.depthBudgetMiB!==undefined&&(!Array.isArray(refinement.depthBudgetMiB)||refinement.depthBudgetMiB.some(n=>n!==null&&(!Number.isFinite(n)||n<0))))throw Error('Invalid ash depth budget');
 if(refinement.transportCellSize!==undefined&&(!(refinement.transportCellSize>0)||!Number.isFinite(refinement.transportCellSize)))throw Error('Invalid ash transport cell width');
 if(refinement.targetPixels!==undefined&&(!(refinement.targetPixels>0)||!Number.isFinite(refinement.targetPixels)))throw Error('Invalid ash projected detail target');
 const bytesPerBrick=512*28+32*6;
 const quotas=Array.from({length:depth+1},(_,d)=>refinement.depthBudgetMiB?.[d]==null?capacity:Math.min(capacity,Math.floor(refinement.depthBudgetMiB[d]*1048576/bytesPerBrick)));
 return {maxDepth,planningRounds,quotas,targetPixels:refinement.targetPixels??null};
}
export const hierarchyLivePolicyKeys=['maxDepth','planningRounds','depthBudgetMiB','targetPixels'];
export function sameHierarchyStorage(a,b){const strip=s=>Object.fromEntries(Object.entries(s??{}).filter(([key])=>!hierarchyLivePolicyKeys.includes(key)));return JSON.stringify(strip(a))===JSON.stringify(strip(b));}

export function sameAshLayout(a,b){const clean=p=>{const {hierarchyArena,...rest}=p;return {...rest,refinement:rest.refinement?Object.fromEntries(Object.entries({...rest.refinement,...(rest.refinement.mode==='hierarchy'?{transportCellSize:rest.refinement.transportCellSize??rest.cellSize}:{})}).filter(([k])=>!hierarchyLivePolicyKeys.includes(k))):rest.refinement};};return JSON.stringify(clean(a))===JSON.stringify(clean(b));}
