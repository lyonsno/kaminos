// Viewport shading is presentation, not authored material state. Wireframe
// installs the wire material only for the duration of one viewport render and
// restores the authored materials before anything else (save, export,
// duplication, material edits, shadow passes) can observe them. Editor-only
// helpers and non-mesh primitives (lines, points, splats) keep their materials.
export function createViewportShading({wireMaterial}) {
 return {
  renderWith(roots,mode,render) {
   if(mode!=='wireframe'){render();return {mode:'solid',meshes:0,perRoot:roots.map(()=>0)};}
   const swapped=[],perRoot=roots.map(()=>0);
   try {
    roots.forEach((root,index)=>root?.traverse?.(object=>{
     if(!object.isMesh||object.userData?.kaminosEditorOnly||!object.material)return;
     const source=object.material,wire=Array.isArray(source)?source.map(()=>wireMaterial):wireMaterial;
     swapped.push([object,source,wire]);object.material=wire;perRoot[index]++;
    }));
    render();
   } finally {
    // Reverse order also unwinds a mesh reached through two registered roots.
    for(let i=swapped.length-1;i>=0;i--){const [object,source,wire]=swapped[i];if(object.material===wire)object.material=source;}
   }
   return {mode:'wireframe',meshes:swapped.length,perRoot};
  },
 };
}
