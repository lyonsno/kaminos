import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8');
const source=text.slice(text.indexOf('function makeMeshes('),text.indexOf('async function loadVerified'));
assert.ok(source.startsWith('function makeMeshes('));
const fixture=reject=>{
 const old={mesh:{geometry:{dispose(){this.disposed=true;}}}},published=[],removed=[];
 const context={pieces:[old],body:{positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]]},components:[0,0,0,0],volumes:[1,1,1,1],configuration:{reconstructionRadius:1},skinMaterial:{},capMaterial:{},
  observed:{state:[],bonds:[],steps:4},positions:()=>[[2,0,0],[3,0,0],[2,1,0],[2,0,1]],inside:()=>true,
  surface:{witness:()=>({pieces:[{id:1,halfspaces:[],geometry:{numProp:3,properties:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]}}]})},
  affineComparison:true,COMPONENT_TRANSPORT_ROUTE:'transport-fixture',bindComponentAffineField(){if(reject)throw new Error('binding refused');return{route:'affine-fixture'};},applyComponentAffineField:()=>[[2,0,0],[3,0,0],[2,1,0]],
  createShardGeometry:()=>({attributes:{position:{values:[0,0,0,1,0,0,0,1,0],setXYZ(i,...p){this.values.splice(i*3,3,...p);}}},computeVertexNormals(){},computeBoundingSphere(){},computeBoundingBox(){},dispose(){this.disposed=true;}}),
  THREE:{Mesh:class{constructor(geometry){this.geometry=geometry;this.userData={};}}},
  scene:{add(mesh){published.push([...mesh.geometry.attributes.position.values]);},remove(mesh){removed.push(mesh);}},$:()=>({textContent:''})};
 context.interiorSplit=false;context.interiorState=null;return{context,old,published,removed};
};
const success=fixture(false);vm.runInNewContext(source+';makeMeshes()',success.context);
assert.deepEqual(success.published,[[2,0,0,3,0,0,2,1,0]],'A shard must be deformed before its first visible publication, with no rest-pose flash');
assert.equal(success.removed.length,1);assert.equal(success.old.mesh.geometry.disposed,true);
const refused=fixture(true);assert.throws(()=>vm.runInNewContext(source+';makeMeshes()',refused.context),/binding refused/);
assert.equal(refused.removed.length,0,'Failed staging must retain the last visible material');assert.equal(refused.context.pieces[0],refused.old);assert.equal(refused.old.mesh.geometry.disposed,undefined);
console.log('Actual mesh publication stages deformed geometry and retains prior display on admission failure; synthetic scene tests publication, not GPU mechanics');
