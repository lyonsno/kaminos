import {copyMechanism,mechanismIdentity} from './link-workshop/recipe-state.mjs';
import {hingeFamilies,hingeMountFrames,checkedHardware,exportHinge,importHinge} from './link-workshop/hinge-primitives.mjs';
import {seatingFrame,adjustSeating} from './link-workshop/seating.mjs';
import {createConnectView} from './link-workshop/connect-view.mjs';
import {capturePlacements,restorePlacements} from './link-workshop/placements.mjs';
import * as T from '../lib/three.core.js';
import {emptyMechanism,checkedMechanism,appendJoint,moveJoint,connectPiston,evaluate,frames,removeBranch} from './link-workshop/model.mjs';
import {remapBodyGeometry} from './link-workshop/bodies.mjs';
import {mechanismHistory} from './link-workshop/history.mjs';
import {MECHANISM_SOURCE} from './link-workshop/record.mjs';
import {attachmentFrame,createAttachmentFollower} from './link-workshop/attachments.mjs';
import {mountMatrix,mountOwnerMatrix,attachmentBase,frameMatrix,matrixFrame,identityFrame,checkConnections,hingeWorldFrame,previewMountMatrix} from './link-workshop/mounts.mjs';
import {createFasteningView,seatingWorlds} from './link-workshop/fastening-view.mjs';
import {createMountView} from './link-workshop/mount-view.mjs';
import {createMechanismView} from './link-workshop/view.mjs';
import {connectionGuide,createConstructionGuide} from './link-workshop/affordance.mjs';
import {createMirrorTool} from './link-workshop/mirror-tool.mjs';
import {motionSpace,motionSpaceMesh} from './link-workshop/envelope.mjs';

export async function createMechanismController({host,inputs={},record=()=>{}}){
 const document=host.controls.document,win=document.defaultView,edits=win.kaminosSceneEdits;
 if(!edits||!host.controls.components)throw Error('Native component editing is required');
 if(inputs.mode!==undefined&&!['build','A','B'].includes(inputs.mode))throw Error('Unknown initial mode');
 const session=await host.scene.open(),root=inputs.root??new T.Group(),proxy=new T.Object3D();root.name='Link workshop';
 let model=checkedMechanism(inputs.root?.userData.linkMechanism??inputs.recipe??emptyMechanism()),selected=model.nodes.length-1,mode=inputs.mode??'build',tool='select',editing=false,playing=false,time=0,cycle=mode==='B'?.5:0,t=mode==='B'?1:0,disposed=false,refresh=()=>{},seat,controls;
 let placementIds=[],pendingGeometry,previewIdentity=null,connectionDraft=null,connectionIdentity=null,connectionPast=[],connectionFuture=[],connectionHistory;
 const connectView=createConnectView(root,document);
 let frameIdentity;
 const sceneIdentity=()=>mechanismIdentity(objects().map(e=>{e.object.updateWorldMatrix(true,false);return [e.id,e.type,e.label,e.object.matrixWorld.elements,e.object.userData.linkMechanism,e.object.userData.mechanismFraction];}));
 const seatingIdentity=()=>mechanismIdentity([model,t,objects().map(e=>{e.object.updateWorldMatrix(true,false);return [e.id,e.object.matrixWorld.elements,e.object.userData.linkMechanism,e.object.userData.mechanismFraction];})]);
 let target,whole,geometryTarget,mountTarget,seatingTarget,axleTarget,editingAxle=false,editingConnection=null,selectedConnection=null,seatingPreview=null,showOverlays=true,selectedMount=null,selectedPiston=null,connectionStart=null,showTravel=false,mountStatus={errors:[],lengths:[]};
 const grid=new T.GridHelper(30,60,0x637d88,0x344851);grid.rotation.x=Math.PI/2;grid.position.z=-.28;grid.material.transparent=true;grid.material.opacity=.35;grid.raycast=()=>{};const editorGeometry=new T.Group();editorGeometry.userData.kaminosEditorOnly=true;editorGeometry.userData.mechanismOverlay=true;root.add(editorGeometry);editorGeometry.add(grid);
 const origin=new T.Mesh(new T.SphereGeometry(.1,12,8),new T.MeshBasicMaterial({color:0x59dee2}));editorGeometry.add(origin);
 root.userData.linkMechanism=model;
 const visual=new T.Group();visual.userData.mechanismVisual=true;root.add(visual);const fasteningView=createFasteningView(root,document),mountView=createMountView(root),view=createMechanismView(visual),asset=await session.attach(root,{owned:!inputs.root,metadata:{label:root.name,type:'pbr',source:MECHANISM_SOURCE,mechanism:model}});root.parent.add(proxy);
 const initialBodies=inputs.bodies??inputs.root?.userData.linkGeometry;
 try{view.update(model,t,selected,false);if(initialBodies?.bodies?.length){view.importBodies(initialBodies);root.userData.linkGeometry=view.replacementState();}}catch(error){proxy.removeFromParent();view.dispose();mountView.dispose();fasteningView.dispose();connectView.dispose();await session.dispose();throw error;}
 const constructionGuide=createConstructionGuide(root);
 let hoverJoint=null,hoverPoint=null,hoverShift=false,modeNotice=null,guide=null,mirror=null,geometryRevision=0;
 const relatedAssets=[];
 const objects=host.scene.objects?()=>host.scene.objects():()=>[{id:asset.id,object:root}],history=mechanismHistory(edits,asset.id,objects),follower=createAttachmentFollower(root,objects);let removeKeys=()=>{};
 let pistonStart=null,snap=true,status,fields=[],stop=()=>{},unsubscribe=()=>{};
 const ensure=()=>{if(disposed||!root.parent)throw Error('Workshop removed; Undo or reopen it');};
 const hasMotion=()=>model.nodes.some(n=>n.parent!==null)||(model.attachments??[]).some(a=>Array.isArray(a.hinge));
 const guideRead=()=>guide?{objectId:guide.asset.id,cells:guide.packet.cells.length,method:guide.packet.method,currentRecipe:JSON.stringify(model)===JSON.stringify(guide.packet.recipe),currentGeometry:guide.geometryRevision===geometryRevision,sourceTransform:guide.sourceTransform,placement:guide.mesh.matrixWorld.toArray()}:null;
 function guidance(){return connectionGuide({model,editing,playing,mode,tool,start:pistonStart,hover:hoverJoint});}
 const read=()=>({mirror:mirror?.state(),constructionGuide:guidance(),motionSpace:guideRead(),objectId:asset.id,recipe:structuredClone(model),bodies:view.bodyManifest(),mode,tool,selected,editing,playing,cycle,fraction:t,points:evaluate(model,t),pistonStart,selectedMount,selectedPiston,connectionStart,selectedConnection,editingConnection,editingAxle,seatingPreview,connectionDraft,showOverlays,mountStatus,view:session.readView(),motion:'authored joint kinematics; pistons follow attachment distance'});
 const emptyGeometry={schema:'kaminos.assembly-geometry.v1',bodies:[]};
 const currentGeometryRef=()=>history.rememberGeometry(root.userData.linkGeometry??emptyGeometry);
 let geometrySources=new Map(history.geometry(currentGeometryRef()).bodies.map(b=>[b.id,b.object]));
 function syncGeometry(){const g=view.replacementState();if(g?.bodies?.length)root.userData.linkGeometry=g;else delete root.userData.linkGeometry;geometrySources=new Map(history.geometry(currentGeometryRef()).bodies.map(b=>[b.id,b.object]));}
 function restoreGeometry(value){
  if(!value)return;const packet=history.geometry(typeof value==='string'?value:history.rememberGeometry(value)),live=view.bodyManifest().bodies,keys=new Map(live.map(b=>[b.id,b])),bodies=packet.bodies.filter(b=>keys.get(b.id)?.geometryKey===b.geometryKey),wanted=new Set(bodies.map(b=>b.id)),extra=live.some(b=>b.replacement&&!wanted.has(b.id)),missing=bodies.filter(b=>!keys.get(b.id)?.replacement||geometrySources.get(b.id)!==b.object);
  if(extra)view.clearReplacements(live.filter(b=>b.replacement&&!wanted.has(b.id)).map(b=>b.id));if(missing.length)view.importBodies({schema:packet.schema,bodies:missing});
  if(extra||missing.length)geometryRevision++;
  geometrySources=new Map(bodies.map(b=>[b.id,b.object]));
  if(bodies.length)root.userData.linkGeometry=history.geometry(history.rememberGeometry(bodies.length===packet.bodies.length?packet:{schema:packet.schema,bodies}));else delete root.userData.linkGeometry;
 }
 function updateGuides(){
  const g=guidance(),active=editing&&!playing,draw=active&&mode==='build'&&tool==='draw',markers=view.markers();
  let from=null,to=null,states=g.targets;
  if(g.active&&pistonStart!==null){from=markers[pistonStart]?.position.toArray();to=hoverJoint!==null?markers[hoverJoint]?.position.toArray():hoverPoint;}
  if(draw){states=markers.map((_,i)=>i===hoverJoint?'hover':i===selected?'start':'valid');if(hoverPoint&&hoverJoint===null&&!hoverShift&&selected>=0){from=markers[selected].position.toArray();to=hoverPoint;}}
  constructionGuide.update({active:g.active||draw,states,markers,from,to,valid:g.active?g.valid:true});
  if(modeNotice){modeNotice.hidden=!active;modeNotice.textContent=editingAxle?'AXLE · G moves pivot · R turns axis · S sizes hardware · Tab returns':editingConnection?`SEATING · ${mode==='build'?'Build':`Pose ${mode}`} · G slides · R turns about normal · Tab returns`:tool==='mirror'?'MIRROR SHAPES · Click a body · Shift-click adds/removes · Place mirror plane, then copy · Esc exits':tool==='connect'?'CONNECT · Pick two surfaces or joints · Esc cancels':g.active?g.message:draw?(hoverJoint!==null?`DRAW LINKS · Click joint ${hoverJoint+1} to branch from it`:hoverShift||selected<0?'DRAW LINKS · Click to place a fixed anchor · Esc exits':`DRAW LINKS · Click to extend joint ${selected+1} · Shift: new anchor · Esc exits`):`SELECT / MOVE · ${mode==='build'?'Build':`Pose ${mode}`} · G / R / S · Tab leaves joint editing`;}
 }
 function pointerAt(event,{camera,canvas}){
  if(!event)return {joint:null,point:null};
  const r=canvas.getBoundingClientRect();root.updateWorldMatrix(true,true);camera.updateMatrixWorld();
  let joint=null,best=Infinity;
  for(const marker of view.markers()){const world=marker.getWorldPosition(new T.Vector3()),p=world.clone().project(camera);if(p.z<0||p.z>1)continue;const x=r.left+(p.x+1)*r.width/2,y=r.top+(1-p.y)*r.height/2,d=Math.hypot(x-event.clientX,y-event.clientY);const edge=marker.localToWorld(new T.Vector3(1.5,0,0)).project(camera),radius=Math.max(12,Math.abs(edge.x-p.x)*r.width/2);if(d<=radius&&d<best){joint=marker.userData.joint;best=d;}}
  const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);
  const plane=new T.Plane(new T.Vector3(0,0,1),0).applyMatrix4(root.matrixWorld),p=ray.ray.intersectPlane(plane,new T.Vector3());
  if(p)p.applyMatrix4(root.matrixWorld.clone().invert());
  return {joint,point:p?[snap?Math.round(p.x*4)/4:p.x,snap?Math.round(p.y*4)/4:p.y,.85]:null};
 }
 function cancelConstruction(){if(edits.state().active)return false;if(mode!=='build'||tool==='select')return false;if(pistonStart!==null)pistonStart=null;else{if(connectionDraft)clearConnection();tool='select';mirror?.clear();}hoverJoint=null;hoverPoint=null;updateGuides();refresh();session.redraw();return true;}
 const activeSeatingId=()=>editingConnection??(selectedConnection&&(mode==='A'||mode==='B')&&Array.isArray(model.attachments?.find(a=>a.objectId===selectedConnection)?.hinge)?selectedConnection:null);
 function putProxy(){if(editingAxle){const a=model.attachments.find(a=>a.objectId===editingConnection);if(a)hingeWorldFrame(root,model,a,0,objects()).decompose(proxy.position,proxy.quaternion,proxy.scale);if(a)proxy.scale.setScalar(a.hardware?.size??1);return;}const seatingId=activeSeatingId();if(seatingId){try{seatingFrame(root,model,seatingId,t,objects()).decompose(proxy.position,proxy.quaternion,proxy.scale);proxy.updateMatrixWorld(true);}catch{}return;}if(selectedMount){let matrix;try{matrix=mountMatrix(root,model,selectedMount,t,objects());}catch{return;}matrix.decompose(proxy.position,proxy.quaternion,proxy.scale);proxy.updateMatrixWorld(true);return;}if(selected<0||!model.nodes[selected])return;root.updateWorldMatrix(true,false);const f=frames(model,t)[selected],p=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld);proxy.position.copy(p);proxy.quaternion.copy(root.getWorldQuaternion(new T.Quaternion())).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),f.angle));proxy.scale.set(model.nodes[selected].length??1,1,1);proxy.updateMatrixWorld(true);}
 function update(follow=true,redraw=true){if(editingConnection&&!edits.state().active&&!model.attachments?.some(a=>a.objectId===editingConnection&&a.targetMount)){seat?.back?.();editingConnection=null;}root.userData.linkMechanism=model;root.userData.mechanismFraction=t;if(follow)follower.update(model,t);if(seatingPreview&&previewIdentity!==seatingIdentity()){seatingPreview=null;fasteningView.clearPreview();}if(connectionDraft?.kind&&connectionIdentity!==seatingIdentity()){connectionDraft.kind=null;connectionDraft.error='Scene changed. Choose a preview again.';fasteningView.clearPreview();}connectView.update(draftRecipe(),t,objects(),connectionDraft,showOverlays);view.update(model,t,selectedPiston?-1:selected,showOverlays&&!playing&&mode!=='build',selectedPiston?.kind==='pistons'?selectedPiston.index:null);mirror?.refresh();mountStatus=mountView.update(model,t,objects(),selectedMount,showOverlays,showOverlays&&showTravel,selectedPiston?.kind==='mountPistons'?selectedPiston.index:null,selectedConnection);fasteningView.update(model,t,objects(),showOverlays?selectedConnection:null,editingConnection);fasteningView.showOverlays(showOverlays);grid.visible=showOverlays&&editing&&mode==='build'&&tool==='draw';origin.visible=!model.nodes.length;if(!edits.state().active)putProxy();updateGuides();if(redraw)session.redraw();refresh();frameIdentity=sceneIdentity();}
 function draftRecipe(){return {...model,mounts:[...(model.mounts??[]),...(connectionDraft?.ends??[]).filter(m=>!model.mounts?.some(x=>x.id===m.id))]};}
 function clearConnection(){connectionDraft=null;connectionIdentity=null;connectionPast=[];connectionFuture=[];fasteningView.clearPreview();connectionHistory?.changed();}
 function rememberConnection(){connectionPast.push(structuredClone(connectionDraft.ends));connectionFuture=[];}
 function replayConnection(from,to){if(!from.length)return false;to.push(structuredClone(connectionDraft.ends));connectionDraft={ends:from.pop(),kind:null,error:null};connectionIdentity=null;fasteningView.clearPreview();update();return true;}
 function connectionCandidate(kind){
  if(connectionDraft?.ends.length!==2)throw Error('Pick two ends first');
  const [a,b]=connectionDraft.ends,next=checkedMechanism(draftRecipe());
  if(kind==='fasten'||kind==='hinge'){
   const entry=objects().find(e=>e.id===a.owner.objectId);if(!entry)throw Error('First pick the object that should move. Links can be connected with a piston.');
   entry.object.updateWorldMatrix(true,false);const binding={objectId:entry.id,sourceMount:a.id,targetMount:b.id,offset:{...identityFrame(),scale:entry.object.getWorldScale(new T.Vector3()).toArray()},...(kind==='hinge'?{hinge:[0,0],hardware:{family:'clevis',size:1,mounting:'part-frames'}}:{})};
   next.attachments=[...(next.attachments??[]),binding];checkConnections(root,next,objects());return {next,binding};
  }
  if(kind!=='piston')throw Error('Choose fastening, hinge or piston');
  const pa=new T.Vector3().setFromMatrixPosition(mountMatrix(root,next,a.id,t,objects())),pb=new T.Vector3().setFromMatrixPosition(mountMatrix(root,next,b.id,t,objects())),length=pa.distanceTo(pb);if(length<1e-6)throw Error('Pick separated ends for a piston');
  next.mountPistons=[...(next.mountPistons??[]),{a:a.id,b:b.id,barrelLength:length*.55}];return {next};
 }
 function pause(){playing=false;stop();stop=()=>{};update();}
 function resetPose(){pause();cycle=mode==='B'?.5:0;t=mode==='B'?1:0;update();}
 function apply(next,label,{reset=true,placements=[],geometry}={}){ensure();checkConnections(root,next,objects());if(reset)resetPose();else pause();placementIds=placements;pendingGeometry=geometry;try{edits.apply(whole,{...history.recipeSnapshot(checkedMechanism(next)),...(geometry?{geometry}:{})},label);}finally{placementIds=[];pendingGeometry=undefined;}record({kind:'links.edit',phase:'applied',effective:read()});return read();}
 geometryTarget=history.register('geometry',{read:()=>view.replacementState(),check:v=>structuredClone(v),write:v=>{view.setBodies(v);syncGeometry();geometryRevision++;session.redraw();refresh();}});
 const snapshot=(ids=placementIds)=>({...history.recipeSnapshot(model),geometryRef:currentGeometryRef(),placements:capturePlacements(ids,objects())});
 whole=history.register('recipe',{read:snapshot,readForReplay:v=>snapshot((v.placements??[]).map(p=>p.id)),check:v=>{const {geometry,...rest}=v,geometryRef=geometry!==undefined?history.rememberGeometry(geometry):v.geometryRef??(pendingGeometry!==undefined?history.rememberGeometry(pendingGeometry):currentGeometryRef());history.geometry(geometryRef);return {...rest,...history.recipeSnapshot(history.restoreRecipe(v)),geometryRef};},write:v=>{restorePlacements(v.placements,objects());model=history.restoreRecipe(v);clearConnection();selectedPiston=null;selectedConnection=editingConnection&&model.attachments?.some(a=>a.objectId===editingConnection)?editingConnection:null;seatingPreview=null;fasteningView.clearPreview();connectionStart=null;if(!model.mounts?.some(m=>m.id===selectedMount))selectedMount=null;selected=model.nodes.length?Math.max(0,Math.min(selected,model.nodes.length-1)):-1;pistonStart=null;follower.reset();update();restoreGeometry(v.geometryRef??v.geometry);session.redraw();refresh();}});
 function handleRead(joint=selected,requestedMode=mode){
  const f=frames(model,requestedMode==='B'?1:0)[joint];if(!f)throw Error('Choose an existing joint');
  root.updateWorldMatrix(true,false);const position=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld),q=root.getWorldQuaternion(new T.Quaternion()).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),f.angle)),e=new T.Euler().setFromQuaternion(q);
  const active=edits.state().active,geometryRef=active?.id===target&&active.before.geometryRef?active.before.geometryRef:currentGeometryRef();
  return {...history.recipeSnapshot(model),geometryRef,joint,mode:requestedMode,position:position.toArray(),rotation:[e.x,e.y,e.z],scale:[model.nodes[joint].length??1,1,1]};
 }
 target=history.register('joint',{read:handleRead,readForReplay:v=>handleRead(v.joint,v.mode),check:v=>{if(playing)throw Error('Stop playback to edit joints');history.restoreRecipe(v);if(v.geometryRef!==undefined)history.geometry(v.geometryRef);if(!v.recipe.nodes[v.joint]||!['position','rotation','scale'].every(k=>Array.isArray(v[k])&&v[k].length===3&&v[k].every(Number.isFinite)))throw Error('Finite joint transform required');return structuredClone(v);},write:v=>{
  playing=false;stop();stop=()=>{};cycle=v.mode==='B'?.5:0;t=v.mode==='B'?1:0;selected=v.joint;const base=history.restoreRecipe(v),n=base.nodes[selected],f=frames(base,v.mode==='B'?1:0)[selected];root.updateWorldMatrix(true,false);const p=new T.Vector3(...v.position).applyMatrix4(root.matrixWorld.clone().invert());
  model=checkedMechanism(base);
  const active=edits.state().active;if(!active||JSON.stringify(v)===JSON.stringify(active.before)){update();restoreGeometry(v.geometryRef??v.geometry);session.redraw();refresh();return;}
  const oldWorld=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld),moved=oldWorld.distanceTo(new T.Vector3(...v.position))>1e-7;
  const resized=v.mode==='build'&&n.parent!==null&&Math.abs(v.scale[0]-n.length)>1e-7;
  if(moved&&!resized)model=moveJoint(base,selected,[p.x,p.y],v.mode);
  else if(n.parent!==null){const q=new T.Quaternion().setFromEuler(new T.Euler(...v.rotation)).premultiply(root.getWorldQuaternion(new T.Quaternion()).invert()),e=new T.Euler().setFromQuaternion(q),parent=frames(base,v.mode==='B'?1:0)[n.parent],length=v.mode==='build'?v.scale[0]:n.length;model=moveJoint(base,selected,[parent.point[0]+Math.cos(e.z)*length,parent.point[1]+Math.sin(e.z)*length],v.mode);if(v.mode==='build')model.nodes[selected].length=Math.abs(length);}
  update();restoreGeometry(v.geometryRef??v.geometry);session.redraw();refresh();
 }});

 function mountRead(id=selectedMount){const m=model.mounts?.find(m=>m.id===id);if(!m)throw Error('Choose a mount');return {...history.recipeSnapshot(model),mount:id,...matrixFrame(mountMatrix(root,model,id,t,objects()))};}
 mountTarget=history.register('mount',{read:mountRead,readForReplay:v=>mountRead(v.mount),check:v=>{history.restoreRecipe(v);for(const k of ['position','rotation'])if(!v[k]?.every(Number.isFinite)||v[k].length!==3)throw Error('Finite mount frame required');return structuredClone(v);},write:v=>{
  playing=false;stop();stop=()=>{};selectedMount=v.mount;model=history.restoreRecipe(v);const m=model.mounts.find(m=>m.id===v.mount);if(!m)throw Error('Unknown mount');
  const active=edits.state().active;if(active&&JSON.stringify(v)!==JSON.stringify(active.before)){const owner=mountOwnerMatrix(root,model,m,t,objects()),position=new T.Vector3(...v.position).applyMatrix4(owner.clone().invert());let q;
   if(m.owner.joint!==undefined){const rigid=mountMatrix(root,{...model,mounts:[{...m,position:[0,0,0],rotation:[0,0,0]}]},m.id,t,objects());q=new T.Quaternion().setFromRotationMatrix(rigid);}else q=objects().find(e=>e.id===m.owner.objectId).object.getWorldQuaternion(new T.Quaternion()).normalize();
   q.invert().multiply(new T.Quaternion().setFromEuler(new T.Euler(...v.rotation)));const e=new T.Euler().setFromQuaternion(q);m.position=position.toArray();m.rotation=[e.x,e.y,e.z];
  }follower.reset();update();
 }});
 function seatingRead(objectId=activeSeatingId(),requestedMode=mode){const a=model.attachments?.find(a=>a.objectId===objectId&&a.targetMount),poseT=Array.isArray(a?.hinge)&&(requestedMode==='A'||requestedMode==='B')?(requestedMode==='B'?1:0):t;return {...history.recipeSnapshot(model),connection:objectId,mode:requestedMode,...matrixFrame(seatingFrame(root,model,objectId,poseT,objects()))};}
 seatingTarget=history.register('seating',{read:seatingRead,readForReplay:v=>seatingRead(v.connection,v.mode),check:v=>{history.restoreRecipe(v);for(const k of ['position','rotation','scale'])if(v[k]?.length!==3||!v[k].every(Number.isFinite))throw Error('Finite seating transform required');return structuredClone(v);},write:v=>{
  resetPose();
  const before=edits.state().active?.before;
  // Cancellation restores the authored recipe exactly, including pre-existing offsets.
  const base=history.restoreRecipe(v);model=before&&JSON.stringify(v)===JSON.stringify(before)?base:edits.state().active?checkedMechanism(adjustSeating(root,base,v.connection,t,objects(),v)):base;
  follower.reset();update();
 }});
 function axleRead(objectId=editingConnection){const a=model.attachments.find(a=>a.objectId===objectId);return {...history.recipeSnapshot(model),connection:objectId,...matrixFrame(hingeWorldFrame(root,model,a,0,objects())),scale:[a.hardware?.size??1,a.hardware?.size??1,a.hardware?.size??1]};}
 axleTarget=history.register('axle',{read:axleRead,readForReplay:v=>axleRead(v.connection),check:v=>{history.restoreRecipe(v);for(const k of ['position','rotation','scale'])if(v[k]?.length!==3||!v[k].every(Number.isFinite))throw Error('Finite axle transform required');if(v.scale.some(x=>x<=0))throw Error('Positive hinge size required');return structuredClone(v);},write:v=>{
  model=history.restoreRecipe(v);if(edits.state().active&&JSON.stringify(v)!==JSON.stringify(edits.state().active.before)){
   const a=model.attachments.find(a=>a.objectId===v.connection),previous=a.hardware?.size??1,changed=v.scale.find(x=>Math.abs(x-previous)>1e-7);
   a.hardware=checkedHardware({...a.hardware??{family:'clevis',size:1},size:changed??previous});if(changed&&a.hardware.parts)delete a.hardware.parts;
   const target=previewMountMatrix(root,model,a.targetMount,0,objects());
   if(a.hardware.mounting==='part-frames'){
    const desired=new T.Matrix4().compose(new T.Vector3(...v.position),new T.Quaternion().setFromEuler(new T.Euler(...v.rotation)),new T.Vector3(1,1,1)),local=matrixFrame(target.clone().invert().multiply(desired).multiply(frameMatrix(hingeMountFrames(a.hardware).fixed)));
    a.axle={position:local.position,rotation:local.rotation};
   }else{
    const origin=hingeWorldFrame(root,model,{...a,axle:undefined},0,objects()),q=new T.Quaternion().setFromRotationMatrix(target),p=new T.Vector3(...v.position).sub(new T.Vector3().setFromMatrixPosition(origin)).applyQuaternion(q.clone().invert()),rotation=new T.Quaternion().setFromEuler(new T.Euler(...v.rotation)).premultiply(q.invert()),e=new T.Euler().setFromQuaternion(rotation);a.axle={position:p.toArray(),rotation:[e.x,e.y,e.z]};
   }
  }
  follower.reset();update();
 }});
 const seatingContext={
  enter(){editingConnection=selectedConnection;resetPose();putProxy();},
  exit(){editingAxle=false;editingConnection=null;update();},
  target(){if(!editingConnection)return null;if(!edits.state().active)putProxy();if(editingAxle)return {id:axleTarget,type:'hinge-axle',label:'Hinge axle',object:proxy,read:axleRead,frameObjects:fasteningView.selectedObjects(editingConnection)};const pose=seatingRead();return {id:seatingTarget,type:'connection-seating',label:'Connection seating',object:proxy,read:seatingRead,localOrientation:pose.rotation,frameObjects:fasteningView.selectedObjects(editingConnection)};},
  pick(event,{camera,canvas}){
   const r=canvas.getBoundingClientRect(),ray=new T.Raycaster();
   ray.setFromCamera(new T.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);
   const mountHit=ray.intersectObjects(mountView.markers().filter(m=>m.parent.visible),false)[0];
   const connectionHit=ray.intersectObjects(fasteningView.connectionMeshes(),false)[0];
   const nextId=mountHit&&(!connectionHit||mountHit.distance<=connectionHit.distance+.2)?model.attachments?.find(a=>a.targetMount&&(a.sourceMount===mountHit.object.userData.mount||a.targetMount===mountHit.object.userData.mount))?.objectId:connectionHit?.object.userData.connection;
   if(connectionHit?.object.userData.hingeAxle){operations.editAxle({objectId:connectionHit.object.userData.connection});return;}
   if(nextId&&nextId!==editingConnection)seat.changed(()=>{edits.cancel();selectedConnection=nextId;editingConnection=nextId;editingAxle=false;resetPose();putProxy();update();});
  },
  remove(){const objectId=editingConnection;seat.back();return operations.detach({objectId});},
 };
 function chooseMount(id){if(tool==='select'){const fastened=model.attachments?.find(a=>a.targetMount&&(a.sourceMount===id||a.targetMount===id));if(fastened){operations.selectConnection({objectId:fastened.objectId});return;}}seat.changed(()=>{selectedMount=id;selectedPiston=null;selectedConnection=null;update();});if(['snap','fasten','mount-piston'].includes(tool)){if(!connectionStart)connectionStart=id;else{const source=connectionStart;connectionStart=null;try{operations[tool==='mount-piston'?'mountPiston':tool==='fasten'?'previewFasten':tool]({source,target:id});}catch(e){if(status)status.textContent=e.message;}}}refresh();}
 seat=host.controls.components.register(asset.id,{child(){return selectedConnection?seatingContext:null;},enter(){editing=true;resetPose();update();},exit(){if(!mirror?.state().placing&&win.kaminosSelection?.read?.().activeId!==mirror?.state().planeObjectId)mirror?.clear();editing=false;tool='select';pistonStart=null;connectionStart=null;hoverJoint=null;hoverPoint=null;clearConnection();update();},remove(){return operations.deleteSelected();},hover(event,context){if(!editing||playing)return;const p=pointerAt(event,context);hoverJoint=p.joint;hoverPoint=p.point;hoverShift=!!event?.shiftKey;updateGuides();session.redraw();},cancel:cancelConstruction,target(){if(tool==='mirror'||tool==='connect'||(tool==='draw'&&!model.nodes.length)||selectedPiston||seatingPreview)return null;if(selectedConnection){if(mode!=='build'&&Array.isArray(model.attachments?.find(a=>a.objectId===selectedConnection)?.hinge)){if(!edits.state().active)putProxy();const pose=seatingRead(selectedConnection);return {id:seatingTarget,type:'connection-seating',label:'Connection seating',object:proxy,read:()=>seatingRead(selectedConnection),localOrientation:pose.rotation,frameObjects:fasteningView.selectedObjects(selectedConnection)};}return null;}if(selectedMount){try{mountMatrix(root,model,selectedMount,t,objects());}catch{return null;}if(!edits.state().active)putProxy();return {id:mountTarget,type:'mount',label:'Mount',object:proxy,read:mountRead,frameObjects:[mountView.object(selectedMount)]};}if(selected<0)return null;if(!edits.state().active)putProxy();return {id:target,type:'link-joint',label:`Joint ${selected+1}`,object:proxy,read:handleRead,frameObjects:[view.markers()[selected]]};},pick(event,context){
  const {camera,canvas}=context;
  if(playing){pause();}
  if(tool==='mirror'){mirror.pick(event,context);refresh();return;}
  const r=canvas.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);
  if(tool==='connect'){
   try{
    const marker=ray.intersectObjects(mountView.markers().filter(m=>m.parent.visible),false)[0];if(marker){operations.connectEnd({mount:marker.object.userData.mount});return;}
    const visible=o=>{while(o){if(!o.visible)return false;o=o.parent;}return true;};
    const joint=ray.intersectObjects(view.markers().filter(visible),false)[0];
    const entries=objects(),hits=ray.intersectObjects([...entries.filter(e=>e.object!==root&&['glb','pbr','procedural-mesh'].includes(e.type)).map(e=>e.object),visual],true);
    const hit=hits.find(h=>{let o=h.object;while(o){if(!o.visible||o.userData.mechanismOverlay||o.userData.kaminosEditorOnly)return false;o=o.parent;}return h.object.isMesh;});
    // Mount markers are deliberately visible overlays; physical joints obey surface depth.
    if(joint&&(!hit||joint.distance<=hit.distance)){operations.connectEnd({joint:joint.object.userData.joint});return;}
    if(!hit)return;
    const owner=entries.find(e=>{let o=hit.object;while(o){if(o===e.object)return true;o=o.parent;}return false;});
    const normal=hit.face?.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()??new T.Vector3(0,0,1);let descriptor;
    if(owner?.object!==root){if(owner?.object.userData.linkMechanism)throw Error('Use an existing point on this mechanism, or select it to connect its moving links.');if(!owner)return;descriptor={objectId:owner.id};}
    else{const local=root.worldToLocal(hit.point.clone()),f=frames(model,t);let best=-1,d=Infinity;model.nodes.forEach((n,i)=>{if(n.parent===null)return;const a=new T.Vector3(...f[n.parent].point,0),b=new T.Vector3(...f[i].point,0),distance=new T.Line3(a,b).closestPointToPoint(local,true,new T.Vector3()).distanceTo(local);if(distance<d){best=i;d=distance;}});if(best<0)return;descriptor={joint:best};}
    const base=mountOwnerMatrix(root,model,{owner:descriptor},t,entries),position=hit.point.clone().applyMatrix4(base.clone().invert()),ownerQ=new T.Quaternion();base.decompose(new T.Vector3(),ownerQ,new T.Vector3());
    // The first object's outward normal faces the receiving surface after seating.
    const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),normal.multiplyScalar(connectionDraft?.ends.length===1?-1:1)).premultiply(ownerQ.invert()),e=new T.Euler().setFromQuaternion(q);
    operations.connectEnd({...descriptor,position:position.toArray(),rotation:[e.x,e.y,e.z]});
   }catch(e){if(connectionDraft)connectionDraft.error=e.message;refresh();}return;
  }
  const mountHit=ray.intersectObjects(mountView.markers().filter(m=>m.parent.visible),false)[0];
  const connectionHit=ray.intersectObjects(fasteningView.connectionMeshes(),false)[0];
  if(tool==='select'&&(mountHit||connectionHit)){if(connectionHit?.object.userData.hingeAxle){operations.selectConnection({objectId:connectionHit.object.userData.connection});operations.editAxle();return;}if(mountHit&&(!connectionHit||mountHit.distance<=connectionHit.distance+.2))chooseMount(mountHit.object.userData.mount);else operations.selectConnection({objectId:connectionHit.object.userData.connection});return;}
  if(mountHit){chooseMount(mountHit.object.userData.mount);return;}
  if(tool==='mount'&&mode==='build'){
   const entries=objects(),hits=ray.intersectObjects([...entries.filter(e=>e.object!==root).map(e=>e.object),visual],true),hit=hits.find(h=>h.object.isMesh);if(!hit)return;
   let owner=entries.find(e=>{let o=hit.object;while(o){if(o===e.object)return true;o=o.parent;}return false;});
   if(owner?.object!==root&&owner){if(owner.object.userData.linkMechanism){if(status)status.textContent='Select this mechanism to place mounts on its moving links; Add mount can mount its root.';return;}const local=owner.object.worldToLocal(hit.point.clone());operations.mount({objectId:owner.id,position:local.toArray()});}
   else{const local=root.worldToLocal(hit.point.clone()),f=frames(model,t);let best=-1,d=Infinity;model.nodes.forEach((n,i)=>{if(n.parent===null)return;const a=new T.Vector3(...f[n.parent].point,0),b=new T.Vector3(...f[i].point,0),q=new T.Line3(a,b).closestPointToPoint(local,true,new T.Vector3()),distance=q.distanceTo(local);if(distance<d){d=distance;best=i;}});if(best>=0){const base=mountOwnerMatrix(root,model,{owner:{joint:best}},t,entries),p=hit.point.clone().applyMatrix4(base.invert());operations.mount({joint:best,position:p.toArray()});}}return;
  }
  const p=pointerAt(event,context);hoverJoint=p.joint;hoverPoint=p.point;hoverShift=!!event.shiftKey;
  const hit=ray.intersectObjects(view.markers(),false)[0];
  const jointId=hit?hit.object.userData.joint:p.joint;
  if(jointId!==null&&jointId!==undefined){
   if(tool==='piston'&&mode==='build'){
    const g=guidance();if(!g.valid){updateGuides();session.redraw();return;}
    if(pistonStart===null)pistonStart=jointId;else{try{apply(connectPiston(model,pistonStart,jointId),'Connect piston');tool='select';}catch(e){if(status)status.textContent=e.message;}pistonStart=null;}
    updateGuides();refresh();session.redraw();return;
   }
   seat.changed(()=>{selected=jointId;selectedMount=null;selectedPiston=null;selectedConnection=null;update();});return;
  }
  const pistonHit=ray.intersectObjects([...view.pistonMeshes(),...mountView.pistonMeshes()].filter(o=>o.visible),false)[0];
  if(pistonHit){operations.selectPiston(pistonHit.object.userData.piston);return;}
  if(mode!=='build'||tool!=='draw'||!p.point)return;
  try{const next=appendJoint(model,event.shiftKey?null:(selected<0?null:selected),p.point.slice(0,2));apply(next,'Draw link');seat.changed(()=>{selected=model.nodes.length-1;update();});}catch(e){if(status)status.textContent=e.message;}
 }});
 connectionHistory=edits.registerHistoryScope({active:()=>!!(tool==='connect'&&connectionDraft&&seat.active?.()),state:()=>({undoCount:connectionPast.length,redoCount:connectionFuture.length}),undo:()=>replayConnection(connectionPast,connectionFuture),redo:()=>replayConnection(connectionFuture,connectionPast)});
 unsubscribe=edits.subscribe(()=>{if(!disposed){if(editingConnection&&!edits.state().active&&!model.attachments?.some(a=>a.objectId===editingConnection&&a.targetMount))seat.back?.();putProxy();refresh();}});
 const operations={
  hingeHardware({objectId=selectedConnection,family,size}={}){const next=copyMechanism(model),a=next.attachments?.find(a=>a.objectId===objectId&&a.hinge);if(!a)throw Error('Choose a hinged connection');a.hardware=checkedHardware({family:family??a.hardware?.family??'clevis',size:size??a.hardware?.size??1,...(a.hardware?.mounting?{mounting:a.hardware.mounting}:{})});apply(next,'Change analytical hinge',{reset:false});operations.selectConnection({objectId});return read();},
  seatHinge({objectId=selectedConnection}={}){const next=copyMechanism(model),a=next.attachments?.find(a=>a.objectId===objectId&&a.hinge);if(!a?.hardware)throw Error('Choose an analytical hinge');a.hardware={...a.hardware,mounting:'part-frames'};delete a.axle;a.offset={...identityFrame(),scale:a.offset.scale};apply(next,'Seat on hinge mounting faces',{reset:false});operations.selectConnection({objectId});return read();},
  hingeFrames({objectId=selectedConnection}={}){const a=model.attachments?.find(a=>a.objectId===objectId&&a.hardware);if(!a)throw Error('Choose an analytical hinge');const axis=hingeWorldFrame(root,model,a,t,objects()),mounts=hingeMountFrames(a.hardware);return {mounting:a.hardware.mounting??'legacy-contact',axle:matrixFrame(axis),fixed:matrixFrame(axis.clone().multiply(frameMatrix(mounts.fixed))),moving:matrixFrame(axis.clone().multiply(new T.Matrix4().makeRotationZ(a.hinge[0]+(a.hinge[1]-a.hinge[0])*t)).multiply(frameMatrix(mounts.moving)))};},
  editAxle({objectId=selectedConnection}={}){if(!model.attachments?.some(a=>a.objectId===objectId&&a.hinge))throw Error('Choose a hinged connection');if(!model.attachments.find(a=>a.objectId===objectId).hardware)operations.hingeHardware({objectId});if(editingConnection!==objectId)operations.editConnection({objectId});seat.changed(()=>{editingAxle=true;resetPose();putProxy();});return read();},
  editSeat(){seat.changed(()=>{editingAxle=false;putProxy();});return read();},
  exportHinge({objectId=activeSeatingId()??selectedConnection}={}){const a=model.attachments.find(a=>a.objectId===objectId&&a.hinge);if(!a)throw Error('Choose a hinged connection');return {...exportHinge(a.hardware??{family:'clevis',size:1}),connection:objectId,axle:matrixFrame(hingeWorldFrame(root,model,a,0,objects()))};},
  importHinge({objectId=activeSeatingId()??selectedConnection,packet}){const next=copyMechanism(model),a=next.attachments.find(a=>a.objectId===objectId&&a.hinge);if(!a)throw Error('Choose a hinged connection');a.hardware=importHinge(a.hardware??{family:'clevis',size:1},packet);apply(next,'Return hinge appearance',{reset:false});operations.selectConnection({objectId});return read();},
  connectEnd({mount,objectId,joint,position=[0,0,0],rotation=[0,0,0]}){
   pause();if(!connectionDraft)connectionDraft={ends:[],kind:null,error:null};
   let endpoint=mount?model.mounts?.find(m=>m.id===mount):null;if(mount&&!endpoint)throw Error('This mounting point no longer exists');
   if(!endpoint){const owner=objectId?{objectId}:{joint};const entry=objects().find(e=>e.id===objectId);if(objectId&&(!entry||entry.object===root||!['glb','pbr','procedural-mesh'].includes(entry.type)))throw Error('Pick a mesh object');
    endpoint={id:T.MathUtils.generateUUID(),owner,position,rotation,label:objectId?(entry.label??entry.object.name??'Object'):`Link ${joint+1}`};checkedMechanism({...model,mounts:[...(model.mounts??[]),endpoint]});mountMatrix(root,{...model,mounts:[...(model.mounts??[]),endpoint]},endpoint.id,t,objects());}
   endpoint=structuredClone(endpoint);endpoint.label=endpoint.owner.objectId?(objects().find(e=>e.id===endpoint.owner.objectId)?.label??endpoint.label??'Object'):`Link ${endpoint.owner.joint+1}`;
   if(connectionDraft.ends.length===1&&connectionDraft.ends[0]?.id===endpoint.id)throw Error('Pick a different second end');
   rememberConnection();if(connectionDraft.ends.length===2)connectionDraft.ends=[];
   connectionDraft.ends.push(endpoint);connectionHistory.changed();connectionDraft.kind=null;connectionDraft.error=null;selectedMount=null;selectedConnection=null;selectedPiston=null;fasteningView.clearPreview();update();return read();
  },
  previewConnection({kind}){pause();fasteningView.clearPreview();if(connectionDraft){connectionDraft.kind=null;connectionDraft.error=null;}try{const {next,binding}=connectionCandidate(kind);if(binding)fasteningView.preview(objects(),seatingWorlds(root,{...next,attachments:model.attachments??[]},binding,t,objects()));connectionDraft.kind=kind;connectionIdentity=seatingIdentity();update();return read();}catch(e){if(connectionDraft)connectionDraft.error=e.message;update();throw e;}},
  commitConnection(){if(!connectionDraft?.kind)throw Error('Choose a connection preview first');if(connectionIdentity!==seatingIdentity()){connectionDraft.kind=null;fasteningView.clearPreview();update();throw Error('Scene changed; choose a preview again');}const kind=connectionDraft.kind,{next,binding}=connectionCandidate(kind);apply(next,kind==='fasten'?'Fasten objects':kind==='hinge'?'Hinge objects':'Connect piston',{reset:false,placements:binding?[binding.objectId]:[]});tool='select';if(binding)operations.selectConnection({objectId:binding.objectId});else operations.selectPiston({kind:'mountPistons',index:model.mountPistons.length-1});return read();},
  restartConnection(){if(!connectionDraft)return operations.tool({value:'connect'});if(connectionDraft.ends.length)rememberConnection();connectionDraft={ends:[],kind:null,error:null};connectionIdentity=null;fasteningView.clearPreview();update();connectionHistory.changed();return read();},
  cancelConnection(){clearConnection();update();return read();},

  selectPiston({kind='pistons',index}){if(!['pistons','mountPistons'].includes(kind)||!Number.isInteger(index)||!model[kind]?.[index])throw Error('Choose an existing piston');seat.changed(()=>{pause();selectedMount=null;selectedConnection=null;selectedPiston={kind,index};update();});return read();},
  removePiston({kind='pistons',index}={}){if(!['pistons','mountPistons'].includes(kind)||!Number.isInteger(index)||!model[kind]?.[index])throw Error('Choose an existing piston');const next={...model,[kind]:model[kind].filter((_,i)=>i!==index)};const geometry=kind==='pistons'?remapBodyGeometry(model,next,view.replacementState(),{removedPiston:index}):undefined;return apply(next,'Remove piston',{reset:false,geometry});},
  deleteSelected(){if(connectionDraft)return operations.cancelConnection();if(seatingPreview)return operations.cancelPreview();if(selectedConnection)return operations.detach({objectId:selectedConnection});if(selectedPiston)return operations.removePiston(selectedPiston);if(selectedMount)return operations.removeMount();if(model.nodes[selected])return operations.remove();return read();},
  selectConnection({objectId}){if(!model.attachments?.some(a=>a.objectId===objectId&&a.targetMount))throw Error('Choose an existing fastening');seat.changed(()=>{pause();selectedConnection=objectId;selectedMount=null;selectedPiston=null;update();});return read();},
  editConnection({objectId=selectedConnection}={}){if(editingConnection){if(!model.attachments?.some(a=>a.objectId===objectId&&a.targetMount))throw Error('Choose an existing fastening');if(editingConnection!==objectId)seat.changed(()=>{selectedConnection=editingConnection=objectId;editingAxle=false;resetPose();update();});return read();}operations.selectConnection({objectId});host.scene.select?.(asset.id);win.kaminosSelection?.set?.([asset.id],asset.id);seat.enter?.();seat.enterChild?.();update();return read();},
  leaveConnection(){if(editingConnection)seat.back?.();return read();},
  overlays({enabled}){showOverlays=!!enabled;update();return read();},
  previewFasten({source=selectedMount,target}){pause();const m=model.mounts?.find(m=>m.id===source),entry=objects().find(e=>e.id===m?.owner.objectId);if(!entry||source===target)throw Error('Choose an object point first, then a destination point');entry.object.updateWorldMatrix(true,false);const binding={objectId:entry.id,sourceMount:source,targetMount:target,offset:{...identityFrame(),scale:entry.object.getWorldScale(new T.Vector3()).toArray()}};const next=checkedMechanism({...model,attachments:[...(model.attachments??[]),binding]});checkConnections(root,next,objects());const worlds=seatingWorlds(root,model,binding,t,objects());seat.changed(()=>{selectedConnection=null;seatingPreview={source,target,objectId:entry.id,moving:[...worlds.keys()]};fasteningView.preview(objects(),worlds);previewIdentity=seatingIdentity();update();});return read();},
  cancelPreview(){seat.changed(()=>{seatingPreview=null;fasteningView.clearPreview();update();});return read();},
  confirmFasten(){if(!seatingPreview)throw Error('Preview a fastening first');if(previewIdentity!==seatingIdentity()){operations.cancelPreview();throw Error('The scene changed; preview this fastening again');}const {source,target,objectId}=seatingPreview;operations.fasten({source,target});return operations.selectConnection({objectId});},
  previewTravel({enabled}){showTravel=!!enabled;update();return read();},
  mount({objectId,joint=selected,position=[0,0,0],rotation=[0,0,0],label}={}){pause();if(objectId&&!objects().some(e=>e.id===objectId&&['glb','pbr','procedural-mesh'].includes(e.type)))throw Error('Choose a mesh or mechanism');const id=T.MathUtils.generateUUID(),m={id,label:label??`Mount ${(model.mounts?.length??0)+1}`,owner:objectId?{objectId}:{joint},position,rotation};apply({...model,mounts:[...(model.mounts??[]),m]},'Add mount',{reset:false});seat.changed(()=>{selectedMount=id;selectedPiston=null;selectedConnection=null;update();});return read();},
  selectMount({id}){if(!model.mounts?.some(m=>m.id===id))throw Error('Unknown mount');seat.changed(()=>{selectedMount=id;selectedPiston=null;selectedConnection=null;update();});return read();},
  removeMount({id=selectedMount}={}){return apply({...model,mounts:(model.mounts??[]).filter(m=>m.id!==id),attachments:(model.attachments??[]).filter(a=>a.sourceMount!==id&&a.targetMount!==id),mountPistons:(model.mountPistons??[]).filter(p=>p.a!==id&&p.b!==id)},'Remove mount',{reset:false});},
  snap({source=selectedMount,target}){pause();const m=model.mounts?.find(m=>m.id===source);if(!m?.owner.objectId)throw Error('Choose the mount on the object to move first');const objectId=m.owner.objectId,entry=objects().find(e=>e.id===objectId);if(!entry||source===target)throw Error('Choose two different mounts');if(objects().some(e=>e.object?.userData.linkMechanism?.attachments?.some(a=>a.objectId===objectId)))throw Error('Detach this object before snapping it');const a={objectId,sourceMount:source,targetMount:target},q=checkedMechanism({...model,attachments:[...(model.attachments??[]),{...a,offset:identityFrame()}]});checkConnections(root,q,objects());const world=attachmentBase(root,q,a,t,objects());entry.object.updateWorldMatrix(true,false);const scale=entry.object.getWorldScale(new T.Vector3());world.scale(scale);entry.object.parent.updateWorldMatrix(true,false);edits.apply(objectId,matrixFrame(entry.object.parent.matrixWorld.clone().invert().multiply(world)),'Snap mounts');update();return read();},
  fasten({source=selectedMount,target}){pause();const m=model.mounts?.find(m=>m.id===source),entry=objects().find(e=>e.id===m?.owner.objectId);if(!entry||source===target)throw Error('Choose an object mount first, then a destination mount');entry.object.updateWorldMatrix(true,false);const scale=entry.object.getWorldScale(new T.Vector3()).toArray(),a={objectId:entry.id,sourceMount:source,targetMount:target,offset:{...identityFrame(),scale}};return apply({...model,attachments:[...(model.attachments??[]),a]},'Fasten mounts',{reset:false,placements:[entry.id]});},
  mountPiston({source=selectedMount,target}){if(source===target)throw Error('Choose two different mounts');const a=mountMatrix(root,model,source,t,objects()),b=mountMatrix(root,model,target,t,objects()),length=new T.Vector3().setFromMatrixPosition(a).distanceTo(new T.Vector3().setFromMatrixPosition(b));if(length<1e-6)throw Error('Separate the piston mounts');return apply({...model,mountPistons:[...(model.mountPistons??[]),{a:source,b:target,barrelLength:length*.55}]},'Connect mounted piston',{reset:false});},
  append({parent=selected<0?null:selected,point}){const next=appendJoint(model,parent,point);apply(next,'Draw link');seat.changed(()=>{selected=model.nodes.length-1;update();});return read();},
  select({joint}){if(!model.nodes[joint])throw Error('Unknown joint');seat.changed(()=>{selected=joint;selectedMount=null;selectedPiston=null;selectedConnection=null;update();});return read();},
  move({joint=selected,point,mode:requested=mode}){return apply(moveJoint(model,joint,point,requested),'Move joint');},
  piston({a,b}){return apply(connectPiston(model,a,b),'Connect piston');},
  mode({value}){if(!['build','A','B'].includes(value))throw Error('Unknown mode');seat.changed(()=>{edits.cancel();pause();clearConnection();mode=value;cycle=value==='B'?.5:0;t=value==='B'?1:0;pistonStart=null;putProxy();update();});return read();},
  tool({value}){if(editingConnection)seat.back?.();if(!['draw','select','connect','piston','mirror','mount','snap','fasten','mount-piston'].includes(value))throw Error('Unknown tool');ensure();operations.cancelPreview();clearConnection();tool=value;if(value!=='mirror')mirror?.clear();pistonStart=null;connectionStart=null;hoverJoint=null;hoverPoint=null;if(value==='connect'){pause();showOverlays=true;connectionDraft={ends:[],kind:null,error:null};}host.scene.select?.(asset.id);win.kaminosSelection?.set?.([asset.id],asset.id);seat.enter?.();update();connectionHistory.changed();return read();},
  cancel(){cancelConstruction();return read();},
  mirrorSelect({selections}){const result=mirror.select(selections);refresh();return result;},
  async mirrorPlane(){await mirror.place();controls?.update();return mirror.state();},
  mirrorCopy(){return mirror.copy();},
  play(){ensure();if(editingConnection)seat.back?.();clearConnection();if(seatingPreview)operations.cancelPreview();if(playing)return read();if(!hasMotion())throw Error('Draw a link first');mirror?.clear();playing=true;pistonStart=null;hoverJoint=null;hoverPoint=null;updateGuides();if(!inputs.root)stop=session.onFrame(({deltaSeconds})=>{if(edits.state().active)return;cycle=(cycle+deltaSeconds/model.period)%1;t=(1-Math.cos((cycle+(model.phase??0))*2*Math.PI))/2;update();});refresh();return read();},
  pause(){pause();return read();},reset(){resetPose();return read();},seek({cycle:value}){if(!Number.isFinite(value))throw Error('Finite cycle position required');pause();cycle=((value%1)+1)%1;t=(1-Math.cos((cycle+(model.phase??0))*2*Math.PI))/2;update();return read();},phase({value}){return apply({...model,phase:value},'Change phase');},
  remove({joint=selected}={}){const next=removeBranch(model,joint),geometry=remapBodyGeometry(model,next,view.replacementState(),{removedNode:joint});return apply(next,'Remove branch',{geometry});},
  attach({objectId,joint=selected}){const entry=objects().find(e=>e.id===objectId);if(!entry||entry.object===root||!model.nodes[joint])throw Error('Choose another scene object and a joint');if(!['glb','pbr','procedural-mesh'].includes(entry.type))throw Error('Attach a mesh object or mechanism');if(objects().some(e=>e.object?.userData.linkMechanism?.attachments?.some(a=>a.objectId===objectId)))throw Error('Object is already attached; detach it first');pause();return apply({...model,attachments:[...(model.attachments??[]),{objectId,joint,offset:attachmentFrame(root,model,joint,t,entry.object)}]},'Attach object',{reset:false});},
  detach({objectId}){if(editingConnection===objectId)seat.back?.();return apply({...model,attachments:(model.attachments??[]).filter(a=>a.objectId!==objectId)},'Detach object',{reset:false});},
  period({seconds}){return apply({...model,period:seconds},'Change cycle');},
  restore(recipe){apply(recipe,'Open mechanism');seat.changed(()=>{selected=model.nodes.length-1;update();});return read();},snapshot(){return structuredClone(model);},
  async motionSpace(options={}){ensure();const packet=motionSpace(model,{...options,geometry:view.replacementState()});if(!packet.cells.length)throw Error('Draw an assembly before reserving its motion space');const nextSession=await host.scene.open(),mesh=motionSpaceMesh(packet);let nextAsset;try{ensure();nextAsset=await nextSession.attach(mesh,{owned:true,metadata:{label:'Reserved motion space (snapshot)',type:'experiment',source:'experiment:link-workshop-motion-space'}});ensure();mesh.position.copy(root.position);mesh.quaternion.copy(root.quaternion);mesh.scale.copy(root.scale);host.scene.refreshPresentation?.(nextAsset);}catch(e){await nextSession.dispose();if(!nextAsset){mesh.geometry.dispose();mesh.material.dispose();}throw e;}const prior=guide;root.updateWorldMatrix(true,false);guide={packet,geometryRevision,mesh,asset:nextAsset,session:nextSession,sourceTransform:root.matrixWorld.toArray()};await prior?.session.dispose();win.kaminosSelection?.set?.([nextAsset.id],nextAsset.id);session.redraw();refresh();return guideRead();},
  exportMotionSpace(){if(!guide)throw Error('Reserve motion space first');guide.mesh.updateWorldMatrix(true,false);return {...guide.packet,currentRecipe:JSON.stringify(model)===JSON.stringify(guide.packet.recipe),currentGeometry:guide.geometryRevision===geometryRevision,sourceTransform:guide.sourceTransform,guideTransform:guide.mesh.matrixWorld.toArray(),view:session.readView(),brief:'The violet volume is reserved empty space for the complete motion of the supplied analytical assembly. Design a stationary housing around it, preserving passages to the exterior. The volume is a construction guide, not material to reproduce. Attachment features and precise dimensions remain defined by the accompanying geometry.'};},
  exportBodies(){return {...view.exportBodies(),recipe:structuredClone(model)};},
  async importBodies(packet){ensure();pause();const state=view.replacementState(),byId=new Map(state.bodies.map(b=>[b.id,b]));if(packet?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(packet.bodies)||!packet.bodies.length)throw Error('Choose an assembly geometry package');const seen=new Set();for(const b of packet.bodies){if(seen.has(b.id))throw Error('Duplicate body');seen.add(b.id);byId.set(b.id,b);}await edits.applySettled(geometryTarget,{schema:packet.schema,bodies:[...byId.values()]},'Replace body geometry');const result=view.bodyManifest();record({kind:'links.geometry-return',phase:'applied',effective:result});return read();},
  frame(){if(inputs.view){root.updateWorldMatrix(true,false);const point=value=>new T.Vector3(...value).applyMatrix4(root.matrixWorld).toArray();session.setView({...inputs.view,position:point(inputs.view.position),target:point(inputs.view.target)});return read();}if(host.scene.frame){host.scene.frame([visual,fasteningView.group,...objects().filter(e=>(model.attachments??[]).some(a=>a.objectId===e.id)).flatMap(e=>e.object.userData.linkMechanism?e.object.children.filter(o=>o.userData.mechanismVisual):[e.object])]);return read();}const points=[...evaluate(model,0),...evaluate(model,1)],box=new T.Box3();for(const p of points)box.expandByPoint(new T.Vector3(...p,0).applyMatrix4(root.matrixWorld));if(box.isEmpty())box.setFromCenterAndSize(new T.Vector3(0,2,0),new T.Vector3(6,4,1));const c=box.getCenter(new T.Vector3()),d=Math.max(box.getSize(new T.Vector3()).length(),4);session.setView({position:[c.x,c.y,c.z+d*1.85],target:c.toArray(),fov:38});return read();},
 };
 mirror=createMirrorTool({root,view,session,host,win,apply:packet=>operations.importBodies(packet),ensure,relatedAssets});
 update();if(!inputs.root){operations.frame();win.kaminosSelection?.set?.([asset.id],asset.id);}
 return {read,operations,root,asset,advance(delta){if(playing&&!edits.state().active){cycle=(cycle+delta/model.period)%1;t=(1-Math.cos((cycle+(model.phase??0))*2*Math.PI))/2;}},follow(objectId){if(follower.update(model,t,{onlyObjectId:objectId}))session.redraw();},tick(){if(root.parent&&(playing||frameIdentity!==sceneIdentity()))update(false,playing);},mount({root:panel,document,invoke}){
  panel.innerHTML='<h3>Link workshop</h3><p>Select the workshop and press <b>Tab</b>. Choose <b>Draw links</b> to place a fixed anchor, then click to extend links. Click an existing joint to branch from it. Shift-click starts another fixed anchor.</p><p>Choose <b>Select / move</b> to adjust joints with G / R / S. In Pose A or B, moving a joint turns its link without stretching it. Delete removes the selected branch, mount or piston; ⌘/Ctrl Z undoes, Shift ⌘/Ctrl Z redoes. Tab returns to whole-object placement.</p>';
  const properties=document.createElement('section'),playback=document.createElement('div'),top=document.createElement('div'),transport=document.createElement('div');
  properties.innerHTML='<h3>Mechanism</h3>';playback.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:35';
  for(const el of [top,transport]){el.style.cssText='position:absolute;left:16px;display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 8px;background:#18272dd9;border:1px solid #485d67;border-radius:6px;pointer-events:auto;max-width:calc(100% - 32px);box-sizing:border-box;font-size:12px';playback.append(el);}top.style.top='56px';transport.style.bottom='80px';
  status=document.createElement('p');status.setAttribute('role','status');const buttons=[];
  const replace=(el,...items)=>el.replaceChildren?el.replaceChildren(...items):(el.children=[],el.append(...items));
  const opt=(text,value)=>{const o=document.createElement('option');o.textContent=text;o.value=value;return o;};
  const button=(parent,label,fn,active)=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.className='btn';b.style.margin='2px';b.onclick=()=>Promise.resolve().then(fn).catch(e=>status.textContent=e.message);parent.append(b);buttons.push({b,active});return b;};
  const modes=document.createElement('div');modes.style.cssText='display:flex;align-items:center;gap:2px';top.append(modes);for(const [label,value]of [['Build','build'],['Pose A','A'],['Pose B','B']])button(modes,label,()=>invoke('mode',{value}),()=>mode===value);
  const tools=document.createElement('div');tools.style.cssText='display:flex;align-items:center;gap:2px';top.append(tools);for(const [label,value]of [['Select / move','select'],['Draw links','draw'],['Connect…','connect']])button(tools,label,()=>invoke('tool',{value}),()=>tool===value);
  modeNotice=document.createElement('div');modeNotice.setAttribute('role','status');modeNotice.setAttribute('aria-label','Construction mode');modeNotice.style.cssText='padding:2px 8px;border-left:3px solid #50e3be;color:#e4fff6;background:#102e2eb3;font-weight:600;font-size:11px;border-radius:3px';top.append(modeNotice);

  const draftBar=document.createElement('div');draftBar.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:2px 4px;max-width:560px';top.append(draftBar);
  const draftText=document.createElement('div');draftText.style.cssText='font-size:13px;line-height:1.4;width:100%';draftText.setAttribute('role','status');
  const alternatives=document.createElement('div');alternatives.style.cssText='display:flex;gap:4px';draftBar.append(alternatives);
  const fastenChoice=button(alternatives,'Fasten together',()=>invoke('previewConnection',{kind:'fasten'}),()=>connectionDraft?.kind==='fasten');
  const hingeChoice=button(alternatives,'Hinge together',()=>invoke('previewConnection',{kind:'hinge'}),()=>connectionDraft?.kind==='hinge');
  const pistonChoice=button(alternatives,'Add piston',()=>invoke('previewConnection',{kind:'piston'}),()=>connectionDraft?.kind==='piston');
  // Choice controls stay above changing explanation text; hover/focus never select intent.
  const unavailable=document.createElement('div');unavailable.style.cssText='font-size:12px;color:#edc58c;width:100%';draftBar.append(unavailable,draftText);
  const setText=(element,text)=>{if(element.textContent!==text)element.textContent=text;};
  const commitDraft=button(draftBar,'Connect',()=>invoke('commitConnection'));
  button(draftBar,'Start over',()=>invoke('restartConnection'));
  button(draftBar,'Cancel',()=>invoke('tool',{value:'select'}));
  const connectionPicker=document.createElement('div');connectionPicker.style.cssText='margin:6px 0';properties.append(connectionPicker);let connectionPickerKey='';
  const connectionBar=document.createElement('div');connectionBar.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:4px';top.append(connectionBar);
  const connectionText=document.createElement('span');connectionText.style.cssText='font-weight:600;padding:0 4px';connectionBar.append(connectionText);
  const contactLegend=document.createElement('div');contactLegend.style.cssText='font-size:12px;padding:4px 0;color:#b8cbd2';properties.append(contactLegend);
  const editConnection=button(connectionBar,'Edit seating · Tab',()=>invoke('editConnection'));
  const leaveConnection=button(connectionBar,'Back to connections · Tab',()=>invoke('leaveConnection'));
  const confirm=button(connectionBar,'Fasten here',()=>invoke('confirmFasten'));
  const cancel=button(connectionBar,'Cancel',()=>invoke('cancelPreview'));
  const release=button(connectionBar,'Detach',()=>invoke('detach',{objectId:selectedConnection}));
  button(top,'Frame mechanism',()=>invoke('frame'));
  const clean=button(top,'Hide editing marks',()=>invoke('overlays',{enabled:!showOverlays}),()=>!showOverlays);
  const hint=document.createElement('div');hint.style.cssText='font-size:12px;padding:4px 0;color:#bbced4';properties.append(hint);
  const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=snap;toggle.onchange=()=>snap=toggle.checked;label.style.cssText='display:block;margin:10px 0';label.append(toggle,' Snap to ¼-unit grid');properties.append(label);
  const hingePanel=document.createElement('section');properties.append(hingePanel);const hingeTitle=document.createElement('h4');hingeTitle.textContent='Analytical hinge';hingePanel.append(hingeTitle);const rebuildNote=document.createElement('p');rebuildNote.style.fontSize='12px';rebuildNote.textContent='Changing family or sizing with S rebuilds analytical parts. Undo restores any returned appearance.';hingePanel.append(rebuildNote);
  for(const [family,label]of Object.entries(hingeFamilies))button(hingePanel,label,()=>invoke('hingeHardware',{family}),()=>model.attachments?.find(a=>a.objectId===selectedConnection)?.hardware?.family===family);
  const seatHardware=button(hingePanel,'Seat on hinge mounts',()=>invoke('seatHinge'));seatHardware.title='Place the object on the moving half and seat the fixed half on the receiver. Undo restores the previous placement.';
  button(hingePanel,'Edit axle · G / R / S',()=>invoke('editAxle'));button(hingePanel,'Edit seating',()=>invoke('editSeat'));
  button(hingePanel,'Export hinge parts…',async()=>{const packet=await invoke('exportHinge'),url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='hinge.parts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
  const hingeFile=document.createElement('input');hingeFile.type='file';hingeFile.hidden=true;hingeFile.accept='.json';hingeFile.onchange=async()=>{try{if(hingeFile.files[0])await invoke('importHinge',{packet:JSON.parse(await hingeFile.files[0].text())});}catch(e){status.textContent=e.message;}finally{hingeFile.value='';}};hingePanel.append(hingeFile);button(hingePanel,'Return hinge parts…',()=>hingeFile.click());
  const numerics=[];
  const number=(parent,label,readValue,writeValue,step)=>{const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');row.style.cssText='display:flex;gap:10px;align-items:center;justify-content:space-between;margin:8px 0';grip.textContent=label;input.type='number';input.step='any';input.className='transform-input';input.style.width='85px';input.setAttribute('aria-label',label);input.oninput=()=>{if(input.value.trim())Promise.resolve(writeValue(Number(input.value))).catch(e=>status.textContent=e.message);};fields.push(host.controls.installNumberDrag({input,grip,step}));row.append(grip,input);parent.append(row);numerics.push({input,readValue});return input;};
  number(properties,'Cycle seconds',()=>model.period,v=>invoke('period',{seconds:v}),.1);
  number(properties,'Phase offset',()=>model.phase??0,v=>invoke('phase',{value:v}),.01);
  const play=button(transport,'Play',()=>invoke(playing?'pause':'play'),()=>playing);button(transport,'Return to pose',()=>invoke('reset'));
  number(transport,'Cycle position',()=>cycle,v=>invoke('seek',{cycle:v}),.01);
  const mountingDetails=document.createElement('details'),mountingSummary=document.createElement('summary');mountingSummary.textContent='Mounting points · advanced';mountingDetails.append(mountingSummary);properties.append(mountingDetails);const mountSection=document.createElement('section');mountingDetails.append(mountSection);
  button(mountSection,'Place mounting point',()=>invoke('tool',{value:'mount'}));
  const mountOwner=document.createElement('select');mountOwner.setAttribute('aria-label','Mount owner');mountSection.append(mountOwner);
  button(mountSection,'Add mount',()=>invoke('mount',mountOwner.value?{objectId:mountOwner.value}:{joint:selected}));
  const mountChoices=document.createElement('select');mountChoices.setAttribute('aria-label','Selected mount');mountChoices.onchange=()=>invoke('selectMount',{id:mountChoices.value});mountSection.append(mountChoices);
  const destination=document.createElement('select');destination.setAttribute('aria-label','Destination mount');mountSection.append(destination);
  button(mountSection,'Snap to mount',()=>invoke('snap',{target:destination.value}));button(mountSection,'Preview fastening',()=>invoke('previewFasten',{target:destination.value}));button(mountSection,'Piston to mount',()=>invoke('mountPiston',{target:destination.value}));
  for(const select of [mountOwner,mountChoices,destination])select.style.cssText='display:block;width:100%;box-sizing:border-box;background:#24272b;color:#ddd;border:1px solid #555;padding:5px;margin:4px 0';
  const travelLabel=document.createElement('label'),travelToggle=document.createElement('input');travelToggle.type='checkbox';travelToggle.onchange=()=>invoke('previewTravel',{enabled:travelToggle.checked});travelLabel.append(travelToggle,' Preview piston travel');mountSection.append(travelLabel);
  const mountInfo=document.createElement('p');mountInfo.style.fontSize='12px';mountSection.append(mountInfo);let mountKey='',ownerKey='';
  const attachmentTitle=document.createElement('h4');attachmentTitle.textContent='Attach at selected joint';mountingDetails.append(attachmentTitle);
  const choices=document.createElement('select');choices.setAttribute('aria-label','Object to attach');choices.style.cssText='max-width:100%;background:#24272b;color:#ddd;border:1px solid #555;padding:5px';mountingDetails.append(choices);
  button(mountingDetails,'Attach object',()=>invoke('attach',{objectId:choices.value}));
  const attached=document.createElement('div');mountingDetails.append(attached);let choiceKey='',attachedKey='';
  button(properties,'Save scene…',()=>win.saveScene());button(properties,'Open saved scene…',()=>win.openSavedScene());
  if(win.kaminosMechanisms)button(properties,'Add another mechanism',()=>win.kaminosMechanisms.add());
  const bodyDetails=document.createElement('details'),bodySummary=document.createElement('summary');bodySummary.textContent='Bodies & motion space';bodyDetails.append(bodySummary);properties.append(bodyDetails);
  button(bodyDetails,'Mirror shapes',()=>invoke('tool',{value:'mirror'}),()=>tool==='mirror');
  const mirrorActions=document.createElement('div');bodyDetails.append(mirrorActions);button(mirrorActions,'Place / select mirror plane',()=>invoke('mirrorPlane'));button(mirrorActions,'Copy shapes across plane',()=>invoke('mirrorCopy'));
  button(bodyDetails,'Reserve motion space',()=>invoke('motionSpace'));
  button(bodyDetails,'Export motion guide…',async()=>{const packet=await invoke('exportMotionSpace'),url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='mechanism.motion-space.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
  button(bodyDetails,'Export body geometry…',async()=>{const packet=await invoke('exportBodies'),url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='mechanism.bodies.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
  const geometryFile=document.createElement('input');geometryFile.type='file';geometryFile.accept='.json';geometryFile.hidden=true;geometryFile.setAttribute('aria-label','Replace body geometry');geometryFile.onchange=async()=>{try{if(geometryFile.files[0])await invoke('importBodies',JSON.parse(await geometryFile.files[0].text()));}catch(e){status.textContent=e.message;}finally{geometryFile.value='';}};button(bodyDetails,'Replace body geometry…',()=>geometryFile.click());bodyDetails.append(geometryFile);
  const extras=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Recipe import / export';extras.append(summary);properties.append(extras);
  button(extras,'Export JSON…',async()=>{const recipe=await invoke('snapshot'),url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='mechanism.links.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
  const file=document.createElement('input');file.type='file';file.accept='.json';file.hidden=true;file.setAttribute('aria-label','Import mechanism');file.onchange=async()=>{try{if(file.files[0])await invoke('restore',JSON.parse(await file.files[0].text()));}catch(e){status.textContent=e.message;}finally{file.value='';}};button(extras,'Import JSON…',()=>file.click());extras.append(file);properties.append(status);
  refresh=()=>{
   draftBar.style.display=connectionDraft?'':'none';alternatives.style.display=connectionDraft?.ends.length===2?'':'none';commitDraft.style.display=connectionDraft?.ends.length===2?'':'none';commitDraft.disabled=!connectionDraft?.kind;
   const ends=connectionDraft?.ends??[],needsObject=ends.length===2&&!ends[0].owner.objectId;
   fastenChoice.disabled=hingeChoice.disabled=needsObject;
   const restriction=needsObject?(ends[1]?.owner.objectId?'Pick the separate object first, then the link or surface it should follow.':'Fastening or hinging two links is not supported yet. Pick a separate object first.'):'';
   setText(unavailable,restriction);unavailable.hidden=!restriction;fastenChoice.title=hingeChoice.title=restriction;fastenChoice.style.opacity=hingeChoice.style.opacity=needsObject?'.45':'';
   setText(commitDraft,connectionDraft?.kind==='piston'?'Create this piston':connectionDraft?.kind==='hinge'?'Hinge here':connectionDraft?.kind==='fasten'?'Fasten here':'Choose a connection');
   setText(draftText,connectionDraft?.error??(ends.length===0?'1 · Click a surface on the object to connect, or a joint for a piston.':ends.length===1?`1 · ${ends[0].label} picked. Now click the receiving surface or joint.`:connectionDraft.kind==='fasten'?`${ends[0].label} moves to ${ends[1].label} and follows it. The ghost shows where.`:connectionDraft.kind==='hinge'?`${ends[0].label} seats on ${ends[1].label} and hinges around its contact normal in Pose A / B.`:connectionDraft.kind==='piston'?`A piston spans ${ends[0].label} and ${ends[1].label}. Both objects stay in place.`:`${ends[0].label} → ${ends[1].label}. Choose what connects them.`));
   const bindings=(model.attachments??[]).filter(a=>a.targetMount),pickerKey=JSON.stringify(bindings.map(a=>[a.objectId,a.targetMount,Array.isArray(a.hinge),objects().find(e=>e.id===a.objectId)?.label,model.mounts.find(m=>m.id===a.targetMount)?.label]));
   if(pickerKey!==connectionPickerKey){connectionPickerKey=pickerKey;replace(connectionPicker);for(const a of bindings){const b=document.createElement('button');b.className='btn';b.style.margin='3px';b.textContent=`${objects().find(e=>e.id===a.objectId)?.label??'Object'} ${Array.isArray(a.hinge)?'⟳':'↔'} ${model.mounts.find(m=>m.id===a.targetMount)?.label??'Receiving mount'}`;b.onclick=()=>invoke('selectConnection',{objectId:a.objectId}).then(()=>{host.scene.select?.(asset.id);seat.enter?.();}).catch(e=>status.textContent=e.message);connectionPicker.append(b);}}
   connectionPicker.hidden=!!editingConnection||!!connectionDraft||!bindings.length;
   editConnection.style.display=selectedConnection&&!editingConnection?'':'none';leaveConnection.style.display=editingConnection?'':'none';
   connectionBar.hidden=!seatingPreview&&!selectedConnection;connectionBar.style.display=connectionBar.hidden?'none':'flex';confirm.style.display=cancel.style.display=seatingPreview?'':'none';release.style.display=selectedConnection?'':'none';clean.textContent=showOverlays?'Hide editing marks':'Show editing marks';
   const activeBinding=model.attachments?.find(a=>a.objectId===selectedConnection);hingePanel.hidden=!activeBinding?.hinge;seatHardware.hidden=!activeBinding?.hardware||activeBinding.hardware.mounting==='part-frames';seatHardware.style.display=seatHardware.hidden?'none':'';
   const payload=objects().find(e=>e.id===(seatingPreview?.objectId??selectedConnection));contactLegend.textContent=selectedConnection?(activeBinding?.hardware?'Cyan: fixed hinge mount · Amber: moving hinge mount · Violet: axle':'Amber: moving contact · Cyan: receiving plane · Guide extent is not a surface boundary'):'';contactLegend.hidden=!selectedConnection;connectionText.textContent=seatingPreview?`Preview: ${payload?.label??'Object'} will move here${seatingPreview.moving.length>1?' with '+(seatingPreview.moving.length-1)+' attached objects':''}`:selectedConnection?`${editingConnection?(Array.isArray(activeBinding?.hinge)?`Hinge (${mode==='build'?'Build':`Pose ${mode}`}): `:'Seating: '):''}${payload?.label??'Object'} ${Array.isArray(activeBinding?.hinge)?'⟳':'↔'} ${model.mounts?.find(m=>m.id===activeBinding?.targetMount)?.label??'Receiving mount'}`:'';
   const manifest=view.bodyManifest();
   status.textContent=`${tool==='mirror'?mirror.state().selected.length+' bodies chosen · ':''}${playing?'Playing':editing?'Editing':'Tab to edit'} · ${model.nodes.filter(n=>n.parent!==null).length} links · ${model.pistons.length} pistons${selectedPiston?' · Piston '+(selectedPiston.index+1):selectedMount?' · Mount':selected>=0?' · Joint '+(selected+1):''}${manifest.replacements?' · '+manifest.replacements+' returned bodies':''}${manifest.warnings.length?' · '+manifest.warnings.join(' '):''}`;
   hint.textContent=editingAxle?'AXLE · G moves pivot · R turns axis · S sizes hardware · Edit seating returns':editingConnection?(Array.isArray(activeBinding?.hinge)?`G slides on the contact plane · R sets ${mode==='build'?'base seating':'Pose '+mode+' hinge angle'} · Tab returns · Esc cancels`:'G slides on the mounting plane · R turns about its normal · Tab returns · Esc cancels a drag'):selectedConnection?'Both contact frames are highlighted · Tab edits seating · Ctrl-Tab leaves this level':connectionDraft?'Numbered ends mark your picks · Esc cancels':seatingPreview?'Translucent copy shows the seating · Fasten here commits · Esc cancels':connectionStart?'Choose destination mount · Esc cancels':tool==='mount'?'Tab to edit · Click a link or object to place a mount':(['snap','fasten','mount-piston'].includes(tool)?'Tab to edit · Choose source mount, then destination':null)??(pistonStart!==null?'Choose the second joint · Esc cancels':!editing?'Tab enters joint editing':mode!=='build'?'G / R pose the selected link or hinged connection · lengths stay fixed':tool==='draw'?'Click to extend · click a joint to branch · Shift-click a new anchor':tool==='piston'?'Click two joints to connect a piston':'Select a joint, mount or piston · Delete removes · ⌘/Ctrl Z undo · Shift ⌘/Ctrl Z redo');
   if(editingAxle)connectionText.textContent='Axle: '+(payload?.label??'Object');
   const infoBar=document.getElementById?.('info-bar');if(infoBar&&(editing||selectedConnection||connectionDraft||seatingPreview)&&!edits.state().active)infoBar.textContent=hint.textContent;
   const motion=hasMotion();
   tools.hidden=!!editingConnection||(motion&&mode!=='build');tools.style.display=tools.hidden?'none':'flex';
   modes.hidden=!!connectionDraft||!motion;modes.style.display=modes.hidden?'none':'flex';
   transport.hidden=!motion||!!connectionDraft;transport.style.display=transport.hidden?'none':'flex';
   mirrorActions.hidden=tool!=='mirror';
   play.textContent=playing?'Pause':'Play';
   for(const {input,readValue}of numerics)if(document.activeElement!==input||input.readOnly)input.value=String(Math.round(readValue()*10000)/10000);
   for(const {b,active}of buttons){b.style.background=active?.()?'#387f88':'';if(active)b.setAttribute('aria-pressed',String(!!active()));}
   const entries=objects();
   const owners=entries.filter(e=>e.object!==root&&['glb','pbr','procedural-mesh'].includes(e.type)),ok=JSON.stringify(owners.map(e=>[e.id,e.label]));if(ok!==ownerKey){ownerKey=ok;const old=mountOwner.value;replace(mountOwner,opt('Selected joint / link',''),...owners.map(e=>opt((e.label??e.id)+(e.object.userData.linkMechanism?' (root)':''),e.id)));mountOwner.value=owners.some(e=>e.id===old)?old:'';}
   const mk=JSON.stringify((model.mounts??[]).map(m=>[m.id,m.label,m.owner]));if(mk!==mountKey){mountKey=mk;const old=destination.value;for(const select of [mountChoices,destination])replace(select,...(model.mounts??[]).map(m=>opt(`${m.label??'Mount'} · ${m.owner.joint!==undefined?'link '+(m.owner.joint+1):(entries.find(e=>e.id===m.owner.objectId)?.label??'missing object')}`,m.id)));if(model.mounts?.some(m=>m.id===old))destination.value=old;}
   if(selectedMount)mountChoices.value=selectedMount;mountInfo.textContent=mountStatus.errors.join(' · ')||('Tab: edit mounts with G / R. '+mountStatus.lengths.map(p=>`Piston ${p.length.toFixed(2)}${p.overtravel?' — barrel overlaps endpoint':''}`).join(' · '));
   const available=entries.filter(e=>e.object!==root&&['glb','pbr','procedural-mesh'].includes(e.type)&&!entries.some(m=>m.object?.userData.linkMechanism?.attachments?.some(a=>a.objectId===e.id)));
   const key=JSON.stringify(available.map(e=>[e.id,e.label]));if(key!==choiceKey){choiceKey=key;const old=choices.value;replace(choices);choices.disabled=!available.length;if(!available.length){const option=document.createElement("option");option.textContent="Add a mesh to attach";choices.append(option);}for(const e of available){const option=document.createElement('option');option.value=e.id;option.textContent=e.label??e.id;choices.append(option);}if(available.some(e=>e.id===old))choices.value=old;}
   const attachedEntries=(model.attachments??[]).map(a=>({...a,entry:entries.find(e=>e.id===a.objectId)})),ak=JSON.stringify([model.mounts,attachedEntries.map(a=>[a.objectId,a.joint,Array.isArray(a.hinge),a.entry?.label,!!a.entry]),mirror?.state().planeObjectId]);
   if(ak!==attachedKey){attachedKey=ak;replace(attached);const mirrorAsset=mirror?.state().planeObjectId?relatedAssets.find(r=>r.id===mirror.state().planeObjectId):null;relatedAssets.splice(0,relatedAssets.length,...(mirrorAsset?[mirrorAsset]:[]),...entries.filter(e=>e.object!==root&&!e.object.userData.linkMechanism&&(model.mounts??[]).some(m=>m.owner.objectId===e.id)).map(e=>({id:e.id,root:e.object})));for(const a of attachedEntries){const row=document.createElement('div');row.style.margin='6px 0';const select=document.createElement('button');select.className='btn';select.textContent=(a.entry?.label??'Missing object: '+a.objectId)+(a.targetMount?(Array.isArray(a.hinge)?' · hinged':' · fastened'):' · joint '+(a.joint+1));select.onclick=()=>a.targetMount?invoke('selectConnection',{objectId:a.objectId}).then(()=>{host.scene.select?.(asset.id);seat.enter?.();}):host.scene.select?.(a.objectId);select.disabled=!a.entry;const detach=document.createElement('button');detach.className='btn';detach.textContent='Detach';detach.onclick=()=>invoke('detach',{objectId:a.objectId}).catch(e=>status.textContent=e.message);row.append(select,detach);attached.append(row);if(a.entry&&!a.entry.object.userData.linkMechanism)relatedAssets.push({id:a.objectId,root:a.entry.object});}}
  };
  controls=host.controls.mountObject({asset,relatedAssets,properties,playback});
  const keys=event=>{if(playback.hidden||event.defaultPrevented||event.repeat||event.target.closest?.('input,textarea,select,[contenteditable="true"]')||edits.state().active)return;if(event.code==='Space'&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();invoke(playing?'pause':'play').catch(e=>status.textContent=e.message);}else if(event.key==='Escape'&&editing){operations.cancelPreview();operations.cancelConnection();pistonStart=null;connectionStart=null;tool='select';refresh();}};
  document.addEventListener?.('keydown',keys);removeKeys=()=>document.removeEventListener?.('keydown',keys);updateGuides();refresh();

 },async dispose(){if(disposed)return;playing=false;stop();seat.dispose();connectionHistory.dispose();unsubscribe();history.dispose();follower.dispose();controls?.dispose();for(const f of fields)f.dispose();proxy.removeFromParent();disposed=true;removeKeys();await mirror?.dispose();await guide?.session.dispose();constructionGuide.dispose();await session.dispose();view.dispose();mountView.dispose();fasteningView.dispose();connectView.dispose();root.remove(editorGeometry,visual);grid.geometry.dispose();grid.material.dispose();origin.geometry.dispose();origin.material.dispose();}};
}
export default {id:'link-workshop',title:'Link workshop',async create(context){
 const service=context.host.controls.document.defaultView.kaminosMechanisms;
 if(!service||context.inputs?.bodies)return createMechanismController(context);
 const entries=context.host.scene.objects(),active=context.host.controls.document.defaultView.kaminosSelection?.read().activeId;
 const existing=!context.inputs.recipe&&(entries.find(e=>e.id===active&&e.object.userData.linkMechanism)??entries.find(e=>e.object.userData.linkMechanism));
 const runtime=existing?await service.ensure(existing.object):await service.add(context.inputs.recipe);if(existing)context.host.scene.select(existing.id);else runtime.operations.frame();return {read:runtime.read,operations:runtime.operations,mount({root}){root.textContent='Mechanisms are saved with the scene. Select one to edit its links and attachments. Closing this experiment leaves your construction in the scene.';},dispose(){}};
}};
