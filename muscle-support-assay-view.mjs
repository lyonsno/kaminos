import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {createFixture,createTracker,diagnostics,supportGeometry,IDENTITY} from './muscle-support-assay-core.mjs';

const fixture=createFixture(),modes=['transport-field','bone-blend','field-only'];
let trackers=modes.map(mode=>createTracker(fixture,mode)),pose={quaternion:[...IDENTITY],bulge:0};
const events=[],samples=[],container=document.querySelector('#viewport');
let replay=null,lastSolveMs=0,syncing=false,renderer;
const scene=new THREE.Scene();scene.background=new THREE.Color('#101722');
const camera=new THREE.PerspectiveCamera(38,1,0.01,100);camera.position.set(0,1.1,6.7);
const views=[],colors=[0x62d6d2,0xf2b665,0xb898e9];
const boneMaterial=new THREE.MeshStandardMaterial({color:0xe8e3d1,roughness:0.8});
const muscleMaterial=new THREE.MeshStandardMaterial({color:0xc64648,roughness:0.6});
const markerMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.6});
const markerGeometry=new THREE.SphereGeometry(0.018,8,6);
scene.add(new THREE.HemisphereLight(0xe5edff,0x233b50,2.2));
const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-2,5,7);scene.add(light);
function cylinder(a,b,radius){
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,delta.length(),14),boneMaterial);
  mesh.position.copy(start.add(end).multiplyScalar(0.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return mesh;
}
for(let index=0;index<3;index++) {
  const group=new THREE.Group();group.position.x=(index-1)*3.75;scene.add(group);
  const upper=new THREE.Bone();upper.name='fixture-upper-bone';
  const joint=new THREE.Bone();joint.name='fixture-hinge-bone';upper.add(joint);group.add(upper);
  const supports=new THREE.Group();group.add(supports);
  supports.add(cylinder([-1.5,0,0],[0,0,0],0.18));
  const lower=new THREE.Group();lower.add(cylinder([0,0,0],[1.5,0,0],0.16));supports.add(lower);
  const muscle=new THREE.Mesh(new THREE.SphereGeometry(1,32,18),muscleMaterial);supports.add(muscle);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(fixture.positions,3));
  geometry.setIndex(fixture.indices);
  const vertexColors=[];
  for(let r=0;r<fixture.rings;r++)for(let s=0;s<fixture.sides;s++){
    const base=new THREE.Color(colors[index]);
    if(r%6===0)base.set(0x253747);else if(s%8===0)base.lerp(new THREE.Color(0xffffff),0.65);
    vertexColors.push(base.r,base.g,base.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(vertexColors,3));geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.65,side:THREE.DoubleSide,transparent:true,opacity:0.78,depthWrite:false});
  const skin=new THREE.Mesh(geometry,material);group.add(skin);
  const markers=[];
  for(let r=2;r<fixture.rings;r+=5)for(let s=0;s<fixture.sides;s+=8){
    const mesh=new THREE.Mesh(markerGeometry,markerMaterial);group.add(mesh);markers.push({mesh,vertex:r*fixture.sides+s});
  }
  views.push({group,joint,supports,lower,muscle,skin,markers});
}
function updateGeometry(){
  const support=supportGeometry(pose);
  views.forEach((view,index)=>{
    view.skin.geometry.attributes.position.array.set(trackers[index].positions);
    view.skin.geometry.attributes.position.needsUpdate=true;view.skin.geometry.computeVertexNormals();
    view.markers.forEach(({mesh,vertex})=>mesh.position.fromArray(trackers[index].positions,vertex*3));
    view.lower.quaternion.fromArray(pose.quaternion);view.joint.quaternion.fromArray(pose.quaternion);
    view.muscle.position.fromArray(support.center);view.muscle.scale.set(support.length/2,support.radius,support.radius*0.88);
    const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(...support.axis),new THREE.Vector3(...support.transverse),new THREE.Vector3(...support.normal));
    view.muscle.quaternion.setFromRotationMatrix(basis);
  });
}
function snapshot({includeSamples=true}={}){return {schema:'kaminos-muscle-support-assay-v1',status:renderer?'loaded':'loading',requestedUrl:location.href,
  effectiveRoute:'dedicated-kaminos-procedural-assay',rendererBackend:renderer?.backend?.constructor?.name,
  fixture:{source:fixture.source,rings:fixture.rings,sides:fixture.sides,vertices:fixture.weights.length,boundary:fixture.boundary},
  registeredObjects:views.map((view,i)=>({id:view.group.uuid,mode:modes[i],bone:view.joint.name,skin:view.skin.uuid})),
  selectedBone:gizmo?.object?.name??null,pose:structuredClone(pose),solveMs:lastSolveMs,
  metrics:trackers.map(tracker=>({mode:tracker.mode,steps:tracker.steps,...diagnostics(fixture,tracker.positions,pose)})),
  sampleCount:samples.length,samples:includeSamples?structuredClone(samples):[],events:structuredClone(events)};}
function applyPose(next,{record=true}={}){
  const start=performance.now();syncing=true;
  trackers.forEach(tracker=>tracker.step(next));pose=structuredClone(next);updateGeometry();lastSolveMs=performance.now()-start;syncing=false;
  const state=snapshot({includeSamples:false});
  if(record)samples.push({cycleId:replay?.id??null,pose:structuredClone(pose),solveMs:lastSolveMs,metrics:state.metrics,
    positions:trackers.map(tracker=>Array.from(tracker.positions))});
  document.querySelector('#stats').textContent=state.metrics.map(m=>`${m.mode.padEnd(17)}  field error ${m.fieldErrorMax.toExponential(2)}  edge ratio ${m.edgeRatioMin.toFixed(2)}–${m.edgeRatioMax.toFixed(2)}  rest RMS ${m.displacementRms.toFixed(4)}`).join('\n')+
    `\nCPU skin solve: ${lastSolveMs.toFixed(1)} ms / update · ${fixture.weights.length} vertices per view · all samples retained`;
}
function cyclePose(t){
  const wave=Math.sin(Math.PI*t)**2;
  return {quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9*wave,0,-1.05*wave)).toArray(),bulge:0.18*wave};
}
function reset(){replay=null;trackers=modes.map(mode=>createTracker(fixture,mode));pose={quaternion:[...IDENTITY],bulge:0};events.push({type:'explicit-reset',sampleIndex:samples.length});updateGeometry();applyPose(pose);}
let gizmo;
try {
  renderer=new THREE.WebGPURenderer({antialias:true});await renderer.init();container.appendChild(renderer.domElement);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,-0.1,0);orbit.update();
  gizmo=new TransformControls(camera,renderer.domElement);gizmo.setMode('rotate');gizmo.setSpace('local');gizmo.setSize(0.6);gizmo.attach(views[0].joint);scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed',event=>{orbit.enabled=!event.value;replay=null;events.push({type:'gizmo-drag',value:event.value,sampleIndex:samples.length});});
  gizmo.addEventListener('objectChange',()=>{if(!syncing)applyPose({quaternion:views[0].joint.quaternion.toArray(),bulge:pose.bulge});});
  const resize=()=>{const width=container.clientWidth,height=container.clientHeight;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();};
  addEventListener('resize',resize);resize();reset();
  document.querySelector('#cycle').onclick=()=>{replay={id:crypto.randomUUID(),step:0,steps:36,startSampleIndex:samples.length};events.push({type:'cycle-start',cycleId:replay.id,sampleIndex:samples.length,inputSteps:37});};
  document.querySelector('#bulge').onclick=()=>{replay=null;applyPose({quaternion:[...IDENTITY],bulge:pose.bulge>0?0:0.35});};
  document.querySelector('#reset').onclick=reset;
  document.querySelector('#supports').onchange=event=>views.forEach(view=>view.supports.visible=event.target.checked);
  window.kaminosSupportAssay={snapshot,applyPose,reset,cyclePose,
    sequence:steps=>{for(let i=0;i<=steps;i++)applyPose(cyclePose(i/steps));return snapshot();},
    exportHeader:()=>({snapshot:snapshot({includeSamples:false}),restPositions:Array.from(fixture.positions),indices:fixture.indices,restValues:fixture.restValues,weights:fixture.weights}),
    exportSample:index=>{if(!Number.isInteger(index)||index<0||index>=samples.length)throw Error('invalid retained sample index');return structuredClone(samples[index]);},
    exportEvidence:()=>({snapshot:snapshot(),restPositions:Array.from(fixture.positions),indices:fixture.indices,restValues:fixture.restValues,weights:fixture.weights})};
  document.querySelector('#status').textContent=`Live ${renderer.backend.constructor.name} · rotate selected hinge`;
  renderer.setAnimationLoop(()=>{
    if(replay){applyPose(cyclePose(replay.step/replay.steps));if(++replay.step>replay.steps){events.push({type:'cycle-end',cycleId:replay.id,startSampleIndex:replay.startSampleIndex,endSampleIndex:samples.length});replay=null;}}
    renderer.render(scene,camera);
  });
}catch(error){document.querySelector('#status').textContent=`Failed: ${error.message}`;window.kaminosSupportAssayFailure={message:error.message,stack:error.stack};throw error;}
