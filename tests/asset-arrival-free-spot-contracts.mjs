// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as arrival from '../asset-arrival.mjs';
const {chooseAppendAnchor}=arrival;
const box=(x0,z0,x1,z1)=>({min:[x0,0,z0],max:[x1,2,z1]});
const overlaps=(a,[x,z],[w,d],m=0)=>x-w/2-m<a.max[0]&&x+w/2+m>a.min[0]&&z-d/2-m<a.max[2]&&z+d/2+m>a.min[2];

test('an open pivot is used as is',()=>{
 assert.deepEqual(chooseAppendAnchor({footprint:[1,1],pivot:[0,0],obstacles:[box(3,3,4,4)],viewDirection:[0,0.3,1]}).anchor,[0,0]);
});

test('an occupied pivot moves to the nearest clear spot beside the obstacle, not hidden behind it',()=>{
 const kiln=box(-1,-1,1,1);
 const result=chooseAppendAnchor({footprint:[0.8,0.8],pivot:[0,0],obstacles:[kiln],viewDirection:[0,0.3,1],margin:0.15});
 assert.equal(result.reason,'nearest-clear');
 assert.equal(overlaps(kiln,result.anchor,[0.8,0.8],0.15),false,'clear of the kiln with margin');
 assert.ok(Math.abs(result.anchor[0])>Math.abs(result.anchor[1]),'beside (across the view), not in front or behind');
 assert.ok(Math.hypot(...result.anchor)<2.5,'stays close to the pivot');
});

test('every obstacle is respected, including the fire box',()=>{
 const obstacles=[box(-1,-1,1,1),box(1,-1,3,1),box(-3,-1,-1,1)];
 const result=chooseAppendAnchor({footprint:[1,1],pivot:[0,0],obstacles,viewDirection:[0,0.3,1]});
 for(const o of obstacles)assert.equal(overlaps(o,result.anchor,[1,1],0.15),false);
});

test('with nowhere clear in range it says so and keeps the pivot',()=>{
 const result=chooseAppendAnchor({footprint:[1,1],pivot:[0,0],obstacles:[box(-100,-100,100,100)],viewDirection:[0,0,1]});
 assert.deepEqual(result,{anchor:[0,0],reason:'no-clear-spot'});
});

test('appends anchor on the scene content, not an orbit pivot parked near the camera',()=>{
 const {appendArrivalPivot}=arrival;
 const kiln=box(-1.7,-2.6,2.3,2.8),burner=box(-0.9,-0.9,0.9,0.9);
 const centre=appendArrivalPivot([kiln,burner],[2.6,10.3]);assert.ok(Math.abs(centre[0]-0.3)<1e-9&&Math.abs(centre[1]-0.1)<1e-9,String(centre));
 assert.deepEqual(appendArrivalPivot([],[2.6,10.3]),[2.6,10.3],'an empty scene keeps the pivot');
 const spot=chooseAppendAnchor({footprint:[0.9,1],pivot:appendArrivalPivot([kiln,burner],[2.6,10.3]),obstacles:[kiln,burner],viewDirection:[0.3,0.1,1]});
 assert.equal(spot.reason,'nearest-clear');assert.equal(overlaps(kiln,spot.anchor,[0.9,1],0.15),false);
 assert.ok(Math.hypot(spot.anchor[0]-0.3,spot.anchor[1]-0.1)<4,'right next to the kiln');
});

test('KMA-C03: the fire box counts as an obstacle whether or not its outline is shown',()=>{
 const {arrivalObstacleBoxes}=arrival;assert.equal(typeof arrivalObstacleBoxes,'function');
 const domain=box(-1,-1,1,1);
 for(const helperVisible of [true,false]){
  const obstacles=arrivalObstacleBoxes({objects:[],domain:{active:true,box:domain,helperVisible}});
  const spot=chooseAppendAnchor({footprint:[0.5,0.5],pivot:[0,0],obstacles,viewDirection:[0,0,1]});
  assert.equal(spot.reason,'nearest-clear',`helper visible ${helperVisible}`);
 }
 assert.deepEqual(arrivalObstacleBoxes({objects:[],domain:{active:false,box:domain}}),[],'no simulation, no fire box');
 assert.deepEqual(arrivalObstacleBoxes({objects:[{type:'camera',box:domain},{type:'glb',box:domain,visible:false},{type:'glb',box:domain}],domain:null}),[domain]);
});
