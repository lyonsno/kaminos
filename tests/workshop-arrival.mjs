// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import arrival from '../experiments/generation-arrival.experiment.mjs';

test('arrival composes the workshop owner and returns a newly made casting with the stage',async()=>{
 const mold=new Mesh(new BoxGeometry(2,1,1),new MeshBasicMaterial()),background=new Group(),piece=new Group();
 const rows=[{id:'mold',object:mold},{id:'background',object:background}],frames=[],shifts=[],view={position:[10,7,13],target:[0,1,-2],fov:38};
 let amount,paused=false,suspended=0,resumed=0,closed=0;
 const document={defaultView:{kaminosWaterSources:{read:()=>({runtime:{paused}})},kaminosPauseLocalLiquid:v=>paused=v},addEventListener(){},removeEventListener(){}};
 const host={controls:{document},scene:{objects:()=>rows,open:async()=>({readView:()=>view,redraw(){},onFrame:f=>{frames.push(f);return()=>{};},dispose(){}}),renderer:()=>({domElement:{clientWidth:1000,clientHeight:800}}),translateArrivalStage:(ids,offset)=>{shifts.push({ids,offset});for(const row of rows)if(ids.includes(row.id))row.object.position.add({x:offset[0],y:offset[1],z:offset[2]});},arrivalPresentation:{set:rows=>{amount=rows&&new Map(rows);},dispose(){}}}};
 let pieceId=null;
 const study=await arrival.create({host,inputs:{stageIds:['mold']},record(){}},async()=>({read:()=>({pieceId}),operations:{suspend:async()=>suspended++,resume:()=>resumed++},dispose(){closed++;}}));
 study.operations.enter();frames[0]({deltaSeconds:3});assert.equal(study.read().arrival.amount,1);
 rows.push({id:'piece',object:piece});pieceId='piece';piece.position.copy(mold.position);frames[0]({deltaSeconds:0});
 await study.operations.exit();assert.equal(suspended,1);assert.equal(paused,true);frames[0]({deltaSeconds:3});
 assert.equal(study.read().arrival.amount,0);assert.ok(shifts.at(-1).ids.includes('piece'));assert.ok(mold.position.length()<1e-9);assert.ok(piece.position.length()<1e-9);assert.equal(amount.get('background'),1);
 study.operations.enter();frames[0]({deltaSeconds:3});assert.equal(resumed,2);assert.equal(paused,false);assert.ok(piece.position.distanceTo(mold.position)<1e-9,'A retained casting follows the next entry as well');
 await study.dispose();assert.equal(closed,1);assert.equal(amount,null);assert.deepEqual(view,{position:[10,7,13],target:[0,1,-2],fov:38});
});
