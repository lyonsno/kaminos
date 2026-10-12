import test from 'node:test';
import assert from 'node:assert/strict';
import {collisionVoxelInstances} from '../scene-collision-debug.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
test('mask surface uses solver indexing and domain world transform, without inventing empty cells',()=>{
 const cells=new Uint8Array(4*8*4);cells[1+4*(2+8*3)]=1;
 const result=collisionVoxelInstances({cells,dimensions:[4,8,4],transform:{translate:[2,3,4],scale:2}});
 assert.deepEqual(result.centres,[[1.5,3.5,5.5]]);assert.equal(result.size,1);
 cells.fill(1);assert.equal(collisionVoxelInstances({cells,dimensions:[4,8,4],transform:{translate:[0,0,0],scale:1}}).centres.length,104,'only fully enclosed solids are omitted');
 assert.throws(()=>collisionVoxelInstances({cells:new Uint8Array(2),dimensions:[4,8,4],transform:{translate:[0,0,0],scale:1}}),/mask/);
});
test('debug reads installed mask, clears unavailable data, and isolates caller mutation',()=>{
 const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const method=source.match(/    readSceneCollisionMask\([\s\S]*?\n    },/);
 assert.ok(method,'runtime must expose the installed collision mask');
 const ctx={sceneSolidRevisionKey:'r1',sceneSolidCellsCpu:new Uint8Array([1,0]),gridSize:1,gridHeight:2,productTransform:{translate:[1,2,3],scale:2},state:{sceneCollision:{effective:'mesh-voxel-solid'}},structuredClone};
 const runtime=vm.runInNewContext(`({${method[0].replace(/,$/,'')}})`,ctx);
 const result=runtime.readSceneCollisionMask();assert.deepEqual(Array.from(result.cells),[1,0]);result.cells[0]=0;assert.equal(ctx.sceneSolidCellsCpu[0],1);
 assert.equal(runtime.readSceneCollisionMask(result.revision),null);
 ctx.sceneSolidCellsCpu=null;ctx.sceneSolidRevisionKey='off';assert.equal(runtime.readSceneCollisionMask('r1').cells,null);
});
test('incremental voxel read includes domain frame even when installed local mask is unchanged',()=>{
 const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const method=source.match(/    readSceneCollisionMask\([\s\S]*?\n    },/)[0];
 const ctx={sceneSolidRevisionKey:'wall',sceneSolidCellsCpu:new Uint8Array([1,0]),gridSize:1,gridHeight:2,productTransform:{translate:[0,0,0],scale:1},state:{sceneCollision:{effective:'emitter-back-wall'}},structuredClone};
 const api=vm.runInNewContext(`({${method.replace(/,$/,'')}})`,ctx),first=api.readSceneCollisionMask();
 ctx.productTransform.translate[0]=4;
 const moved=api.readSceneCollisionMask(first.revision);assert.ok(moved,'world movement must refresh the overlay');assert.equal(moved.transform.translate[0],4);
});
