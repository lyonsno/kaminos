import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {buildFixedCellShell,applyFixedCellShell} from '../structural-material-bounded-fragments.mjs';
import * as cells from '../structural-material-bounded-fragments.mjs';
import {contactPatch} from '../structural-material-stress-release.mjs';
import {materialComponents} from '../structural-material-solid-surface.mjs';
import {Mesh,MeshBasicMaterial,DoubleSide,Raycaster,Vector3} from 'three';
import {createShardGeometry} from '../structural-material-shard-render.js';
const rest=[[0,0,0],[.3,0,0],[0,.3,0],[0,0,.3]],pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],bonds=pairs.flatMap(p=>[...p,0,0]),shell=buildFixedCellShell({positions:rest,tetrahedra:[[0,1,2,3]],bonds}),current=rest.map((p,i)=>p.map((v,k)=>v+(i===1&&k===0?.06:0))),vertices=applyFixedCellShell(shell.binding,current,bonds),geometry=createShardGeometry(shell.geometry);
shell.geometry.indices.forEach((id,i)=>geometry.attributes.position.setXYZ(i,...vertices[id]));geometry.computeBoundingSphere();
const mesh=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));mesh.updateMatrixWorld();const ray=new Raycaster(new Vector3(.1683333331,.0583333332,1),new Vector3(0,0,-1)),hit=ray.intersectObject(mesh)[0];assert.ok(hit);const anchors=shell.geometry.indices.slice(hit.faceIndex*3,hit.faceIndex*3+3).map(i=>shell.binding.entries[i].anchor);assert.deepEqual(anchors,[1,1,1]);
const point=hit.point.toArray(),nearest=current.map(p=>Math.hypot(...p.map((v,k)=>v-point[k])));assert.ok(nearest[0]<nearest[1],'Actual visible cell must differ from nearest mechanical node');
const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),code=source.slice(source.indexOf('async function beginPick('),source.indexOf('async function finishGesture('));
async function run(inFlight){let complete;const gate=new Promise(r=>complete=r),captures=[],ctx={failure:null,bounded:true,interiorSplit:false,pieces:[{...shell,mesh}],body:{positions:rest},observed:{state:Array(64).fill(0)},components:materialComponents(4,bonds),positions:()=>current,configuration:{patchRadius:.28,gripStiffness:200000},contactPatch,boundedCellAnchor:cells.boundedCellAnchor,gestureGeneration:0,controls:{enabled:true},marker:{position:{fromArray(){}},visible:false},settle:()=>inFlight?gate:Promise.resolve(),resident:{capturePatch:async p=>captures.push(p)},stamp(){}};
 vm.runInNewContext(code+'; task=beginPick(0,'+JSON.stringify(point)+','+hit.faceIndex+');',ctx);
 if(inFlight){ctx.components=[0,7,2,3];complete();}await ctx.task;assert.equal(ctx.gesture.patch.length,1);assert.equal(ctx.gesture.patch[0].index,1,'Clicked cell, not nearest different fragment, owns grip');assert.equal(ctx.gesture.component,inFlight?7:1);assert.equal(captures.length,1);
}
await run(false);await run(true);geometry.dispose();mesh.material.dispose();console.log('Actual shell hit owns the grip across disconnected and in-flight component changes');
