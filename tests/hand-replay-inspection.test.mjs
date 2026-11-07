// kaminos-test: node
import assert from 'node:assert/strict';
import experiment from '../experiments/hand-replay.experiment.mjs';
const hash=async t=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t))),b=>b.toString(16).padStart(2,'0')).join('');
const camera={schema:'hand-state.source-camera.v1',imageSize:[640,480],intrinsics:[500,500,320,240],translation:[0,0,1],method:'test_projection',basis:'opencv_x_right_y_down_z_forward'};
const hand={status:'observed',vertices:Array.from({length:778},(_,i)=>[i%3*.01,i%7*.01,i%2*.02]),joints:Array.from({length:21},(_,i)=>[i*.005,(i%4)*.01,0]),camera,cropBox:[200,100,400,300]};
const models=['original','trained'].map(id=>({id,label:id,checkpointSha256:'a'.repeat(64),faces:[[0,1,2]]}));
const data={schema:'hand-state.teacher-replay.v1',generation:'test',label:'camera fixture',models,frames:[0,100].map((timeMs,i)=>({captureId:'f'+i,timeMs,image:'/frame.jpg',hands:[0,1].map(()=>({...structuredClone(hand),camera:{...camera,sourceCaptureId:'f'+i}}))}))};
const legacy=structuredClone(data);legacy.label='legacy';for(const f of legacy.frames)for(const h of f.hands)delete h.camera;const legacySeq=JSON.stringify(legacy);
const seq=JSON.stringify(data),catalog=JSON.stringify({generation:'test',models,sequences:[{url:'/sequence',sha256:await hash(seq)},{url:'/legacy',sha256:await hash(legacySeq)}]});
const receipt=JSON.stringify({status:'observed',generation:'test',catalogSha256:await hash(catalog)});
globalThis.fetch=async url=>({ok:true,text:async()=>({'/catalog.json':catalog,'/sequence':seq,'/legacy':legacySeq,'/export-report.json':receipt}[new URL(url,'http://fixture').pathname])});
globalThis.Image=class{width=640;height=480;set src(v){this._src=v;queueMicrotask(()=>this.onload());}get src(){return this._src;}};
class Element{style={};dataset={};children=[];append(...x){this.children.push(...x);}setAttribute(k,v){this[k]=v;}getContext(){return {fillRect(){},fillText(){},clearRect(){},drawImage(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},getImageData(){return {data:new Uint8ClampedArray(4*640*640)};},putImageData(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}}};}}
const attached=[];const scene={attach:async r=>attached.push(r),readView:()=>({}),redraw(){},setView(){},onFrame:()=>()=>{},async dispose(){}};
const instance=await experiment.create({host:{controls:{document:{baseURI:'http://fixture',defaultView:{},createElement:()=>new Element()}},scene:{open:async()=>scene}},inputs:{manifest:'/catalog.json'},record(){}});
assert.equal(typeof instance.operations.setProjectionLocked,'function','inspection needs an explicit projection lock operation');
instance.operations.setViewMode('inspection');assert.equal(instance.read().inspection.locked,true);
assert.throws(()=>instance.operations.rotateHands({dx:20,dy:10}),/locked/);
instance.operations.setProjectionLocked(false);instance.operations.rotateHands({dx:20,dy:10});
const rotated=instance.read().inspection.rotations;assert(rotated.every(q=>Math.abs(q[0])+Math.abs(q[1])>0));
instance.operations.snapHand(0);let s=instance.read().inspection;assert.deepEqual(s.rotations[0],[0,0,0,1]);assert.deepEqual(s.rotations[1],rotated[1]);assert.equal(s.locked,false);
instance.operations.snapHands();assert(instance.read().inspection.rotations.every(q=>q.every((x,i)=>x===[0,0,0,1][i])));
instance.operations.setMeshFrozen(true);instance.operations.seek(1);assert.equal(instance.read().inspection.meshFrame,0);assert.equal(instance.read().inspection.imageFrame,1);
instance.operations.setMeshFrozen(false);assert.equal(instance.read().inspection.meshFrame,1);
instance.operations.setProjectionLocked(true);assert.equal(instance.read().inspection.locked,true);assert.deepEqual(data.frames[0].hands[0].vertices,hand.vertices);
await instance.dispose();console.log('spatial inspection lock, shared rotation, individual snap and held pose passed');
