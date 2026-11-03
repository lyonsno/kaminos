import {validateRecipe} from './model.mjs';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const canonical=sha=>`/api/read?root=generated-meshes&path=${sha}.glb`;
export const familyAssetSource=id=>`/api/read?root=generated-meshes&path=${id}.stock-family.json`;
export function validateFamilyAsset(value){
 if(value?.schema!=='kaminos.stock-family-asset.v1'||typeof value.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id)||!/^[a-f0-9]{64}$/.test(value.revision)||typeof value.name!=='string'||!value.name.trim())throw Error('Invalid saved stock family');
 return {...structuredClone(value),recipe:validateRecipe(value.recipe)};
}
async function json(request,url,options){const response=await request(url,options),value=await response.json();if(!response.ok)throw Error(value.error||`Stock library HTTP ${response.status}`);return value;}
export async function readFamilyAsset(source,{request=fetch}={}){return validateFamilyAsset(await json(request,source,{cache:'no-store'}));}
export async function saveFamilyAsset({recipe,name,id,revision},{request=fetch}={}){
 const retained=validateRecipe(recipe),sources=[retained.source,...(retained.sources??[])],stored=new Map();
 for(const source of sources){
  const key=source.sha256;if(stored.has(key))continue;
  const response=await request(source.url,{cache:'no-store'});if(!response.ok)throw Error('Source retention HTTP '+response.status);
  const bytes=await response.arrayBuffer();if(await digest(bytes)!==key)throw Error('Source changed before family save');
  if(source.url!==canonical(key)){
   const receipt=await json(request,'/api/ingest-mesh',{method:'POST',headers:{'Content-Type':'model/gltf-binary'},body:bytes});
   if(receipt.schema!=='kaminos.generated-mesh.v0'||receipt.sha256!==key||receipt.bytes!==bytes.byteLength||receipt.source!==canonical(key))throw Error('Source retention identity mismatch');
  }
  stored.set(key,canonical(key));
 }
 const local=source=>({...source,...(source.url!==stored.get(source.sha256)?{originUrl:source.originUrl??source.url}:{}),url:stored.get(source.sha256)});
 retained.source=local(retained.source);if(retained.sources)retained.sources=retained.sources.map(local);
 const value=validateFamilyAsset(await json(request,'/api/stock-families',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,revision,name,recipe:retained})}));
 if((id&&value.id!==id)||value.name!==name.trim()||JSON.stringify(value.recipe)!==JSON.stringify(retained))throw Error('Family storage receipt mismatch');
 return value;
}
export async function openStockFamilyAsset(entry,win){
 if(entry?.kind!=='stock-family'||entry.visibility?.status==='withheld')throw Error('Choose an available stock family');
 if(!win.kaminosWorkbenchExperiments?.open)throw Error('Stock family workbench is still initializing');
 const asset=await readFamilyAsset(entry.source);
 await win.kaminosWorkbenchExperiments.open('stock-family',{assetSource:entry.source});
 win.kaminosAssets.close();win.kaminosWorkspace.setMode('workbench');return asset.id;
}
