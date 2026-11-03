// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {furnaceAssembly} from '../experiments/link-workshop/furnace.mjs';
import {createBodyView} from '../experiments/link-workshop/bodies.mjs';
const {recipe,geometry}=furnaceAssembly(),root=new T.Group(),view=createBodyView(root);
view.update(recipe,0);view.importBodies(geometry);view.update(recipe,0);
const door=root.getObjectByName('Door shell');
assert.deepEqual(door.position.toArray(),[1.39,.16,-1.52],'Serialized furniture retains its body-local placement');
assert.equal(view.manifest().replacements,8);
const body=()=>root.getObjectByName('Door and rigid operating lever');
const original=body().matrixWorld.clone(),fixed=root.getObjectByName('Stationary furnace housing').matrixWorld.clone();
const ray=new T.Raycaster(new T.Vector3(5,2,-1.3),new T.Vector3(-1,0,0));
assert(ray.intersectObjects(root.children,true)[0].object.name.startsWith('Door'),'Closed door covers the opening');
view.update(recipe,1);
assert(!body().matrixWorld.equals(original));assert(root.getObjectByName('Stationary furnace housing').matrixWorld.equals(fixed));
assert.equal(ray.intersectObjects(root.children,true)[0].object.name,'Refractory back','Opened mouth exposes a hollow chamber');
assert.deepEqual(view.manifest().warnings,[]);
const saved=view.exportBodies();view.dispose();
const restored=createBodyView(root);restored.update(recipe,0);restored.importBodies(saved);restored.update(recipe,1);assert.equal(root.getObjectByName('Door shell').position.x,1.39);restored.dispose();
console.log('furnace geometry, opening and body return passed');
const paired=furnaceAssembly({mirrored:true}),pairRoot=new T.Group(),pairView=createBodyView(pairRoot);pairView.update(paired.recipe,0);pairView.importBodies(paired.geometry);
assert(pairRoot.getObjectByName('Mirror: Side operating lever'),'opposite-side lever exists');
for(const t of [0,.25,.5,.75,1]){pairView.update(paired.recipe,t);const a=pairRoot.getObjectByName('Side operating lever'),b=pairRoot.getObjectByName('Mirror: Side operating lever');a.geometry.computeBoundingBox();b.geometry.computeBoundingBox();const ca=a.geometry.boundingBox.getCenter(new T.Vector3()).applyMatrix4(a.matrixWorld),cb=b.geometry.boundingBox.getCenter(new T.Vector3()).applyMatrix4(b.matrixWorld);assert(Math.abs(ca.x-cb.x)<1e-6&&Math.abs(ca.y-cb.y)<1e-6);assert(Math.abs(ca.z+cb.z+2.6)<1e-6);}
pairView.dispose();
