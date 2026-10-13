import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const params=new URLSearchParams(location.search),casePath=params.get('case'),expected=params.get('case_sha256');
const status=document.querySelector('#status'),container=document.querySelector('#viewport');
const events=[];let phase='case-authentication',manifest,renderer,views=[],frame=0,playback=null,whole=false,orbit;
const modes=['support-bound','automatic-transport','painted-reference'];
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
async function bytes(path,expectedHash,expectedBytes){
  const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error(`Asset ${path}: HTTP ${response.status}`);
  const buffer=await response.arrayBuffer();if(expectedBytes!==undefined&&buffer.byteLength!==expectedBytes)throw Error('Asset length mismatch: '+path);
  if(await sha(buffer)!==expectedHash)throw Error('Asset digest mismatch: '+path);return buffer;
}
function transform(point,matrix){return point.clone().applyMatrix4(new THREE.Matrix4().set(...matrix.flat()));}
function muscleShape(spec,matrix){
  const origin=new THREE.Vector3(...spec.origin),insertion=transform(new THREE.Vector3(...spec.insertion),matrix),axis=insertion.clone().sub(origin),length=axis.length();axis.normalize();
  const side=new THREE.Vector3().crossVectors(axis,new THREE.Vector3(1,0,0)).normalize(),normal=new THREE.Vector3().crossVectors(axis,side).normalize();
  const radius=spec.radius*Math.sqrt(new THREE.Vector3(...spec.insertion).distanceTo(origin)/length);
  return {center:origin.add(insertion).multiplyScalar(.5),scale:[length*.58,radius,radius*.85],basis:new THREE.Matrix4().makeBasis(axis,side,normal)};
}
function makeSupports(scene){
  const group=new THREE.Group();group.visible=false;scene.add(group);
  const material=new THREE.MeshStandardMaterial({color:0xc74648,roughness:.65});
  const fixed=manifest.supports.static.map(spec=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),material);mesh.position.fromArray(spec.center);mesh.scale.fromArray(spec.axes);group.add(mesh);return mesh;});
  const muscles=manifest.supports.muscles.map(()=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),material);group.add(mesh);return mesh;});
  const bones=manifest.supports.bones.map(spec=>{const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...spec.a),new THREE.Vector3(...spec.b)]),new THREE.LineBasicMaterial({color:0xf2e7cc,linewidth:2}));group.add(line);return line;});
  return {group,fixed,muscles,bones};
}
function updateSupports(supports,matrix){
  supports.muscles.forEach((mesh,i)=>{const shape=muscleShape(manifest.supports.muscles[i],matrix);mesh.position.copy(shape.center);mesh.scale.fromArray(shape.scale);mesh.quaternion.setFromRotationMatrix(shape.basis);});
  supports.bones.forEach((line,i)=>{const spec=manifest.supports.bones[i],a=new THREE.Vector3(...spec.a),b=new THREE.Vector3(...spec.b);if(spec.mobile){a.copy(transform(a,matrix));b.copy(transform(b,matrix));}line.geometry.setFromPoints([a,b]);});
}
function seek(index,origin='api'){
  if(!Number.isInteger(index)||index<0||index>=manifest.frames.length)throw Error('Invalid recorded frame');
  frame=index;const offset=frame*manifest.vertices*3,matrix=manifest.frames[frame].movingMatrix;
  views.forEach(view=>{view.geometry.attributes.position.array.set(view.frames.subarray(offset,offset+manifest.vertices*3));view.geometry.attributes.position.needsUpdate=true;view.geometry.computeVertexNormals();
    view.markers.forEach(({mesh,index})=>mesh.position.fromArray(view.frames,offset+index*3));updateSupports(view.supports,matrix);});
  document.querySelector('#frame').value=String(frame);
  events.push({type:'frame',frame,origin,at:performance.now()});
  const pose=manifest.frames[frame],metric=manifest.metrics[frame];
  status.textContent=`WebGPU replay · ${pose.kind} · flex ${pose.flexDegrees.toFixed(1)}° / twist ${pose.twistDegrees.toFixed(1)}°`;
    document.querySelector('#stats').textContent=`${manifest.vertices.toLocaleString()} original vertices per view · frame ${frame+1}/${manifest.frames.length} · ${manifest.sourceCast}\nCandidate field error: mean ${metric.fieldErrorMean.toExponential(2)}, 95th percentile ${metric.fieldErrorQ95.toExponential(2)} · edge ratio ${metric.edgeRatioMin.toFixed(2)}–${metric.edgeRatioMax.toFixed(2)}\nUnseeded surface vertices: ${manifest.domainRule?.unseededVertices?.length??0}; fixed as unknown. Magenta in the domain overlay.\nFrozen automatic binding; source folds and topology retained. Provisional support geometry has not been anatomically accepted.`;
}
function snapshot(){return {schema:'kaminos.hindquarter-binding-browser.v1',status:phase==='loaded'?'loaded':'loading',phase,requestedUrl:location.href,effectiveRoute:'dedicated-kaminos-independent-cast-replay',rendererBackend:renderer?.backend?.constructor?.name,
  casePath,expectedManifestSha256:expected,effectiveManifestSha256:expected,sourceSha256:manifest?.sourceSha256,sourceCast:manifest?.sourceCast,
  candidatePaintedWeights:manifest?.candidatePaintedWeights,vertices:manifest?.vertices,triangles:manifest?.triangles,frame,frames:manifest?.frames.length,
  modes:views.map(view=>({mode:view.mode,id:view.skin.uuid,vertices:view.geometry.attributes.position.count})),events:structuredClone(events),
  camera:{position:orbit?.object.position.toArray(),target:orbit?.target.toArray()},stateRule:manifest?.stateRule,domainRule:manifest?.domainRule??null,metrics:manifest?.metrics[frame]};}
try{
  if(!casePath||!/^scratch\/[a-z0-9_-]+$/.test(casePath)||!/^[0-9a-f]{64}$/.test(expected??''))throw Error('Explicit case path and SHA-256 are required');
  manifest=JSON.parse(new TextDecoder().decode(await bytes(`./${casePath}/manifest.json`,expected)));
  if(manifest.schema!=='kaminos.hindquarter-binding-assay.v1'||manifest.status!=='completed'||manifest.candidatePaintedWeights!==false)throw Error('Invalid or incomplete case');
  phase='asset-authentication';const names=['rest.bin','triangles.bin','candidate.bin','automatic.bin','reference.bin'];
  const buffers=await Promise.all(names.map(name=>bytes(`./${casePath}/${name}`,manifest.assets[name].sha256,manifest.assets[name].bytes)));
  const rest=new Float32Array(buffers[0]),indices=new Uint32Array(buffers[1]),arrays=buffers.slice(2).map(buffer=>new Float32Array(buffer));
  if(rest.length!==manifest.vertices*3||indices.length!==manifest.triangles*3||indices.some(i=>i>=manifest.vertices)||arrays.some(array=>array.length!==manifest.vertices*3*manifest.frames.length||array.some(v=>!Number.isFinite(v))))throw Error('Incomplete or invalid geometry');
  const domain=manifest.domainRule?new Float32Array(await bytes(`./${casePath}/domain.bin`,manifest.assets['domain.bin'].sha256,manifest.assets['domain.bin'].bytes)):null;
  if(domain&&(domain.length!==manifest.vertices||domain.some(value=>!Number.isFinite(value)||value<0||value>1)))throw Error('Invalid regional binding domain');
  if(!domain)document.querySelector('#domain').disabled=true;
  const camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.set(-2.7,.65,4.1);
  renderer=new THREE.WebGPURenderer({antialias:true});await renderer.init();container.appendChild(renderer.domElement);
  orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(.1,-.65,-.25);orbit.update();
  const markerIndices=[];const cells=new Set();
  for(let i=0;i<manifest.vertices;i++){const p=Array.from(rest.subarray(i*3,i*3+3));if(p[0]>.24||p[1]<-1.25||p[1]>.5||p[2]<-.9||p[2]>.7)continue;const cell=p.map(v=>Math.floor(v/.16)).join(',');if(!cells.has(cell)){cells.add(cell);markerIndices.push(i);}}
  const markerGeometry=new THREE.SphereGeometry(.008,6,4),markerMaterial=new THREE.MeshStandardMaterial({color:0xffffff});
  const colors=[0x71babb,0xd6b17c,0xbfc3ca];
  arrays.forEach((array,index)=>{
    const scene=new THREE.Scene();scene.background=new THREE.Color('#101722');scene.add(new THREE.HemisphereLight(0xe5edff,0x243951,2));
    const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-3,4,5);scene.add(light);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(rest,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));
    if(domain){const colors=[],unknown=new Set(manifest.domainRule?.unseededVertices??[]);for(let i=0;i<domain.length;i++){const color=unknown.has(i)?new THREE.Color(0xe057bf):new THREE.Color(0x546173).lerp(new THREE.Color(0xf2d05c),domain[i]);colors.push(color.r,color.g,color.b);}geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));}
    const material=new THREE.MeshStandardMaterial({color:colors[index],roughness:.72,side:THREE.DoubleSide});const skin=new THREE.Mesh(geometry,material);scene.add(skin);
    const markers=markerIndices.map(vertex=>{const mesh=new THREE.Mesh(markerGeometry,markerMaterial);scene.add(mesh);return {mesh,index:vertex};});
    views.push({scene,geometry,skin,material,frames:array,mode:modes[index],markers,supports:makeSupports(scene)});
  });
  const resize=()=>{renderer.setSize(container.clientWidth,container.clientHeight);camera.aspect=container.clientWidth/3/container.clientHeight;camera.updateProjectionMatrix();};addEventListener('resize',resize);resize();
  function play(start,end){playback={id:crypto.randomUUID(),start,end,index:start,nextTime:0};events.push({type:'play-start',id:playback.id,start,end});}
  document.querySelector('#play').onclick=()=>play(0,manifest.frames.length-1);
  for(const [name,start,end]of[['flex',0,12],['twist',13,25],['combined',26,38]])document.querySelector('#'+name).onclick=()=>play(start,end);
  document.querySelector('#rest').onclick=()=>{playback=null;seek(0,'rest-button');};
  document.querySelector('#frame').oninput=event=>{playback=null;seek(Number(event.target.value),'frame-input');};
  document.querySelector('#supports').onchange=event=>views.forEach(view=>{view.supports.group.visible=event.target.checked;view.material.transparent=event.target.checked;view.material.opacity=event.target.checked?.35:1;view.material.depthWrite=!event.target.checked;view.material.needsUpdate=true;});
  document.querySelector('#markers').onchange=event=>views.forEach(view=>view.markers.forEach(({mesh})=>mesh.visible=event.target.checked));
  document.querySelector('#domain').onchange=event=>views.forEach((view,i)=>{view.material.vertexColors=event.target.checked;view.material.color.set(event.target.checked?0xffffff:colors[i]);view.material.needsUpdate=true;});
  document.querySelector('#whole').onclick=()=>{whole=!whole;camera.position.set(...(whole?[-4,2,6]:[-2.7,.65,4.1]));orbit.target.set(...(whole?[.15,-.65,-1.0]:[.1,-.65,-.25]));orbit.update();};
  phase='loaded';seek(0,'load');window.kaminosHindquarterAssay={snapshot,seek,play};
  renderer.setAnimationLoop(time=>{if(playback&&time>=playback.nextTime){seek(playback.index,'playback');if(playback.index===playback.end){events.push({type:'play-end',id:playback.id,start:playback.start,end:playback.end});playback=null;}else{playback.index++;playback.nextTime=time+140;}}
    const width=container.clientWidth,height=container.clientHeight;renderer.setScissorTest(true);views.forEach((view,index)=>{renderer.setViewport(index*width/3,0,width/3,height);renderer.setScissor(index*width/3,0,width/3,height);renderer.render(view.scene,camera);});});
}catch(error){const failurePhase=phase;phase='failed';status.textContent=`Failed at ${failurePhase}: ${error.message}`;window.kaminosHindquarterAssayFailure={phase,failurePhase,message:error.message,stack:error.stack};throw error;}
