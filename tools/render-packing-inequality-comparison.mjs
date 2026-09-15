import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractMuscleCompartmentRingCageBoundary} from '../muscle-compartment-ring-cage-contact-core.mjs';
const [input,output,mode='intercept-diagnostic']=process.argv.slice(2);
if(!input||!output)throw new Error('usage: INPUT_DIR OUTPUT_DIR');
if(!['intercept-diagnostic','source-repair','trajectory'].includes(mode))throw new Error('unknown view mode');
await fs.mkdir(output,{recursive:true});
const documents={};
const names=mode==='trajectory'?['start.json','selected.json']:mode==='source-repair'?['start.json','baseline-state.json','candidate.json']:['start.json','baseline-state.json','candidate.json','gap-probe.json'];
for(const name of names) documents[name]=JSON.parse(await fs.readFile(path.join(input,name),'utf8'));
const selections=mode==='trajectory'
  ? [['start','Initialized authored start',documents['start.json']],['selected','After inequality steps',documents['selected.json']]]
  : [['start','Same late-stage start',documents['start.json']],['baseline','Old step',documents['baseline-state.json']],['candidate',mode==='source-repair'?'Inequality step · source gap repaired':'Inequality step · uncorrected gap',documents['candidate.json'].selected],...(mode==='intercept-diagnostic'?[['corrected','Intercept-only diagnostic',documents['gap-probe.json'].state]]:[])];
const states=selections.map(([id,label,s])=>{
  if(!s?.carrier?.cages?.length)throw new Error(`missing state ${id}`);
  return {id,label,metrics:s.metrics,carrierSha256:s.carrier.identity.sha256,cages:s.carrier.cages.map(c=>{
    const indices=new Map(c.manifest.nodes.map((node,i)=>[node.id,i]));
    return {id:c.constructionId,positions:c.manifest.nodes.map(n=>n.currentPosition),faces:extractMuscleCompartmentRingCageBoundary(c.manifest).faces.map(f=>f.nodeIds.map(id=>indices.get(id)))};
  })};
});
const sha=createHash('sha256').update(JSON.stringify(states)).digest('hex');
const route=mode==='intercept-diagnostic'?'experimental-packing-inequality-comparison-v0':`experimental-packing-${mode}-v0`;
const payload={route,sha,states};
const explanation=mode==='intercept-diagnostic'?'The fourth state changes one inconsistent bone-gap intercept in the optimizer input. The original nonlinear evaluator judges the result. This is a diagnostic, not a production repair.':mode==='source-repair'?'Both steps use the repaired source gap. The unchanged nonlinear admission checks judge each result.':'Original authored variant through the restoration-to-reference bridge, then repeated inequality steps. Fixed attachments and the original volume allowance remain in force. The objective reduces muscle overlap while preventing bone overlap from worsening; it does not optimize compactness.';
await fs.writeFile(path.join(output,'display-data.json'),JSON.stringify(payload,null,2)+'\n');
await fs.writeFile(path.join(output,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Packing step comparison</title>
<style>body{margin:0;background:#10151b;color:#eee;font:15px system-ui}aside{box-sizing:border-box;position:absolute;left:0;top:0;width:360px;padding:24px;height:100vh;overflow:auto}h1{font-size:23px}button{display:block;width:100%;text-align:left;margin:8px 0;padding:12px;background:#26303c;border:1px solid #526171;color:white;border-radius:6px;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#e6cf9b;color:#151515}main{position:absolute;left:360px;top:0;right:0;height:100vh}p{line-height:1.45}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#a7b2bf}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
<aside><h1>${mode==='trajectory'?'Authored-start contact trajectory':'Same-state packing step'}</h1><p>Identical camera and solid materials. Actual scale; no amplified displacement.</p><div id="buttons"></div><p id="selected"></p><pre id="metrics"></pre><p class="muted">${explanation}</p><p class="muted">Residuals describe the existing tetrahedral contact model, not anatomical admission. Raw volume error is shown separately from admitted error. Bone and overlap volumes are not drawn.</p><pre id="identity"></pre><p>Drag to orbit · scroll to zoom.</p></aside><main></main>
<script type="module">
import * as THREE from 'three';import{OrbitControls}from'three/addons/controls/OrbitControls.js';
const p=${JSON.stringify(payload).replaceAll('<','\\u003c')};
document.documentElement.dataset.witnessCaptureBatch=p.sha;
const host=document.querySelector('main'),scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(host.clientWidth,host.clientHeight);host.append(renderer.domElement);renderer.setClearColor(0x10151b);renderer.outputColorSpace=THREE.SRGBColorSpace;
scene.add(new THREE.HemisphereLight(0xcfe5ff,0x302a24,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(70,100,130);scene.add(light);
const colors=[0xf48787,0xd4bd66,0x68cccf,0x9d86e3,0xeab08a,0x398bc2];const groups=p.states.map(s=>{const group=new THREE.Group();for(const[c,cage]of s.cages.entries()){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(cage.positions.flat(),3));geo.setIndex(cage.faces.flatMap(f=>{const triangles=[];for(let j=1;j<f.length-1;j++)triangles.push(f[0],f[j],f[j+1]);return triangles;}));geo.computeVertexNormals();group.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:colors[c],side:THREE.DoubleSide,roughness:.65,metalness:0,flatShading:true})));}scene.add(group);return group;});
const box=new THREE.Box3().setFromObject(groups[0]),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());const camera=new THREE.PerspectiveCamera(35,host.clientWidth/host.clientHeight,.01,10000);const distance=Math.max(size.y,size.x/camera.aspect)/2/Math.tan(35*Math.PI/360)*1.2;camera.position.copy(center).add(new THREE.Vector3(.38,.14,1).normalize().multiplyScalar(distance));const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(center);controls.update();
let selected=null,frame=0;function choose(id){const i=p.states.findIndex(s=>s.id===id);if(i<0)throw Error('unknown requested state');selected=p.states[i];groups.forEach((g,j)=>g.visible=j===i);document.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===id)));document.querySelector('#selected').textContent=selected.label;document.querySelector('#metrics').textContent=JSON.stringify(selected.metrics,null,2);document.querySelector('#identity').textContent=p.route+'\\nbundle '+p.sha+'\\ncarrier '+selected.carrierSha256;const d=document.documentElement.dataset;d.witnessState=id;d.witnessBundle=p.sha;d.witnessCarrier=selected.carrierSha256;d.witnessRoute=p.route;d.witnessRenderComplete='false';frame=0;}
for(const s of p.states){const b=document.createElement('button');b.textContent=s.label;b.dataset.id=s.id;b.onclick=()=>choose(s.id);document.querySelector('#buttons').append(b);}choose(new URLSearchParams(location.search).get('state')||'start');
function render(){controls.update();renderer.render(scene,camera);const d=document.documentElement.dataset;d.witnessRenderFrame=String(++frame);d.witnessRenderComplete=String(frame>=3);requestAnimationFrame(render);}render();
addEventListener('resize',()=>{camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);});
</script></html>`);
console.log(JSON.stringify({output,route:payload.route,bundleSha256:sha,states:states.map(s=>({id:s.id,carrier:s.carrierSha256}))}));
