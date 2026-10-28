import * as THREE from '../../lib/three.core.js';
import {loadFullBodySources,loadFullBodySkin} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {createGpuSkinDeformer} from './gpu-skin-deformer.mjs';
import {createGivenPaletteMotion} from './given-palette-motion.mjs';
import {createCreatureArticulation} from './articulation.mjs';
import {boneWorldPose,checkedBoneWorldPose,applyBoneWorldPose} from './posed-bone-transform.mjs';

export async function createPosedSkeleton({host,inputs,record=()=>{}},{loadSources=(inputs)=>inputs.rest_only===true?loadFullBodySkin(inputs):loadFullBodySources(inputs)}={}){
 const document=host.controls.document,win=document.defaultView,edits=win.kaminosSceneEdits;if(!edits||!host.controls.components)throw Error('Native scene component editing is required');
 const data=await loadSources(inputs),session=await host.scene.open();
 const root=new THREE.Group();root.name=inputs.label??'Creature · pose skeleton';
 const proxy=new THREE.Object3D(),target='@posed-bone:'+root.uuid,whole='@posed-rig:'+root.uuid;
 let runtime,asset,floorAsset,floor,seat,controls,unsubscribe,disposed=false,editing=false,selected=inputs.joint??'forelimb-left-shoulder',refresh=()=>{},model;
 const markers=new Map(),base={kind:'rest',frame:0};let restoreGround=()=>{};
 function active(){if(disposed||!root.parent)throw Error('Posed creature is no longer mounted');}
 function putProxy(){if(!runtime)return;const p=boneWorldPose(runtime.bones.get(selected));proxy.position.fromArray(p.position);proxy.rotation.set(...p.rotation);proxy.scale.fromArray(p.scale);proxy.updateMatrixWorld(true);}
 function update(){
  runtime.update();runtime.group.updateMatrixWorld(true);
  for(const [name,marker]of markers){marker.material.color.set(name===selected&&editing?0xffbe46:0x37d7eb);marker.visible=editing;}
  if(!edits.state().active)putProxy();session.redraw();refresh();
 }
 try{
  runtime=createFullBodyRuntime({THREE,...data,deformerFactory:createGpuSkinDeformer,rotationSigns:inputs.rotation_signs??'tree-coherent'});root.add(runtime.group);
  if(!runtime.bones.has(selected))selected=[...runtime.bones.keys()][0];
  for(const [name,bone]of runtime.bones)markers.set(name,bone.children.find(c=>c.userData.kaminosHelperKind==='bones'));
  model=createCreatureArticulation({THREE,group:runtime.group,bones:runtime.bones,caseSha256:data.source.caseSha256,update});
  const motion=data.motion?createGivenPaletteMotion({THREE,motion:data.motion,rigFrame:data.frame}):null;
  const points=new Float32Array((runtime.bones.size-1)*6),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(points,3));
  const lines=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x43d8e9,depthTest:false,transparent:true,opacity:.8}));lines.renderOrder=99;Object.assign(lines.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true});runtime.group.add(lines);
  const drawLines=()=>{let i=0;const inv=runtime.group.matrixWorld.clone().invert();for(const bone of runtime.bones.values()){if(!bone.parent?.isBone)continue;for(const node of [bone.parent,bone]){points.set(node.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).toArray(),i);i+=3;}}geometry.attributes.position.needsUpdate=true;geometry.computeBoundingSphere();lines.visible=editing;};
  floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0x808080,roughness:.8}));floor.rotation.x=-Math.PI/2;let minimumY=Infinity;for(let i=1;i<data.rest.length;i+=3)minimumY=Math.min(minimumY,data.rest[i]);floor.position.y=minimumY-.04;floor.receiveShadow=true;floor.name='Pose reference floor';
  const ground=document.getElementById('composition-ground-visible');if(ground){const previous=ground.checked;ground.checked=false;ground.dispatchEvent(new Event('change'));restoreGround=()=>{if(!ground.checked){ground.checked=previous;ground.dispatchEvent(new Event('change'));}};}
  asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:inputs.case}});root.parent.add(proxy);floorAsset=await session.attach(floor,{owned:true,metadata:{label:floor.name,type:'experiment',source:'pose-reference-floor'}});
  const read=()=>({objectId:asset.id,status:editing?'posing-joints':'object',joint:selected,source:structuredClone(data.source),base:{...base},joints:[...runtime.bones].map(([name,b])=>({name,parent:b.parent?.isBone?b.parent.name:null,world:boneWorldPose(b)})),deformation:runtime.read().deformation,view:session.readView(),pose:model.snapshot()});
  function changed(){runtime.group.updateMatrixWorld(true);drawLines();update();}
  const applySaved=value=>{model.restore(value);changed();};
  edits.register(whole,{read:()=>model.snapshot(),check:value=>{return model.check(value);},write:applySaved});
  edits.register(target,{read:()=>({joint:selected,poseBase:model.read().base,...boneWorldPose(runtime.bones.get(selected))}),check:value=>{if(!runtime.bones.has(value.joint))throw Error('Unknown posed Bone');if(typeof value.poseBase!=='string')throw Error('Pose context required');return {joint:value.joint,poseBase:value.poseBase,...checkedBoneWorldPose(runtime.bones.get(value.joint),value).pose};},write:value=>{
   selected=value.joint;base.kind='authored';applyBoneWorldPose(runtime.bones.get(selected),value);model.captureBase(value.poseBase);changed();record({kind:'skeleton.pose',phase:'preview',target:asset.id,effective:{joint:selected,world:boneWorldPose(runtime.bones.get(selected))}});
  }});
  seat=host.controls.components.register(asset.id,{
   enter(){editing=true;changed();},exit(){editing=false;changed();},
   target(){if(!edits.state().active)putProxy();const p=boneWorldPose(runtime.bones.get(selected));return {id:target,type:'posed-joint',label:selected.replaceAll('-',' '),object:proxy,read:()=>({joint:selected,...p}),localOrientation:p.rotation,frameObjects:[markers.get(selected)]};},
   pick(event,{camera,canvas}){
    const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);
    const hit=ray.intersectObjects([...markers.values()],false)[0];if(hit){const name=[...markers].find(([,m])=>m===hit.object)[0];seat.changed(()=>{selected=name;changed();});}
   },
  });
  unsubscribe=edits.subscribe(()=>{if(!disposed){drawLines();putProxy();refresh();}});
  const operations={
   select({joint}){active();if(!runtime.bones.has(joint))throw Error('Unknown joint');seat.changed(()=>{selected=joint;changed();});return read();},
   // Agent comparison operations use the same live Bones; viewport transforms remain native.
   rotate({joint=selected,degrees}){active();model.rotate(joint,degrees);selected=joint;changed();return read();},
   axis({joint=selected,axis,degrees}){if(!Array.isArray(axis)||axis.length!==3||!axis.every(Number.isFinite)||!Number.isFinite(degrees)||Math.hypot(...axis)<1e-8)throw Error('Explicit rotation axis and angle required');const e=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(),degrees*Math.PI/180));return operations.rotate({joint,degrees:[e.x,e.y,e.z].map(v=>v*180/Math.PI)});},
   base({kind,frame=20}){active();if(kind==='motion'&&!motion)throw Error('No retained motion supplied for this binding');const before=model.snapshot();let pose;if(kind==='rest'){model.neutral();base.kind='rest';}else if(kind==='motion'){const p=motion.frame(frame);pose={actor:p.actorMatrix,bones:p.bones.map(b=>({name:b.name,matrix:b.localMatrix}))};model.setBase(pose,'Animation frame '+(frame+1));base.kind='motion';base.frame=frame;}else throw Error('Unknown pose base');const after=model.snapshot();model.restore(before);edits.apply(whole,after,'Set creature pose');changed();return read();},
   reset(){active();const before=model.snapshot();model.neutral();const after=model.snapshot();model.restore(before);edits.apply(whole,after,'Reset creature pose');return read();},
   resetJoint(){active();const before=model.snapshot(),rest=data.manifest.bones.find(b=>b.name===selected),parent=rest.parent&&data.manifest.bones.find(b=>b.name===rest.parent),m=new THREE.Matrix4().set(...rest.restMatrix.flat());if(parent)m.premultiply(new THREE.Matrix4().set(...parent.restMatrix.flat()).invert());const b=runtime.bones.get(selected);m.decompose(b.position,b.quaternion,b.scale);model.captureBase('Authored pose');const after=model.snapshot();model.restore(before);edits.apply(whole,after,'Reset joint pose');return read();},
   restore(value){active();edits.apply(whole,value,'Open creature pose');return read();},snapshot(){active();return {...model.snapshot(),view:session.readView(),joint:selected};},
   inspect(){active();changed();return {...read(),vertices:Array.from(runtime.syncCpuGeometry().attributes.position.array),boneWorld:[...runtime.bones].map(([name,b])=>({name,matrix:b.matrixWorld.toArray()})),rootMatrix:runtime.group.matrixWorld.toArray()};},
   async gpu(){active();const r=await runtime.readGpuGeometry();return {...read(),vertices:Array.from(r.positions),normals:Array.from(r.normals)};},
   frame(){active();const box=runtime.syncCpuGeometry().boundingBox.clone().applyMatrix4(runtime.group.matrixWorld),c=box.getCenter(new THREE.Vector3()),d=box.getSize(new THREE.Vector3()).length();session.setView({position:c.clone().add(new THREE.Vector3(d*1.5,d*.45,d*.8)).toArray(),target:c.toArray()});return read();},
  };
  changed();if(inputs.pose)operations.restore(inputs.pose);if(inputs.view)session.setView(inputs.view);else operations.frame();win.kaminosSelection.set([asset.id],asset.id);
  return {read,operations,mount({root:panel,document,invoke}){
   panel.textContent='Select the creature. Tab edits its pose; click a cyan joint, then use the viewport rotate or move tool. F frames the selected joint.';
   const properties=document.createElement('section'),heading=document.createElement('h3'),status=document.createElement('p');heading.textContent='Skeleton pose';properties.style.cssText='font:12px system-ui;line-height:1.5';properties.append(heading,status);
   const error=document.createElement('p');error.setAttribute('role','alert');
   const button=(text,work)=>{const b=document.createElement('button');b.type='button';b.style.cssText='padding:7px 9px;margin:3px 5px 3px 0;background:#303b41;color:#d9e2e5;border:1px solid #56666d;border-radius:4px;cursor:pointer';b.textContent=text;b.onclick=()=>Promise.resolve().then(work).catch(e=>error.textContent=e.message);properties.append(b);};
   button('Reset joint',()=>invoke('resetJoint'));button('Rest pose',()=>invoke('reset'));if(motion)button('Held motion pose',()=>invoke('base',{kind:'motion',frame:20}));
   button('Save pose…',async()=>{const value=await invoke('snapshot'),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='creature-pose.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
   const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.setAttribute('aria-label','Open creature pose');file.onchange=async()=>{try{if(file.files?.[0])await invoke('restore',JSON.parse(await file.files[0].text()));}catch(e){error.textContent=e.message;}finally{file.value='';}};button('Open pose…',()=>file.click());properties.append(file,error);
   refresh=()=>{status.textContent=editing?selected.replaceAll('-',' ')+' · native Move / Rotate · Undo / Redo':'Tab enters Pose Mode. Pose edits preserve the binding and rest skeleton.';};controls=host.controls.mountObject({asset,properties});refresh();
  },async dispose(){if(disposed)return;seat?.dispose();unsubscribe?.();edits.discard(e=>[target,whole,asset.id,floorAsset?.id].includes(e.id));edits.unregister(target);edits.unregister(whole);controls?.dispose();proxy.removeFromParent();restoreGround();disposed=true;await session.dispose();runtime.dispose();floor.geometry.dispose();floor.material.dispose();}};
 }catch(error){seat?.dispose();unsubscribe?.();edits.discard(e=>[target,whole,asset?.id].includes(e.id));edits.unregister(target);edits.unregister(whole);proxy.removeFromParent();restoreGround();disposed=true;await session.dispose();runtime?.dispose();floor?.geometry.dispose();floor?.material.dispose();throw error;}
}
export default {id:'marionette/posed-skeleton',title:'Creature · pose skeleton',create:createPosedSkeleton};
