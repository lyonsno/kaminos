// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {defaultDock,dockMembers,createDock,rebuildDock,DOCK_SOURCE,checkedDock} from '../stockroom-dock.mjs';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';

test('footprint edits change member count without stretching board widths',()=>{
 const p=defaultDock(),a=dockMembers(p),b=dockMembers({...p,depth:4.4});
 const boards=x=>x.filter(m=>m.role==='deck');
 assert.ok(boards(a).length>10,'dock must contain real individual boards');
 assert.ok(boards(b).length>boards(a).length);
 for(const m of boards(b))assert.ok(m.size[2]<=.24&&m.size[2]>.1);
 assert.equal(Math.min(...boards(b).map(m=>m.position[2]-m.size[2]/2)),-2.2);
 assert.ok(Math.abs(Math.max(...boards(b).map(m=>m.position[2]+m.size[2]/2))-2.2)<1e-9);
});
test('board direction changes framing and support bays remain bounded',()=>{
 const p={...defaultDock(),width:8.1,boardDirection:'z'},m=dockMembers(p);
 const boards=m.filter(m=>m.role==='deck'),joists=m.filter(m=>m.role==='joist');
 assert.ok(boards.length>20);assert.ok(boards.every(m=>m.size[0]<=.24&&m.size[2]===p.depth));
 assert.ok(joists.length>2);assert.ok(joists.every(m=>m.size[0]===p.width));
 const xs=[...new Set(m.filter(m=>m.role==='post').map(m=>m.position[0]))].sort((a,b)=>a-b);
 assert.ok(xs.length>=5);for(let i=1;i<xs.length;i++)assert.ok(xs[i]-xs[i-1]<=p.bayLength);
});
test('stairs meet the deck edge and descend uniformly to a real landing',()=>{
 const p=defaultDock(),m=dockMembers(p),t=m.filter(m=>m.role==='tread');
 assert.ok(t.length>3);assert.equal(t[0].position[0]-t[0].size[0]/2,p.width/2);
 const surfaces=t.map(m=>m.position[1]+m.size[1]/2),rise=p.height-surfaces[0];
 for(let i=1;i<surfaces.length;i++)assert.ok(Math.abs(surfaces[i-1]-surfaces[i]-rise)<1e-9);
 assert.ok(Math.abs(surfaces.at(-1)-p.landingHeight-rise)<1e-9);
 const landing=m.find(m=>m.role==='landing');assert.ok(landing);
 assert.equal(landing.position[1]+landing.size[1]/2,p.landingHeight);
 assert.equal(dockMembers({...p,stairs:false}).filter(m=>['tread','stringer','landing'].includes(m.role)).length,0);
});
test('member identities survive extent edits and malformed dimensions fail loudly',()=>{
 const p=defaultDock(),a=dockMembers(p),b=dockMembers({...p,width:7});
 assert.equal(new Set(a.map(m=>m.id)).size,a.length);
 assert.ok(a.filter(m=>b.some(n=>m.id===n.id)).length>a.length/2);
 for(const patch of [{width:NaN},{depth:-2},{height:0},{boardDirection:'diagonal'},{stairs:'yes'},{landingHeight:2}])assert.throws(()=>dockMembers({...p,...patch}));
});
test('default stair and landing do not lower the floor beneath the post feet',()=>{
 const box=new THREE.Box3().setFromObject(createDock());assert.ok(box.min.y>=-1e-9,`lowest member at ${box.min.y}`);
});
test('native record, document and decoder preserve authored members and placement',async()=>{
 const p={...defaultDock(),width:7.2,memberOffsets:{'deck:0':{position:[.1,.02,0],rotation:[0,.01,0],scale:[1,1,.9]}}},root=createDock(p);
 root.position.set(2,0,-3);root.rotation.y=.4;
 const entry=createSceneObjectRecord(root,{id:'dock',type:'pbr'},{id:'dock'}),records=createSceneRecordOperations({readers:{transform:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),materials:()=>null},loaders:{constructed:(o,r)=>{o.position.fromArray(r.transform.position);o.rotation.set(...r.transform.rotation);return o;}}});
 const saved=records.serialize(entry),document=buildSceneDocument({objects:[saved]}),record=planSceneRestore(JSON.parse(JSON.stringify(document))).objects[0];
 assert.equal(record.source,DOCK_SOURCE);assert.deepEqual(record.dock,p);assert.equal(records.reloadable(record),true);
 const restored=await records.load(record);assert.deepEqual(restored.position.toArray(),root.position.toArray());assert.deepEqual(restored.children.map(m=>[m.name,m.position.toArray(),m.scale.toArray()]),root.children.map(m=>[m.name,m.position.toArray(),m.scale.toArray()]));
 assert.equal(records.reloadable({...record,dock:{...p,width:null}}),false);
 assert.throws(()=>checkedDock({...p,memberOffsets:{'deck:0':{position:[0,0,0],rotation:[0,0,0],scale:[-1,1,1]}}}));
});
test('recipe preview, cancel and Undo use native history while sharing member resources',()=>{
 const root=createDock(),before=structuredClone(root.userData.stockroomDock),geometry=root.children[0].geometry,edits=createSceneEdits({read(){},write(){}});
 edits.register('@dock:test',{read:()=>root.userData.stockroomDock,check:checkedDock,write:p=>rebuildDock(root,p)});
 edits.begin('@dock:test','Resize');edits.preview({...before,width:8});assert.equal(root.userData.stockroomDock.width,8);edits.cancel();assert.deepEqual(root.userData.stockroomDock,before);
 edits.begin('@dock:test','Resize');for(const depth of [3.2,3.4,3.6])edits.preview({...before,depth});edits.commit();assert.equal(edits.state().undoCount,1);edits.undo();assert.deepEqual(root.userData.stockroomDock,before);edits.redo();assert.equal(root.userData.stockroomDock.depth,3.6);assert.ok(root.children.every(m=>m.geometry===geometry));
});
