import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {buildFixedCellShell,applyFixedCellShell,boundedCellAnchor} from '../structural-material-bounded-fragments.mjs';
import {Mesh,MeshBasicMaterial,DoubleSide,Raycaster,Vector3} from 'three';
import {createShardGeometry} from '../structural-material-shard-render.js';
const rest=[[0,0,0],[.3,0,0],[0,.3,0],[0,0,.3]],pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],bonds=pairs.flatMap(p=>[...p,0,0]),shell=buildFixedCellShell({positions:rest,tetrahedra:[[0,1,2,3]],bonds}),current=rest.map((p,i)=>p.map((v,k)=>v+(i===1&&k===0?.06:0))),vertices=applyFixedCellShell(shell.binding,current,bonds),geometry=createShardGeometry(shell.geometry);
shell.geometry.indices.forEach((id,i)=>geometry.attributes.position.setXYZ(i,...vertices[id]));geometry.computeBoundingSphere();
const mesh=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));mesh.updateMatrixWorld();
const hit=new Raycaster(new Vector3(.1683333331,.0583333332,1),new Vector3(0,0,-1)).intersectObject(mesh)[0];assert.ok(hit);
const anchor=boundedCellAnchor(shell.binding,shell.geometry.indices,hit.faceIndex);assert.equal(anchor,1);
const nearest=current.map(p=>Math.hypot(...p.map((v,k)=>v-hit.point.toArray()[k])));assert.ok(nearest[0]<nearest[1]);
const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),code=source.slice(source.indexOf('async function beginPick('),source.indexOf('async function finishGesture('));
function context(gate=Promise.resolve()){
 const captures=[];
 return {captures,failure:null,bounded:true,pieces:[{...shell,mesh}],boundedCellAnchor,configuration:{patchRadius:.28,gripStiffness:200000},residentGrip:{route:'resident',async begin(...args){captures.push(args);}},gestureGeneration:0,pendingPick:false,controls:{enabled:true},marker:{position:{fromArray(){}},visible:false},settle:()=>gate,stamp(){},positions(){throw new Error('Contact must not use CPU positions');},contactPatch(){throw new Error('Contact must not use CPU connectivity');}};
}
const ctx=context();vm.runInNewContext(code+';task=beginPick(0,'+JSON.stringify(hit.point.toArray())+','+hit.faceIndex+');',ctx);await ctx.task;
assert.equal(ctx.captures[0][0],1,'Actual clicked cell, not nearest mechanical point, owns resident grip');assert.equal(ctx.gesture.cellAnchor,1);assert.equal(ctx.gesture.phase,'active');assert.equal(ctx.pendingPick,false);
let finish;const gate=new Promise(r=>finish=r),ordered=context(gate);vm.runInNewContext(code+';task=beginPick(0,'+JSON.stringify(hit.point.toArray())+','+hit.faceIndex+');',ordered);
const newer={cellAnchor:2,phase:'capturing'};ordered.gestureGeneration++;ordered.gesture=newer;finish();await ordered.task;
assert.equal(ordered.captures.length,0,'Old contact cannot capture a newer gesture');assert.equal(ordered.gesture,newer);
geometry.dispose();mesh.material.dispose();console.log('Actual shell hit retains clicked resident cell and newer-gesture ordering without CPU state');
