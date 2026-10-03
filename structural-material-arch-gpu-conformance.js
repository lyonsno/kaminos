import * as THREE from 'three/webgpu';
import { ArchGpuEngine, createNativeGpuRenderer } from './dist/structural-material-arch-gpu-engine.js';

const status = document.querySelector('#status');
window.__gpuConformance = (async () => {
  const report = { phase: 'adapter', status: 'running', checks: [], samples: {}, errors: [] };
  const check = (name, passed, observed) => { report.checks.push({ name, passed, observed }); };
  try {
    const { renderer, device, identity } = await createNativeGpuRenderer(document.querySelector('canvas'));
    report.identity = identity;
    device.addEventListener('uncapturederror', event => report.errors.push(event.error.message));
    renderer.setSize(innerWidth, innerHeight * 0.85, false);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, innerWidth / (innerHeight * .85), .01, 100);
    camera.position.set(6, 4, 9); camera.lookAt(0, 1, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2c3844, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(2,5,4); scene.add(light);
    const engine = new ArchGpuEngine(device, { maxBodies: 4, gravity: [0,-9.81,0], deltaTime: 1/60, substeps: 1,
      solverIterations: 20, enableBvhBuild: false, maxPairsPerBodyBroadphase: 3,
      maxContactsPerBodySolver: 12, maxFixedStepsPerFrame: 1 });
    const floor = engine.addBody({ position: [0,-.2,0], halfExtents: [5,.2,4], mass: 0 });
    const fall = engine.addBody({ position: [-2,2,0], halfExtents: [.3,.3,.3], mass: 2 });
    const hang = engine.addBody({ position: [0,2,0], halfExtents: [.3,.3,.3], mass: 2 });
    const q = [0,0,Math.sin(.2),Math.cos(.2)];
    const rotated = engine.addBody({ position: [2,2,0], halfExtents: [.3,.3,.3], mass: 2, quaternion: q });
    const joint = engine.addSphericalJoint(null, hang, [0,2,0], [0,0,0], 1e6, false);
    engine.addFixedJoint(null, rotated, [2,2,0], [0,0,0], 1e6, false);
    const meshes = [[5,.2,4],[.3,.3,.3],[.3,.3,.3],[.3,.3,.3]].map((h,i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...h.map(value=>value*2)), new THREE.MeshStandardMaterial({ color: [0x36434b,0x87aaa2,0xe8c861,0xcb765d][i], roughness: .8 }));
      scene.add(mesh); return mesh;
    });
    const sample = async name => {
      const bodies = await engine.readRigidBodyStatesAsync(renderer), joints = await engine.readJointStatesAsync(renderer);
      report.samples[name] = { bodies, joints, stats: engine.getStats() };
      bodies.forEach((body,i) => { meshes[i].position.fromArray(body.position); meshes[i].quaternion.fromArray(body.quaternion); });
      renderer.render(scene,camera); await device.queue.onSubmittedWorkDone(); return { bodies, joints };
    };
    report.phase = 'simulation';
    for (let i=0;i<30;i++) engine.step(1/60,renderer);
    const early = await sample('half-second');
    check('falling body responds to gravity', early.bodies[fall].position[1] < 1.5, early.bodies[fall].position);
    for (let i=0;i<150;i++) engine.step(1/60,renderer);
    const rest = await sample('three-seconds');
    check('box rests on floor, not through it', Math.abs(rest.bodies[fall].position[1] - .3) < .035 && Math.abs(rest.bodies[fall].velocity[1]) < .15, rest.bodies[fall]);
    check('hanging joint carries weight', Math.abs(rest.bodies[hang].position[1] - 2) < .03, rest.bodies[hang]);
    const reaction = rest.joints.find(item=>item.joint===joint);
    const force = reaction.penaltyLin[1] * (2 - rest.bodies[hang].position[1]) + reaction.lambdaLin[1];
    report.samples.weightForce = force;
    check('finite joint reaction has force units', Math.abs(force - 19.62) < 3, force);
    const angleError = 2*Math.acos(Math.min(1,Math.abs(rest.bodies[rotated].quaternion.reduce((sum,value,i)=>sum+value*q[i],0))));
    check('fixed joint retains captured relative rotation', angleError < .02, angleError);
    check('all body state is finite', rest.bodies.every(body=>Object.values(body).filter(Array.isArray).flat().every(Number.isFinite)), rest.bodies);
    check('native GPU produced no validation error', report.errors.length===0, report.errors);
    check('collision dispatch did not truncate', !engine.getStats().pairDispatchTruncated, engine.getStats());
    report.phase='complete'; report.status=report.checks.every(item=>item.passed)?'passed':'failed';
  } catch (error) { report.status='failed'; report.failure={ phase:report.phase, message:error.message, stack:error.stack }; }
  status.textContent = JSON.stringify(report, null, 2); return report;
})();
