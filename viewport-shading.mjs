// Viewport shading is presentation, not authored material state. Wireframe
// installs the wire material only for the duration of one viewport render and
// restores the authored materials before anything else (save, export,
// duplication, material edits, shadow passes) can observe them. Editor-only
// helpers and non-mesh primitives (lines, points, splats) keep their materials.
//
// GPU-driven geometry: a source material's positionNode is carried onto its own
// wire material, so a mesh deformed on the GPU draws its deformed shape. A wire
// index is built on the CPU from the geometry's index, so geometry whose
// topology is published on the GPU (an indirect draw) keeps its own material
// unless its owner says how it draws in wire, through
// userData.kaminosViewportShading.wireframe: a material, or 'keep'.
// Wire materials come from createWireMaterial, not clone(): a node material's
// clone drops subclass values such as wireframe and color.
export function createViewportShading({createWireMaterial}) {
 const wireMaterial=createWireMaterial(),deformedWire=new WeakMap();
 const wireFor=source=>{
  if(!source?.positionNode?.isNode)return wireMaterial;
  let wire=deformedWire.get(source);
  if(!wire){wire=createWireMaterial();wire.positionNode=source.positionNode;deformedWire.set(source,wire);}
  return wire;
 };
 return {
  renderWith(roots,mode,render) {
   if(mode!=='wireframe'){render();return {mode:'solid',meshes:0,perRoot:roots.map(()=>0),kept:0};}
   const swapped=[],perRoot=roots.map(()=>0);
   let kept=0;
   try {
    roots.forEach((root,index)=>root?.traverse?.(object=>{
     if(!object.isMesh||object.userData?.kaminosEditorOnly||!object.material)return;
     const owner=object.userData?.kaminosViewportShading?.wireframe,source=object.material;
     if(owner==='keep'||(!owner&&object.geometry?.indirect)){kept++;return;}
     const wire=Array.isArray(source)?source.map(material=>owner||wireFor(material)):owner||wireFor(source);
     swapped.push([object,source,wire]);object.material=wire;perRoot[index]++;
    }));
    render();
   } finally {
    // Reverse order also unwinds a mesh reached through two registered roots.
    for(let i=swapped.length-1;i>=0;i--){const [object,source,wire]=swapped[i];if(object.material===wire)object.material=source;}
   }
   return {mode:'wireframe',meshes:swapped.length,perRoot,kept};
  },
 };
}
