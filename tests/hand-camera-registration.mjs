// kaminos-test: node
import assert from 'node:assert/strict';

if (process.argv.includes('--baseline')) {
  const {displayPositions} = await import('../experiments/hand-mesh-webgpu.experiment.mjs');
  const a = new Float32Array([-.05, -.05, 0, .05, -.05, .01, 0, .05, -.01]);
  const b = a.map((v, i) => v + (i % 3 === 2 ? .1 : 0));
  const before = displayPositions(a).positions, after = displayPositions(b).positions;
  assert.ok(Math.abs(after[2] - before[2] - .1) < 1e-6,
    'the current centered diagnostic discards the 10 cm reach displacement');
  process.exit(0);
}

const {fitCameraTranslation, createHandRegistration, cameraToOperator} = await import('../models/mobrecon/hand-camera-registration.js');
const close = (a, b, epsilon = 1e-7) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < epsilon, `${i}: ${v} != ${b[i]}`));
};
const camera = {fx: 640, fy: 640, cx: 320, cy: 240};
const joints = Array.from({length: 21}, (_, i) => [((i % 5) - 2) * .02, (Math.floor(i / 5) - 2) * .025, Math.sin(i) * .01]).flat();
const project = (points, t) => Array.from({length: points.length / 3}, (_, i) => [
  camera.fx * (points[3*i] + t[0]) / (points[3*i+2] + t[2]) + camera.cx,
  camera.fy * (points[3*i+1] + t[1]) / (points[3*i+2] + t[2]) + camera.cy,
]).flat();
for (const translation of [[.03, -.04, .6], [-.07, .03, .85], [.1, 0, .3], [0, 0, 2]]) {
  const fit = fitCameraTranslation(joints, project(joints, translation), camera);
  assert.equal(fit.valid, true);
  close(fit.translation, translation);
  assert.ok(fit.rmsePx < 1e-5);
}
assert.equal(fitCameraTranslation(joints, Array(42).fill(320), camera).valid, false, 'collapsed 2D landmarks cannot locate depth');
assert.throws(() => fitCameraTranslation(joints, [NaN, ...project(joints, [0,0,.6]).slice(1)], camera), /finite/);
assert.throws(() => fitCameraTranslation(joints, project(joints,[0,0,.6]), {...camera,fx:0}), /camera/);

const palmIndices=[0,1,5,9,13,17],articulatedUV=project(joints,[.02,-.03,.6]);
for(let j=0;j<21;j++)if(!palmIndices.includes(j)){articulatedUV[j*2]+=18;articulatedUV[j*2+1]-=12;}
const palmFit=fitCameraTranslation(joints,articulatedUV,camera,{indices:palmIndices});
close(palmFit.translation,[.02,-.03,.6],1e-6);
assert.equal(palmFit.fitJointIndices.length,6);
assert.ok(palmFit.rmsePx>10,'unfitted finger disagreement remains visible, not hidden');

const regressor = Array.from({length:21}, (_, j) => Array.from({length:778}, (_, v) => v === j ? 1 : 0)).flat();
const resource = {schema:'mobrecon.hand-registration.v0', jointOrder:'mpii', vertexCount:778, regressor,
  source:{kind:'synthetic-contract-fixture'}};
const registration = createHandRegistration(resource);
const nativeVertices = new Float32Array(778 * 3);
nativeVertices.set(joints.map(v=>v/.2));
const cropBox = [40,20,540,520], t = [.02,-.03,.6];
const fullUV = project(joints,t);
const nativeUV = fullUV.map((v,i)=>(v-cropBox[i%2]) / 500 * 127 / 128);
const result = {hasHand:true, handedness:'right', nativeVertices, nativeUV, cropBox,
  identity:{routeId:'synthetic'}, acquisition:{source:'synthetic'}};
const placed = registration.place(result,{width:640,height:480});
assert.equal(placed.valid,true);
close(placed.translation,t,1e-6);
close(placed.worldJoints.slice(0,3),cameraToOperator(joints.slice(0,3).map((v,i)=>v+t[i])),1e-6);
assert.equal(placed.camera.authority,'assumed_not_calibrated');
assert.equal(placed.source.routeId,'synthetic');
assert.equal(registration.place({hasHand:false},{width:640,height:480}).valid,false);
assert.throws(()=>registration.place({...result,handedness:'sideways'},{width:640,height:480}),/handedness/);
assert.throws(()=>createHandRegistration({...resource,regressor:[1]}),/regressor/);

// Opposite-side view is a proper rotation, not reflection. A right palm's
// camera-right thumb becomes operator-left; the camera-facing normal reverses.
close(cameraToOperator([.05,0,.6]),[-.05,.2,0]);
const origin=cameraToOperator([0,0,.6]);
const x=cameraToOperator([1,0,.6]).map((v,i)=>v-origin[i]);
const y=cameraToOperator([0,1,.6]).map((v,i)=>v-origin[i]);
const z=cameraToOperator([0,0,1.6]).map((v,i)=>v-origin[i]);
close([x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]],z);
assert.ok(cameraToOperator([0,0,.5])[2]<cameraToOperator([0,0,.7])[2], 'reaching toward camera goes deeper from the operator side');

// Left-hand source mapping reflects crop pixel127, not normalized UV 1.0.
const leftMeters = joints.map((v,i)=>i%3===0?-v:v);
const leftUV = project(leftMeters,[-t[0],t[1],t[2]]);
const leftNative = leftUV.map((v,i)=> {
  const px=(v-cropBox[i%2])/500*127;
  return (i%2===0 ? 127-px : px)/128;
});
const left=registration.place({...result,handedness:'left',nativeUV:leftNative},{width:640,height:480});
close(left.translation,[-t[0],t[1],t[2]],1e-6);
console.log('hand camera registration: fit, crop inversion, handedness and operator-view contracts pass');
