import * as T from '../../lib/three.core.js';

// Reflect geometry across an assembly-local plane parallel to the linkage XY
// plane. This reflection commutes with every authored planar body motion, so
// copies remain in their original body slots and share that body's actuation.
export function mirrorBodyGeometry(packet,{planeZ,selections,positions}){
 if(!Number.isFinite(planeZ))throw Error('Finite mirror plane required');
 if(packet?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(packet.bodies)||!Array.isArray(selections)||!selections.length)throw Error('Choose body geometry to mirror');
 const result=structuredClone(packet),byId=new Map(result.bodies.map(b=>[b.id,b])),seen=new Set();
 for(const selection of selections){
  const item=byId.get(selection.id);if(!item||seen.has(selection.id))throw Error('Unknown or repeated body selection');seen.add(selection.id);
  const z=positions?.[selection.id];if(!Number.isFinite(z))throw Error('Body position required for mirror plane');
  const object=new T.ObjectLoader().parse(item.object);object.updateMatrixWorld(true);
  const chosen=[];object.traverse(o=>{if(o.isMesh&&(!selection.names||selection.names.includes(o.name)))chosen.push(o);});
  if(!chosen.length||selection.names?.some(name=>!chosen.some(o=>o.name===name)))throw Error('Empty or missing shape selection');
  const reflection=new T.Matrix4().makeScale(1,1,-1);reflection.setPosition(0,0,2*(planeZ-z));
  const group=new T.Group();group.name='Mirrored shapes';
  for(const source of chosen){
   const geometry=source.geometry.clone();geometry.applyMatrix4(reflection.clone().multiply(source.matrixWorld));
   // Bake the reflection, including winding, so consumers need no negative-scale support.
   const index=geometry.index;if(index){for(let i=0;i<index.count;i+=3){const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b);}index.needsUpdate=true;}
   else {const indices=[];for(let i=0;i<geometry.attributes.position.count;i+=3)indices.push(i,i+2,i+1);geometry.setIndex(indices);}
   const tangent=geometry.attributes.tangent;if(tangent)for(let i=0;i<tangent.count;i++)tangent.setW(i,-tangent.getW(i));
   const mesh=new T.Mesh(geometry,source.material);mesh.name='Mirror: '+(source.name||source.uuid);mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;mesh.userData={...source.userData,mirrorSource:source.name||source.uuid};group.add(mesh);
  }
  for(const mesh of group.children)if(mesh.userData.copyPart)mesh.userData.copyPart=group.uuid+':'+mesh.userData.copyPart;
  object.add(group);object.updateMatrixWorld(true);item.object=object.toJSON();
  const gs=new Set(),ms=new Set();object.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)ms.add(m);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();
 }
 return result;
}
