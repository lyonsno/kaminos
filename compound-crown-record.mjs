import {crownRecipe,evaluateCrown} from './experiments/compound-crown/mechanism.mjs';
import {createCrownView} from './experiments/compound-crown/view.mjs';
export const CROWN_SOURCE='kaminos:compound-crown';
export function checkedCrownRecipe(recipe){if(!recipe||['opening','swirl','vaneCount','irisCount','rate','playing'].some(key=>!Object.hasOwn(recipe,key)))throw Error('Saved Compound Crown requires its complete mechanism recipe');return crownRecipe(recipe);}
export const crownOutputs=recipe=>({clearRadius:evaluateCrown(recipe).clearRadius});
export function createCrownObject(record){
 const view=createCrownView(checkedCrownRecipe(record.compoundCrown));
 view.root.userData.kaminosCompoundCrown=structuredClone(record.compoundCrown);
 return view.root;
}
export function updateCrownObject(root,recipe){
 recipe=crownRecipe(recipe);const next=createCrownObject({compoundCrown:recipe});
 const geometries=new Set(),materials=new Set();root.traverse(n=>{if(n.geometry)geometries.add(n.geometry);for(const m of [n.material].flat())if(m)materials.add(m);});
 root.clear();for(const child of [...next.children])root.add(child);
 root.userData.kaminosCompoundCrown=structuredClone(recipe);
 for(const g of geometries)g.dispose();for(const m of materials)m.dispose();return recipe;
}
export const crownRecordDomain={type:'pbr',source:CROWN_SOURCE,
 check:r=>({...r,compoundCrown:checkedCrownRecipe(r.compoundCrown)}),fields:r=>({compoundCrown:checkedCrownRecipe(r.compoundCrown)}),
 recognize:object=>Boolean(object?.userData?.kaminosCompoundCrown),
 capture:entry=>({compoundCrown:checkedCrownRecipe(entry.compoundCrown??entry.object.userData.kaminosCompoundCrown)}),
 reloadable:r=>{checkedCrownRecipe(r.compoundCrown);return true;},load:(r,loaders,options)=>loaders.constructed(createCrownObject(r),r,options)};
