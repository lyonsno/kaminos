import {defaultBurnerRecipe} from './burner-recipe.mjs';
// The original geometry studies, browsed and inserted through the ordinary GLB path.
const designs=[
 ['crown-ring','Crown · Ring burner','Twelve upward ports around an open centre.',762580,'5c3025c41147a55cb1ec9cc722598d8d901279e87a1fa5ca4251de834f211e6e'],
 ['seam-rail','Seam · Slot burner','A long ribbon outlet with parallel lips.',224580,'a4b55a1082d64566860975d7080cb2d895fef8b33af9482ba0f118a819e21f7f'],
 ['lance-nozzle','Lance · Angled nozzle','An open refractory mouth on a tilted cradle.',213972,'90e26d01f891005cf62813a956050b85da1ca8be338e297d73add55d3fd6c4b0'],
];
export function burnerAssets(){
 return designs.map(([id,label,description,size,sha256])=>{
  const name=id+'.glb',source='./assets/burners/'+name;
  return {id,root:'burners',path:name,name,label,description,size,kind:'mesh',source,
   ...(id==='lance-nozzle'?{}:{burner:defaultBurnerRecipe(id)}),
   assetOrigin:{source,collection:'burners',designId:id,sha256,designRevision:'c9915c0a1f8fb4ab90e35605674dac9298cd855f'}};
 });
}
