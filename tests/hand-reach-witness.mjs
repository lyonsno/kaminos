// kaminos-test: node
import assert from 'node:assert/strict';
import {assertLivePlacement, assertRuntimeSource} from '../models/mobrecon/hand-reach-witness.mjs';
const good={presentation:'live-hand',visible:true,running:true,received:3,
  prediction:{hasHand:true,acquisition:{source:'wilor_yolo_detector_bbox_only',fallback:false}},
  placement:{valid:true,vertexCount:778,jointCount:21},
  identity:{detector:{backend:'webgpu-local'},mobrecon:{backend:'webgpu-local'}},
  inputSource:{kind:'live-camera',frameId:1},state:{tracking:true}};
assertLivePlacement(good);
for(const patch of [{presentation:'replay-hand'},{visible:false},{received:0},
  {placement:{valid:false}},{identity:{detector:{backend:'cpu'},mobrecon:{backend:'webgpu-local'}}},
  {prediction:{hasHand:true,acquisition:{source:'manual_crop_fallback_no_detection',fallback:true}}},{inputSource:{kind:'retained-prediction'}}]) {
  assert.throws(()=>assertLivePlacement({...good,...patch}));
}
const revision='a'.repeat(40), source={commit:revision,repoRoot:'/observed/checkout',dirty:false};
assertRuntimeSource({source},revision);
assert.throws(()=>assertRuntimeSource({},revision),/served revision/);
assert.throws(()=>assertRuntimeSource({source:{...source,commit:'b'.repeat(40)}},revision),/served revision/);
assert.throws(()=>assertRuntimeSource({source:{...source,dirty:true}},revision),/dirty/);
assert.throws(()=>assertRuntimeSource({source:{...source,repoRoot:undefined}},revision),/root/);
