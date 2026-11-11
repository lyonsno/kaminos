// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createSurfaceTool} from '../experiments/link-workshop/surface-tool.mjs';
import {actuatorReport} from '../experiments/link-workshop/surface.mjs';

const model={schema:'kaminos.links.v1',nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[0,1],surfacePanel:{index:0}}],pistons:[{a:0,b:1,aOffset:[0,-1],bOffset:[1,.3],hinge:true}],period:3};
let t=0,selected=1,canvases=0;
const root=new T.Group(),body=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(2,.2,.2));root.add(body);body.add(mesh);
const tool=createSurfaceTool({root,view:{bodyMeshes:id=>id==='link:0'?[]:[mesh]},host:{},win:{document:{createElement(){canvases++;return {getContext:()=>({fillRect(){},fillText(){}})};}}},session:{redraw(){}},relatedAssets:[],getModel:()=>model,getFraction:()=>t,getSelected:()=>selected});
tool.refresh(true);
const overlay=root.children.find(o=>o.userData.mechanismOverlay),children=[...overlay.children],sprite=children.find(o=>o.isSprite),edges=children.find(o=>o.isLineSegments),line=children.find(o=>o.isLine&&!o.isLineSegments);
const resources=children.map(o=>[o.geometry,o.material,o.material?.map]),initialLabel=sprite.position.clone();
let released=0;for(const r of resources.flat().filter(Boolean))r.addEventListener('dispose',()=>released++);
t=.6;body.rotation.z=.6;tool.refresh(true);
assert.equal(canvases,1,'Moving a panel must reuse its label canvas/texture');
assert.deepEqual(overlay.children,children,'Pose changes retain the anatomy objects');
assert.ok(sprite.position.distanceTo(initialLabel)>.1,'The retained label follows its panel');
assert.deepEqual(overlay.children.map(o=>[o.geometry,o.material,o.material?.map]),resources,'Animation reuses geometry, materials and textures');
assert.equal(released,0,'Animation must not dispose live anatomy resources');
const positionVersion=line.geometry.attributes.position.version;tool.refresh(true);assert.equal(line.geometry.attributes.position.version,positionVersion,'An unchanged frame does not rewrite line buffers');
root.updateWorldMatrix(true,true);assert.ok(edges.matrix.equals(root.matrixWorld.clone().invert().multiply(mesh.matrixWorld)),'Retained edges follow the actual selected mesh');
root.position.x=3;body.position.y=1;tool.refresh(true);root.updateWorldMatrix(true,true);assert.ok(edges.matrix.equals(root.matrixWorld.clone().invert().multiply(mesh.matrixWorld)),'External mesh/root transforms update the edge placement');
tool.refresh(false);assert.equal(overlay.visible,false);tool.refresh(true);assert.equal(canvases,1,'Toggling anatomy reuses its resources');
selected=0;tool.refresh(true);assert.ok(overlay.children.includes(edges)&&!edges.visible,'Unselected live body retains hidden cached edges');
assert.equal(released,0,'Changing selection must not dispose reusable edges');
selected=1;tool.refresh(true);assert.equal(overlay.children.find(o=>o.isLineSegments),edges,'Returning to a selected mesh reuses its edge extraction');const replacement=new T.BoxGeometry(3,.2,.2),priorEdges=overlay.children.find(o=>o.isLineSegments);mesh.geometry=replacement;tool.refresh(true);assert.notEqual(overlay.children.find(o=>o.isLineSegments).geometry,priorEdges.geometry,'Replacing source geometry refreshes its edges');
await tool.dispose();assert.ok(!overlay.parent);assert.ok(released>2,'Closing releases retained resources');mesh.geometry.dispose();mesh.material.dispose();

const first=actuatorReport(model);assert.strictEqual(actuatorReport(model),first,'Unchanged authored motion reuses its whole-cycle analysis');
assert.deepEqual(first,[{index:0,minLength:1.6401219466856725,maxLength:2.0241352111794995,minMomentArm:.14221431890314737,deadCenter:false,method:'101 uniform pose samples; clearance unverified'}],'Cached analysis retains the pre-change sampled result');
model.period=10;assert.strictEqual(actuatorReport(model),first,'Playback speed does not change the normalized motion report');
const oldMax=first[0].maxLength;model.nodes[1].angles[1]=.2;const changed=actuatorReport(model);assert.notStrictEqual(changed,first,'An in-place pose edit invalidates the analysis');assert.notEqual(changed[0].maxLength,oldMax);
assert.throws(()=>{changed[0].maxLength=0;},TypeError,'Cached diagnostics cannot be corrupted by a caller');
model.pistons[0].bOffset=[1,0];assert.notStrictEqual(actuatorReport(model),changed,'Mount edits invalidate the analysis');
const other=structuredClone(model),otherRows=actuatorReport(other);assert.strictEqual(actuatorReport(model),actuatorReport(model));assert.strictEqual(actuatorReport(other),otherRows,'Different mechanisms retain independent analysis caches');
console.log('Anatomy resources persist through motion and authored cylinder analysis invalidates on edits');
