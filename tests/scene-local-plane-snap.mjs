import test from 'node:test';
import assert from 'node:assert/strict';
import {transformPose,axisVector} from '../scene-edit-session.mjs';
import {Vector3} from '../lib/three.core.js';
test('increment snapping preserves a rotated local plane constraint',()=>{
  const base={position:[0,0,0],rotation:[0,0,.6],scale:[1,1,1]};
  const result=transformPose(base,{operation:'translate',axis:'x',plane:true,frame:'local',delta:[.15,.25,.04],snap:.1});
  const movement=new Vector3(...result.position);
  assert.ok(Math.abs(movement.dot(axisVector('x','local',base.rotation)))<1e-12,'locked local X must remain stationary under snapping');
  for(const axis of ['y','z']){const units=movement.dot(axisVector(axis,'local',base.rotation))/.1;assert.ok(Math.abs(units-Math.round(units))<1e-12);}
});
