// Viewport shading is a view preference, not authored material state. Wireframe
// swaps each scene mesh's material for a cached wire material derived from the
// source material and restores the source on return to solid. Editor-only
// helpers and non-mesh primitives (lines, points, splats) keep their materials.
export function createViewportShading({makeWireMaterial}) {
 const swapped=new Map(); // mesh -> {source, wire}
 const wires=new Map(); // source material -> wire material
 const wireFor=source=>{let wire=wires.get(source);if(!wire){wire=makeWireMaterial(source);wires.set(source,wire);}return wire;};
 const wireForMaterial=material=>Array.isArray(material)?material.map(wireFor):wireFor(material);
 const isOurs=(mesh,entry)=>mesh.material===entry.wire;
 function restoreAll() {
  for(const [mesh,entry] of swapped)if(isOurs(mesh,entry))mesh.material=entry.source;
  swapped.clear();
 }
 return {
  apply(roots,mode) {
   if(mode!=='wireframe'){restoreAll();return {mode:'solid',swapped:0};}
   for(const root of roots)root?.traverse?.(object=>{
    if(!object.isMesh||object.userData?.kaminosEditorOnly||!object.material)return;
    const entry=swapped.get(object);
    if(entry&&isOurs(object,entry))return;
    // A material assigned while in wireframe becomes the new restore target.
    const source=object.material,wire=wireForMaterial(source);
    swapped.set(object,{source,wire});object.material=wire;
   });
   return {mode:'wireframe',swapped:swapped.size};
  },
  dispose() {restoreAll();for(const wire of wires.values())wire.dispose?.();wires.clear();},
 };
}
