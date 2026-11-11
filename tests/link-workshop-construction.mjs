// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {emptyMechanism,checkedMechanism} from '../experiments/link-workshop/model.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createSceneComponentEdit} from '../scene-component-edit.mjs';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
const scene=new T.Scene(),root=new T.Group(),ids=['fixed','one','two','three','four','door','branch'];
const entries=ids.map(id=>({id,type:'pbr',object:new T.Group()}));scene.add(root,...entries.map(e=>e.object));entries.push({id:'mechanism',type:'pbr',object:root});
const m={...emptyMechanism(),mounts:[],attachments:[]};
for(let i=0;i<6;i++){
 const objectId=ids[i+1],parent=i===5?'two':ids[i],s='s'+i,d='t'+i;
 m.mounts.push({id:s,owner:{objectId},position:[0,0,0],rotation:[0,-Math.PI/2,0]},{id:d,owner:{objectId:parent},position:i?[1,0,0]:[0,0,0],rotation:[0,-Math.PI/2,0]});
 m.attachments.push({objectId,sourceMount:s,targetMount:d,offset:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},hinge:[[.7,-1,.8,-.6,.3,.2][i],[.4,-.8,.5,-.3,.2,-.4][i]],hardware:{family:'clevis',size:.1,mounting:'part-frames'}});
}
root.userData.linkMechanism=checkedMechanism(m);let selected='mechanism';
const edits=createSceneEdits({read(){throw Error('unexpected ordinary read');},write(){}}),components=createSceneComponentEdit({selected:()=>selected,cancel:()=>edits.cancel(),refresh(){}});
const host={scene:{objects:()=>entries,select:id=>selected=id,open:async()=>({attach:async()=>({id:'mechanism',root}),redraw(){},readView(){return {};},dispose:async()=>{}})},controls:{components,document:{defaultView:{kaminosSceneEdits:edits}}}};
const c=await createMechanismController({host,inputs:{root,mode:'A'}});
const matrix=id=>{const o=entries.find(e=>e.id===id).object;o.updateWorldMatrix(true,false);return o.matrixWorld.clone();};
const error=(a,b)=>Math.max(...a.elements.map((v,i)=>Math.abs(v-b.elements[i])));
try{
 assert.equal(typeof c.operations.anchorConstruction,'function','a construction needs persistent anchor/free operations on native body selections');
 c.operations.anchorConstruction({objectIds:['door','branch']});
 const anchored=c.read().recipe,goals=structuredClone(anchored.construction.anchors),worlds=new Map(['door','branch'].map(id=>[id,matrix(id)]));
 assert.equal(goals.length,2);assert.deepEqual(goals.map(g=>g.objectId),['door','branch']);
 c.operations.editAxle({objectId:'three'});const a=components.target(),start=a.read();
 edits.begin(a.id);edits.preview({position:[start.position[0],start.position[1]+.025,start.position[2]]});edits.commit();
 assert.deepEqual(c.read().recipe.construction.anchors,goals,'committing an accommodating edit retains authored anchor goals');
 assert.ok(c.read().construction.anchors.every(a=>a.positionError<1e-5&&a.angleError<1e-5),'all anchor residuals participate in the shared solve');
 for(const [id,w]of worlds)assert.ok(error(matrix(id),w)<1e-5,`actual ${id} remains anchored`);
 const first=c.read().recipe;assert.notDeepEqual(first.attachments.map(a=>a.hinge),anchored.attachments.map(a=>a.hinge),'actual joint angles accommodate');
 const repeated=components.target().read();assert.ok(repeated.position.every((v,i)=>Math.abs(v-[start.position[0],start.position[1]+.025,start.position[2]][i])<1e-12),'committed numbers retain authored coordinates');
 edits.begin(a.id);edits.preview({position:[...repeated.position]});edits.commit();assert.deepEqual(c.read().recipe,first,'an identical committed request cannot feed the achieved solution back into construction');
 edits.undo();assert.deepEqual(c.read().recipe,anchored);edits.redo();assert.deepEqual(c.read().recipe,first);
 for(const operation of ['editSeat','selectMount']){
  if(operation==='editSeat')c.operations.editSeat({objectId:'three'});else c.operations.selectMount({id:'t2'});
  const target=components.target();assert.equal(target.type,operation==='editSeat'?'connection-seating':'mount');const before=target.read();edits.begin(target.id);assert.throws(()=>edits.preview({scale:[2,2,2]}),/rigid|G.R/,'mount and seating coordinates must not silently ignore a scale request');edits.cancel();edits.begin(target.id);edits.preview({position:[before.position[0]+.01,...before.position.slice(1)]});edits.commit();const once=c.read().recipe;
  const value=components.target().read();edits.begin(target.id);edits.preview({position:[...value.position]});edits.commit();assert.deepEqual(c.read().recipe,once,`${operation} authored coordinates remain idempotent after commit`);
 }
 c.operations.freeConstruction({objectIds:['branch']});assert.deepEqual(c.read().recipe.construction.anchors.map(a=>a.objectId),['door']);
 const beforeMove=matrix('branch');c.operations.selectConstruction({objectIds:['branch']});const part=components.target(),p=part.read();edits.begin(part.id);edits.preview({position:[p.position[0]-.02,p.position[1]+.02,p.position[2]]});edits.commit();assert.ok(error(matrix('branch'),beforeMove)>.005,'a freed branch can move through native transforms');assert.ok(c.read().construction.anchors[0].positionError<1e-5);assert.equal(c.read().construction.requested[0].kind,'position');assert.ok(c.read().construction.requested[0].positionError<1e-5,'G seeks the requested point while allowing the part to rotate through its hinges');assert.deepEqual(c.read().recipe.construction.anchors[0],goals[0]);
 const continued=c.read().recipe;c.operations.anchorConstruction({objectIds:['branch']});assert.equal(c.read().recipe.construction.anchors.length,2);edits.undo();assert.deepEqual(c.read().recipe,continued,'anchor/free belongs to ordinary construction history');
 const saved=checkedMechanism(JSON.parse(JSON.stringify(c.read().recipe)));assert.deepEqual(saved.construction,c.read().recipe.construction);
 console.log('Multiple actual anchors, branching, persistent parameters, native move, changing scope, history and serialization pass');
}finally{await c.dispose();}

// A known reachable spatial pose exposes a planar-only or last-goal-only solve.
{
 const {anchorConstruction,solveConstruction,constructionBodyMatrix}=await import('../experiments/link-workshop/construction.mjs');
 for(const pose of ['A','B']){
  const t=pose==='B'?1:0,base=checkedMechanism(m);base.attachments[1].axle={position:[0,0,0],rotation:[.12,.08,0]};base.attachments[3].axle={position:[0,0,0],rotation:[-.15,.04,0]};
  const captured=anchorConstruction(root,base,['door','branch'],pose,entries),goals=JSON.stringify(captured.construction.anchors),displaced=checkedMechanism(captured);
  displaced.attachments[2].hinge[t]+=.025;displaced.attachments[4].hinge[t]-=.02;
  const result=solveConstruction(root,displaced,t,entries);assert.ok(result.anchors.every(a=>a.positionError<1e-5&&a.angleError<1e-5),'nonparallel hinge axes accommodate both known reachable goals');assert.equal(JSON.stringify(result.recipe.construction.anchors),goals);
  assert.deepEqual(result.recipe.attachments.map(a=>a.offset),captured.attachments.map(a=>a.offset),'solve never moves payload offsets to fake reach');
  assert.deepEqual(result.recipe.attachments.map(a=>a.hinge[1-t]),captured.attachments.map(a=>a.hinge[1-t]));
  const impossible={objectId:'door',target:{position:[100,100,100],rotation:[0,0,0],scale:[1,1,1]}},miss=solveConstruction(root,captured,t,entries,[impossible]);assert.ok(miss.requested[0].positionError>10);assert.equal(miss.requested[0].status,'residual');assert.equal(JSON.stringify(miss.recipe.construction.anchors),goals,'incompatible dragging does not recapture anchors');
  const broken=checkedMechanism(captured);broken.construction.anchors.push({objectId:'missing',pose,target:structuredClone(impossible.target)});assert.equal(solveConstruction(root,broken,t,entries).anchors.at(-1).status,'missing');
 }
 const duplicate=checkedMechanism(c.read().recipe);duplicate.construction.anchors.push(structuredClone(duplicate.construction.anchors[0]));assert.throws(()=>checkedMechanism(duplicate),/unique parts/);
}
