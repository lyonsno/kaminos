// Hook only this renderer's converted physical materials. The source pass has
// no reflection context: scene radiance cannot recursively sample itself.
export function installSceneReflectionLighting(renderer,owner){
 const library=renderer.library,previous=library.fromMaterial,wrapped=new Map();
 function fromMaterial(material){
  const node=previous.call(this,material);
  if(!node?.isMeshStandardNodeMaterial||wrapped.has(node))return node;
  const original=node.setupLightingModel;
  const replacement=function(builder){
   const model=original.call(this,builder);
   if(builder.context.sceneReflectionLighting!==owner.lightingContext||this.transparent||this.transmission>0||!model?.indirectSpecular)return model;
   const indirect=model.indirectSpecular;
   model.indirectSpecular=function(b){
    const reflection=owner.forSurface(b);
    // RGB is coverage-premultiplied incident radiance. The existing material
    // evaluates Fresnel/GGX/metalness once, with environment filling misses.
    b.context.radiance.assign(reflection.rgb.add(b.context.radiance.mul(reflection.a.oneMinus())));
    return indirect.call(this,b);
   };
   return model;
  };
  node.setupLightingModel=replacement;wrapped.set(node,{original,replacement});
  return node;
 }
 library.fromMaterial=fromMaterial;
 return()=>{
  if(library.fromMaterial===fromMaterial)library.fromMaterial=previous;
  for(const [node,{original,replacement}]of wrapped)if(node.setupLightingModel===replacement)node.setupLightingModel=original;
  wrapped.clear();
 };
}
