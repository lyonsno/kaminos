import {crownRecipe,evaluateCrown} from './experiments/compound-crown/mechanism.mjs';
import {createCrownView} from './experiments/compound-crown/view.mjs';
export const CROWN_SOURCE='kaminos:compound-crown';
const crownViews=new WeakMap();
export function checkedCrownRecipe(recipe){if(!recipe||['opening','swirl','vaneCount','irisCount','rate','playing'].some(key=>!Object.hasOwn(recipe,key)))throw Error('Saved Compound Crown requires its complete mechanism recipe');return crownRecipe(recipe);}
export const crownOutputs=recipe=>({clearRadius:evaluateCrown(recipe).clearRadius});
export function createCrownObject(record){
 const view=createCrownView(checkedCrownRecipe(record.compoundCrown));
 view.root.userData.kaminosCompoundCrown=structuredClone(record.compoundCrown);
 crownViews.set(view.root,view);
 return view.root;
}
export function updateCrownObject(root,recipe){
 recipe=crownRecipe(recipe);const view=crownViews.get(root);
 if(!view)throw Error('Compound Crown edits require its constructed mechanism view');
 view.update(recipe);
 root.userData.kaminosCompoundCrown=structuredClone(recipe);
 return recipe;
}
export const crownRecordDomain={type:'pbr',source:CROWN_SOURCE,
 check:r=>({...r,compoundCrown:checkedCrownRecipe(r.compoundCrown)}),fields:r=>({compoundCrown:checkedCrownRecipe(r.compoundCrown)}),
 recognize:object=>Boolean(object?.userData?.kaminosCompoundCrown),
 capture:entry=>({compoundCrown:checkedCrownRecipe(entry.compoundCrown??entry.object.userData.kaminosCompoundCrown)}),
 reloadable:r=>{checkedCrownRecipe(r.compoundCrown);return true;},load:(r,loaders,options)=>loaders.constructed(createCrownObject(r),r,options)};
export function writeCrownRecipe(entry,recipe,repetition){
 recipe=checkedCrownRecipe(recipe);
 entry.compoundCrown=updateCrownObject(entry.object,recipe);entry.object.userData.kaminosSceneObject.compoundCrown=structuredClone(recipe);repetition?.refresh(entry.object);return entry.compoundCrown;
}
