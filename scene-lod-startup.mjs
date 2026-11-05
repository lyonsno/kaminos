// This cache warms downloads. Current camera/viewport policy still selects beauty.
const schema='kaminos.scene-lod-preparation.v1';
export function lodPreparationContext({camera,viewport,settings,objects}){
  return JSON.stringify({camera,viewport,settings,objects:objects.filter(row=>row.type==='glb').map(({id,source,transform,giProxy})=>({id,source,transform,giProxy})).sort((a,b)=>a.id.localeCompare(b.id))});
}
export function captureLodPreparation(context,allocation){
  if(!allocation?.enabled)return null;
  return {schema,context,levels:allocation.objects.map(({id,targetTier})=>({id,sha:targetTier}))};
}
export function cachedLodPreparation(hint,context){
  if(hint?.schema!==schema||hint.context!==context||!Array.isArray(hint.levels))return new Map();
  return new Map(hint.levels.filter(row=>typeof row?.id==='string'&&typeof row.sha==='string'&&/^[a-f0-9]{64}$/.test(row.sha)).map(row=>[row.id,row.sha]));
}
