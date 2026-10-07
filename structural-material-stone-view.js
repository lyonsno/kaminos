import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createElement, Pause, Play, RotateCcw, Hand } from 'lucide';
import { createNativeGpuRenderer } from './dist/structural-material-arch-gpu-engine.js';
import { createGpuStructuralFixture } from './structural-material-arch-gpu.js';
import { buildGpuStoneFixture, preparedContactNormal } from './structural-material-stone-fixture.js';
import { loadStoneAssets } from './structural-material-arch-stones.js';

export const STONE_ROUTE='kaminos.structural-material.imported-stone-thickness.webgpu.v0';
const params=new URLSearchParams(location.search),errorNode=document.querySelector('#error');
let phase='loading',failure=null,identity=null,prepared=null,preparedSha256=null,models=[],meshes=[[],[]],grab=null,contactPointer=null,paired=false,pairBaselines=[],lastPick=null,busy=false,mode='shear',paused=params.get('smoke')==='1',operations=Promise.resolve();
const failures=[],offsets=[new THREE.Vector3(-1.6,0,0),new THREE.Vector3(1.6,0,0)],vec=p=>new THREE.Vector3(p.x,p.y,p.z);
function fail(operation,error){failure={operation,message:error.message??String(error),stack:error.stack};failures.push(failure);paused=true;phase='failed';errorNode.textContent=failure.message;console.error(error);}
const serial=(name,fn)=>{const work=operations.then(async()=>{busy=true;try{return await fn();}catch(error){fail(name,error);throw error;}finally{busy=false;}});operations=work.catch(()=>{});return work;};
try {
  const canvas=document.createElement('canvas');document.querySelector('#viewport').append(canvas);
  const native=await createNativeGpuRenderer(canvas),{renderer,device}=native;identity=native.identity;
  device.addEventListener('uncapturederror',event=>fail('GPU validation',event.error));device.lost.then(info=>{if(info.reason!=='destroyed')fail('GPU loss',new Error(info.message));});
  document.querySelector('#device').textContent=`WebGPU AVBD · ${identity.architecture||identity.vendor}`;
  renderer.setPixelRatio(devicePixelRatio);renderer.setSize(innerWidth,innerHeight);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#101717');
  const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.03,100);camera.position.set(4,3.3,8);
  function projection(){camera.aspect=innerWidth/innerHeight;camera.fov=2*Math.atan(Math.tan(38*Math.PI/360)*Math.max(1,(1280/900)/camera.aspect))*180/Math.PI;camera.updateProjectionMatrix();}projection();
  const controls=new OrbitControls(camera,canvas);controls.target.set(0,-.1,0);controls.update();
  scene.add(new THREE.HemisphereLight(0xe1f7ea,0x263334,2));const light=new THREE.DirectionalLight(0xffedcf,3);light.position.set(-4,8,5);scene.add(light);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(22,16),new THREE.MeshStandardMaterial({color:0x33393b,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.503;scene.add(floor);
  const capMaterial=new THREE.MeshStandardMaterial({color:0xc95e43,roughness:1});
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.045,16,12),new THREE.MeshBasicMaterial({color:0xff8759,depthTest:false}));marker.visible=false;marker.renderOrder=10;scene.add(marker);
  const assets=await loadStoneAssets('500-normal');
  const response=await fetch('./artifacts/imported-stone-thickness/prepared.json');if(!response.ok)throw new Error(`Prepared stone HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();preparedSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');prepared=JSON.parse(new TextDecoder().decode(bytes));
  if(prepared.status!=='passed'||prepared.specimens.length!==2||prepared.sourceSha256!==assets[0].sha256)throw new Error('Prepared source absent or substituted');
  const tipContacts=prepared.specimens.map(s=>{
    const candidates=[];for(const cell of s.cells)if(cell.column===s.grid[0]-1){const g=cell.geometry;for(let t=0;t<g.exterior.length;t++)if(g.exterior[t]){
      const point=new THREE.Vector3();for(const i of g.indices.slice(t*3,t*3+3))point.add(new THREE.Vector3(...g.properties.slice(i*g.numProp,i*g.numProp+3)));point.multiplyScalar(1/3);
      candidates.push({index:cell.index,point,score:point.x-.15*(Math.abs(point.y)+Math.abs(point.z))});
    }}candidates.sort((a,b)=>b.score-a.score);if(!candidates.length)throw new Error('No actual tip surface');return candidates[0];
  });
  function geometry(cell){const g=cell.geometry,position=[],normal=[],uv=[],tangent=[];
    for(let t=0;t<g.exterior.length;t++){
      const vertices=g.indices.slice(t*3,t*3+3).map(i=>g.properties.slice(i*g.numProp,(i+1)*g.numProp));
      const a=new THREE.Vector3(...vertices[0]),b=new THREE.Vector3(...vertices[1]),c=new THREE.Vector3(...vertices[2]),n=b.sub(a).cross(c.sub(a)).normalize();
      for(const p of vertices){position.push(...p.slice(0,3).map((v,a)=>v-cell.position[a]));normal.push(...(g.exterior[t]?p.slice(3,6):n.toArray()));uv.push(...p.slice(6,8));tangent.push(...p.slice(8,12));}
    }
    const result=new THREE.BufferGeometry();for(const [name,values,size] of [['position',position,3],['normal',normal,3],['uv',uv,2],['tangent',tangent,4]])result.setAttribute(name,new THREE.Float32BufferAttribute(values,size));return result;
  }
  const skinGeometries=prepared.specimens.map(s=>s.cells.map(geometry));
  for(let specimen=0;specimen<2;specimen++){
    const clamp=new THREE.Mesh(new THREE.BoxGeometry(.32,1.15,.84),new THREE.MeshStandardMaterial({color:specimen?0xb08845:0x467f83,roughness:.8}));clamp.position.copy(offsets[specimen]).add(new THREE.Vector3(-1.04,-.57,0));scene.add(clamp);
  }
  function draw(){if(!models.length)return;const snapshots=models.map(m=>m.snapshot());
    for(let specimen=0;specimen<2;specimen++){
      const state=snapshots[specimen],s=prepared.specimens[specimen],alive=new Map(state.bonds.map(b=>[b.id,b.alive]));
      for(const body of state.bodies){const mesh=meshes[specimen][body.index];mesh.position.copy(body.position).add(offsets[specimen]);mesh.quaternion.copy(body.quaternion);
        const liveKey=state.connectivityEpoch;if(mesh.userData.epoch!==liveKey){const indices=[];mesh.geometry.clearGroups();let groupStart=0,material=-1;
          s.cells[body.index].geometry.exterior.forEach((exterior,t)=>{const id=s.cells[body.index].geometry.interfaces[t];if(!exterior&&alive.get(id)!==false)return;const next=exterior?0:1;if(material!==next){if(material>=0)mesh.geometry.addGroup(groupStart,indices.length-groupStart,material);groupStart=indices.length;material=next;}indices.push(t*3,t*3+1,t*3+2);});
          if(material>=0)mesh.geometry.addGroup(groupStart,indices.length-groupStart,material);mesh.geometry.setIndex(indices);mesh.userData.epoch=liveKey;
        }
      }
      const force=state.hand?Math.hypot(state.hand.force.x,state.hand.force.y,state.hand.force.z):0;
      document.querySelector(specimen?'#thick':'#thin').textContent=`${specimen?'Thick 0.60':'Thin 0.30'} · ${state.broken} broken · reaction ${force.toFixed(2)}`;
    }
    marker.visible=Boolean(grab);if(grab){const mesh=meshes[grab.specimen][grab.index];marker.position.copy(mesh.localToWorld(grab.local.clone()));}
    scene.updateMatrixWorld(true);renderer.render(scene,camera);
  }
  function release(){for(const model of models)model.release();grab=null;contactPointer=null;paired=false;controls.enabled=true;document.querySelector('#pull').value='0';draw();}
  const cohesion=()=>{const v=Number(document.querySelector('#strength').value);if(!(v>0)||!Number.isFinite(v))throw new Error('Cohesion must be positive and finite');return v;};
  async function reset(){const next=[];try{for(const s of prepared.specimens)next.push(await createGpuStructuralFixture(buildGpuStoneFixture(s,{strength:cohesion()}),renderer));}catch(error){for(const m of next)m.dispose();throw error;}
    for(const model of models)model.dispose();for(const group of meshes)for(const mesh of group)scene.remove(mesh);models=next;
    meshes=prepared.specimens.map((s,specimen)=>s.cells.map((c,index)=>{const mesh=new THREE.Mesh(skinGeometries[specimen][index],[assets[0].material,capMaterial]);mesh.userData={specimen,index,epoch:null};scene.add(mesh);return mesh;}));
    grab=null;contactPointer=null;paired=false;controls.enabled=true;failure=null;errorNode.textContent='';phase='interactive';draw();
  }
  function pairedPull(travel){if(!Number.isFinite(travel)||travel<0)throw new Error('Pull must be nonnegative and finite');
    if(mode!=='shear')throw new Error('Paired pull requires Shear mode');
    if(!paired){release();pairBaselines=models.map((m,i)=>{const contact=tipContacts[i],local=contact.point.clone().sub(new THREE.Vector3(...prepared.specimens[i].cells[contact.index].position)),body=m.snapshot().bodies[contact.index];
      const point=local.clone().applyQuaternion(new THREE.Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w)).add(vec(body.position));m.setSurfaceHand(contact.index,point,local,{x:1,y:0,z:0},'embedded-visual');return point;});paired=true;}
    models.forEach((m,i)=>{const target=pairBaselines[i].clone();target.y-=travel;m.moveHand(target);});const slider=document.querySelector('#pull');if(travel>Number(slider.max))slider.max=String(travel);slider.value=String(travel);
  }
  async function advance(count){if(!Number.isInteger(count)||count<0)throw new Error('Advance requires a nonnegative integer');for(let i=0;i<count;i++)for(let n=0;n<models.length;n++){if(grab?.specimen===n&&mode==='bind')models[n].bind(grab.index);await models[n].step();}draw();}
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  function ray(event){camera.updateMatrixWorld(true);const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0||phase!=='interactive')return;try{ray(event);const hit=raycaster.intersectObjects(meshes.flat(),false)[0];if(!hit)return;event.stopImmediatePropagation();event.preventDefault();release();contactPointer=event.pointerId;controls.enabled=false;canvas.setPointerCapture(event.pointerId);
    const {specimen,index}=hit.object.userData,m=models[specimen],cell=m.cells[index],point=hit.point.clone().sub(offsets[specimen]),local=m.worldToLocalPoint(index,point);
    const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],normal=preparedContactNormal(hit.face.normal.toArray(),directions.filter(n=>m.isExposedFace(index,{x:n[0],y:n[1],z:n[2]})));
    lastPick={specimen,index,world:hit.point.toArray(),local:local.toArray(),normal,surfaceNormal:hit.face.normal.toArray(),faceIndex:hit.faceIndex};
    if(cell.pinned||!normal)return;m.setSurfaceHand(index,point,local,{x:normal[0],y:normal[1],z:normal[2]},'embedded-visual');const direction=new THREE.Vector3();camera.getWorldDirection(direction);
    grab={specimen,index,local,pointerId:event.pointerId,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(direction,hit.point)};draw();
  }catch(error){fail('Grab',error);}},true);
  canvas.addEventListener('pointermove',event=>{if(!grab||event.pointerId!==grab.pointerId)return;try{const world=ray(event).intersectPlane(grab.plane,new THREE.Vector3());if(world)models[grab.specimen].moveHand(world.sub(offsets[grab.specimen]));event.stopImmediatePropagation();event.preventDefault();draw();}catch(error){fail('Drag',error);}},true);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(contactPointer===null||event.pointerId!==contactPointer)return;release();},true);
  for(const name of ['shear','bind'])document.querySelector(`#${name}`).onclick=()=>{release();mode=name;document.querySelector('#pull').disabled=mode==='bind';for(const n of ['shear','bind'])document.querySelector(`#${n}`).setAttribute('aria-pressed',String(n===name));};
  const icon=(id,definition)=>document.querySelector(id).replaceChildren(createElement(definition));
  const pauseIcon=()=>{icon('#pause',paused?Play:Pause);document.querySelector('#pause').title=document.querySelector('#pause').ariaLabel=paused?'Resume':'Pause';};pauseIcon();icon('#reset',RotateCcw);icon('#release',Hand);
  document.querySelector('#pause').onclick=()=>{paused=!paused;pauseIcon();};document.querySelector('#reset').onclick=()=>serial('Reset',reset).catch(()=>{});document.querySelector('#release').onclick=release;
  document.querySelector('#pull').oninput=event=>{try{pairedPull(Number(event.target.value));if(paused)serial('Paired pull',()=>advance(1)).catch(()=>{});}catch(error){fail('Paired pull',error);}};
  document.querySelector('#strength').onchange=()=>{try{const value=cohesion();for(const m of models)m.setStrength(value);}catch(error){fail('Cohesion',error);}};
  addEventListener('resize',()=>{projection();renderer.setSize(innerWidth,innerHeight);draw();});
  await reset();
  let last=performance.now(),carry=0;async function frame(now){requestAnimationFrame(frame);const elapsed=(now-last)/1000;last=now;if(phase!=='interactive'||paused||busy){carry=0;return;}carry+=elapsed;const dt=models[0].snapshot().config.timeStep;if(carry>=dt){carry-=dt;await serial('Live step',()=>advance(1)).catch(()=>{});}else draw();}requestAnimationFrame(frame);
  const cameraState=()=>({position:camera.position.toArray(),quaternion:camera.quaternion.toArray()});
  async function pixels(){draw();const texture=renderer.backend.context.getCurrentTexture(),width=canvas.width,height=canvas.height,bytesPerRow=Math.ceil(width*4/256)*256;
    const buffer=device.createBuffer({label:'Actual stone pixels',size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow,rowsPerImage:height},{width,height});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const data=new Uint8Array(buffer.getMappedRange());let bright=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*bytesPerRow+x*4;if((data[i]+data[i+1]+data[i+2])/3>110)bright++;}return{source:'actual-webgpu-presentation-texture',width,height,bright,total:width*height,fraction:bright/(width*height)};
    }finally{buffer.destroy();}}
  window.__stoneThickness={advance:n=>serial('Advance',()=>advance(n)),reset:()=>serial('Reset',reset),pull:pairedPull,release,
    setStrength:value=>{document.querySelector('#strength').value=String(value);const strength=cohesion();for(const m of models)m.setStrength(strength);},
    witness:()=>({route:STONE_ROUTE,phase,failure,failures:[...failures],identity,preparedSha256,sourceSha256:prepared.sourceSha256,camera:cameraState(),viewport:{width:innerWidth,height:innerHeight},paused,mode,paired,lastPick,
      specimens:models.map((m,i)=>({preparation:Object.fromEntries(['schema','sourceSha256','size','spacing','grid','volume','totalVolume'].map(key=>[key,prepared.specimens[i][key]])),state:m.snapshot(),rendererPoses:meshes[i].map(mesh=>({index:mesh.userData.index,position:mesh.position.toArray(),quaternion:mesh.quaternion.toArray()})),offset:offsets[i].toArray(),normalMapped:meshes[i].every(mesh=>mesh.material[0].normalMap?.isTexture),visibleCaps:meshes[i].reduce((n,mesh)=>n+mesh.geometry.groups.filter(g=>g.materialIndex===1).reduce((sum,g)=>sum+g.count/3,0),0)}))}),
    contacts:()=>models.map((m,i)=>{const contact=tipContacts[i],mesh=meshes[i][contact.index],local=contact.point.clone().sub(new THREE.Vector3(...prepared.specimens[i].cells[contact.index].position)),world=mesh.localToWorld(local),screen=world.clone().project(camera);return{index:contact.index,world:world.toArray(),screen:{x:(screen.x+1)*innerWidth/2,y:(1-screen.y)*innerHeight/2}};}),
    pixels,capture:async()=>{await operations;draw();await device.queue.onSubmittedWorkDone();return await new Promise(resolve=>canvas.toBlob(async blob=>resolve(Array.from(new Uint8Array(await blob.arrayBuffer()))),'image/png'));}
  };
  addEventListener('beforeunload',()=>{for(const m of models)m.dispose();renderer.dispose();device.destroy();});
}catch(error){fail('Startup',error);window.__stoneThickness={witness:()=>({route:STONE_ROUTE,phase,failure,failures:[...failures],identity})};}
