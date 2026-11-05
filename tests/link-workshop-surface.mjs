// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {furnaceAssembly} from '../experiments/link-workshop/furnace.mjs';
import {divideSurface} from '../experiments/link-workshop/surface.mjs';
import {frames} from '../experiments/link-workshop/model.mjs';
const source=furnaceAssembly({mirrored:false});
const next=divideSurface({...source,joint:1,cuts:[1.12,1.95],geometry:source.geometry});
assert.equal(next.recipe.nodes.length,5,'Two seams create three independently poseable panels');
assert.equal(next.recipe.pistons.length,1,'Cutting preserves the original actuator, adds none');
assert.equal(next.recipe.pistons[0].b,1);
assert.deepEqual(next.recipe.pistons[0].bOffset,[.85,0],'Piston eye stays at the original physical location');
assert.deepEqual(next.recipe.nodes[1].angles,source.recipe.nodes[1].angles,'No invented fold target');
assert.deepEqual(next.recipe.nodes[2].angles,[0,0]);
assert.deepEqual(next.recipe.nodes[3].angles,[0,0]);
assert.equal(next.geometry.bodies.filter(b=>b.id.startsWith('link:')).length,3);
for(const pose of [0,1]){
 const a=frames(source.recipe,pose),b=frames(next.recipe,pose),p=next.recipe.pistons[0];
 const eye=[b[0].point[0]+Math.cos(b[1].angle)*p.bOffset[0],b[0].point[1]+Math.sin(b[1].angle)*p.bOffset[0]];
 assert.ok(Math.hypot(eye[0]-a[1].point[0],eye[1]-a[1].point[1])<1e-9);
}
assert.throws(()=>divideSurface({...source,geometry:source.geometry,joint:0,cuts:[1,2]}),/movable body/);
assert.throws(()=>divideSurface({...source,geometry:source.geometry,joint:1,cuts:[1.5,1]}),/ordered/);
console.log('Surface seams preserve actuator positions and authored poses');
// Same cutter on a roof-oriented body, a mount on the later panel, and textured detail.
{
 const source=furnaceAssembly({mirrored:false});source.recipe.nodes[1].angles=[0,.4];source.recipe.mounts=[{id:'later',owner:{joint:1},position:[1.4,0,.1],rotation:[.2,.1,0]}];
 const next=divideSurface({...source,joint:1,cuts:[1.12,1.95]});
 assert.equal(next.recipe.mounts[0].owner.joint,3);assert.deepEqual(next.recipe.mounts[0].rotation,[.2,.1,0]);
 const {mountMatrix}=await import('../experiments/link-workshop/mounts.mjs');
 for(const t of [0,.5,1]){const a=mountMatrix(new T.Group(),source.recipe,'later',t,[]),b=mountMatrix(new T.Group(),next.recipe,'later',t,[]);assert.ok(a.elements.every((v,i)=>Math.abs(v-b.elements[i])<1e-7),'Mount frame survives orientation and ownership change');}
 const {checkedBodyGeometry}=await import('../experiments/link-workshop/bodies.mjs');assert.doesNotThrow(()=>checkedBodyGeometry(next.recipe,next.geometry),'Saved panels reconstruct on the normal geometry route');
 const links=next.geometry.bodies.filter(b=>b.id.startsWith('link:'));
 for(const [k,item]of links.entries()){const object=new T.ObjectLoader().parse(item.object),names=[];object.traverse(o=>{if(o.isMesh){names.push(o.name);assert.ok(o.geometry.getAttribute('uv'),'UV coordinates survive clipping');}});assert.ok(names.includes('Door shell'));if(k===0)assert.ok(names.includes('Side operating lever'));else assert.ok(!names.includes('Side operating lever'),'Lever is retained once, never cloned onto later panels');}
 const before=JSON.stringify(source);assert.throws(()=>divideSurface({...source,joint:1,cuts:[.7,1.95]}),/crosses a seam/);assert.equal(JSON.stringify(source),before,'Rejected bracket cut leaves all source state untouched');
}
{
 const {addSurfaceActuators,actuatorReport}=await import('../experiments/link-workshop/surface.mjs');const {checkedBodyGeometry}=await import('../experiments/link-workshop/bodies.mjs');
 const a=addSurfaceActuators(next.recipe,next.geometry,2);assert.equal(a.recipe.pistons.length,3);const b=addSurfaceActuators(a.recipe,a.geometry,2);assert.equal(b.recipe.pistons.length,3,'Explicit cylinder construction is repeatable without duplicates');assert.doesNotThrow(()=>checkedBodyGeometry(a.recipe,a.geometry));
 const dead={schema:'kaminos.links.v1',nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[0,0]},{parent:1,length:1,angles:[-.3,.3]}],pistons:[{a:1,b:2,aOffset:[.2,0],bOffset:[.5,0],hinge:true}],period:3};assert.equal(actuatorReport(dead)[0].deadCenter,true,'Short excursions can cross dead centre');
}
{
 const {createSceneRecordOperations}=await import('../scene-record-operations.mjs');const {mechanismObject}=await import('../experiments/link-workshop/record.mjs');
 const root=mechanismObject(next.recipe,next.geometry),records=createSceneRecordOperations({readers:{transform:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),materials:()=>null}});
 const record=records.serialize({id:'surface',type:'pbr',source:'kaminos:link-mechanism',object:root});let restored;
 await createSceneRecordOperations({loaders:{constructed:o=>(restored=o)}}).load(record);assert.deepEqual(restored.userData.linkMechanism,next.recipe);assert.deepEqual(restored.userData.linkGeometry,next.geometry,'Normal scene save/load retains clipped surfaces');
}
{
 const {default:workshop}=await import('../experiments/link-workshop.experiment.mjs');let added=0,ensured=0,remembered;
 const runtime={read:()=>({objectId:'kept'}),operations:{frame(){},mode(){}}},object={userData:{linkMechanism:next.recipe}},service={add:async(recipe,{geometry})=>{added++;assert.equal(geometry,next.geometry);return runtime;},ensure:async root=>{ensured++;assert.equal(root,object);return runtime;}};
 const host={controls:{document:{defaultView:{kaminosMechanisms:service,kaminosSelection:{read:()=>({activeId:'kept'})}}}},scene:{objects:()=>[{id:'kept',object}],select(){}}};
 await workshop.create({host,inputs:{recipe:next.recipe,bodies:next.geometry},updateInputs:v=>remembered=v});assert.equal(added,1);assert.deepEqual(remembered,{objectId:'kept'});
 await workshop.create({host,inputs:remembered});assert.equal(ensured,1);assert.equal(added,1,'Saved experiment adopts its restored mechanism without adding a fixture');
}
// Reconstructed physical hardware must agree with the endpoint math.
{
 const {addSurfaceActuators}=await import('../experiments/link-workshop/surface.mjs');
 const object=new T.ObjectLoader().parse(next.geometry.bodies.find(b=>b.id==='pin:1').object);assert.ok(Math.abs(object.children[0].position.x+.27)<1e-6,'Serialized pin retains the original lever eye instead of drifting to the seam');
 const built=addSurfaceActuators(next.recipe,next.geometry,2),rod=new T.ObjectLoader().parse(built.geometry.bodies.find(b=>b.id==='piston:1:rod').object);assert.ok(rod.children[0].position.x<-.02,'Serialized rod keeps its constructed position');
}
{
 const {addSurfaceActuators,closestSurfacePatch}=await import('../experiments/link-workshop/surface.mjs');const a=addSurfaceActuators(next.recipe,next.geometry,2),p=a.recipe.pistons[2];
 for(const end of ['a','b']){const id=`link:${p[end]}`,patch=p[end+'Seat'],actual=closestSurfacePatch(next.geometry,id,patch);assert.ok(new T.Vector3(...patch).distanceTo(new T.Vector3(...actual))<1e-8,'Mounting support starts on an actual retained triangle');const body=new T.ObjectLoader().parse(a.geometry.bodies.find(b=>b.id===id).object),supports=body.children.filter(m=>m.name==='Panel-to-horn support');assert.ok(supports.length);body.updateMatrixWorld(true);assert.ok(supports.some(m=>{m.geometry.computeBoundingBox();return m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).distanceToPoint(new T.Vector3(...patch))<1e-6;}),'Reconstructed support reaches its retained panel patch');}
}
