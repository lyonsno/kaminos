import {Group,Mesh,PlaneGeometry,BufferGeometry,BufferAttribute,MeshNormalMaterial,MeshBasicMaterial,DoubleSide,CanvasTexture,SRGBColorSpace,Quaternion,Vector3,EdgesGeometry,LineSegments,LineBasicMaterial,Sprite,SpriteMaterial} from '../lib/three.core.js';
import {projectionSupport} from './hand-replay-projection.mjs';
export function sourceStageGeometry(hand,box,span=2.5){
 const support=projectionSupport(hand);if(!support.available)throw Error(support.reason);
 const [fx,fy,cx,cy]=hand.camera.intrinsics,t=hand.camera.translation;
 const camera=hand.vertices.map(v=>v.map((x,k)=>x+t[k]));const width=box[2]-box[0],height=box[3]-box[1],extent=Math.max(width,height),u=(box[0]+box[2])/2,v=(box[1]+box[3])/2;
 const depth=Math.max(...camera.map(p=>p[2]))+.015,scale=span*fx/(extent*depth),ox=(u-cx)/fx*depth,oy=(v-cy)/fy*depth;
 const transform=p=>[(p[0]-ox)*scale,-(p[1]-oy)*scale,(depth-p[2])*scale];const wrist=transform(hand.joints[0].map((x,k)=>x+t[k]));
 return {positions:new Float32Array(camera.flatMap(p=>transform(p).map((x,k)=>x-wrist[k]))),wrist,planeSize:[span,span*fx/fy],scale,sourceCamera:[-ox*scale,oy*scale,depth*scale]};
}
export async function createHandInspection(scene,document,models,labelTexture){
 const stations=[];let data,images=[],frozen=null,index=0,locked=true,visible=false,shown=models.map(m=>m.id),source='crop';
 for(let i=0;i<models.length;i++){
  const root=new Group();const cols=Math.min(models.length,2),rows=Math.ceil(models.length/cols);root.position.set((i%cols-(cols-1)/2)*3.2,4.7+((rows-1)/2-Math.floor(i/cols))*3.3,0);root.visible=false;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=640;const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;
  const photo=new Mesh(new PlaneGeometry(1,1),new MeshBasicMaterial({map:texture,side:DoubleSide,toneMapped:false}));root.add(photo);
  const edge=new LineSegments(new EdgesGeometry(photo.geometry),new LineBasicMaterial({color:0x9cafc4}));root.add(edge);
  const pivot=new Group(),mesh=new Mesh(new BufferGeometry(),new MeshNormalMaterial({side:DoubleSide}));pivot.add(mesh);root.add(pivot);
  const title=new Sprite(new SpriteMaterial({map:labelTexture(models[i].label),depthTest:false}));title.position.set(0,1.62,.1);title.scale.set(2.7,.34,1);root.add(title);
  await scene.attach(root,{owned:true,metadata:{label:models[i].label+' · camera plane',type:'hand-source-camera-station',source:models[i]}});
  stations.push({root,canvas,texture,photo,edge,pivot,mesh,title});
 }
 const read=()=>({locked,frozen:frozen!==null,meshFrame:frozen??index,imageFrame:index,rotations:stations.map(s=>s.pivot.quaternion.toArray()),visible,placement:'True camera-space meshes in front of fixed photograph planes. A shared overview has different parallax from each source camera; exact alignment is available in Recorded camera silhouettes.'});
 const draw=(nextIndex,nextVisible=visible,sourceMode=source,visibleModels=shown)=>{
  index=nextIndex;visible=nextVisible;shown=visibleModels;source=sourceMode;
  if(!data){stations.forEach(s=>s.root.visible=false);return;}
  const photoRow=data.frames[index],meshRow=data.frames[frozen??index];
  for(let i=0;i<stations.length;i++){
   const s=stations[i],hand=meshRow.hands[i];s.root.visible=visible&&shown.includes(models[i].id);if(!s.root.visible)continue;
   const im=images[index],size=[im.naturalWidth??im.width,im.naturalHeight??im.height],box=source==='crop'?(hand.cropBox??[0,0,...size]):[0,0,...size],w=box[2]-box[0],h=box[3]-box[1],fit=640/Math.max(w,h),ctx=s.canvas.getContext('2d');ctx.fillStyle='#303844';ctx.fillRect(0,0,640,640);ctx.drawImage(im,(640-w*fit)/2-box[0]*fit,(640-h*fit)/2-box[1]*fit,...size.map(x=>x*fit));s.texture.needsUpdate=true;
   const supported=projectionSupport(hand);s.mesh.visible=supported.available;if(!supported.available)continue;
   const geometry=sourceStageGeometry(hand,box);s.pivot.position.fromArray(geometry.wrist);s.mesh.geometry.setAttribute('position',new BufferAttribute(geometry.positions,3));s.mesh.geometry.setIndex(models[i].faces.flat());s.mesh.geometry.computeVertexNormals();s.mesh.geometry.computeBoundingSphere();s.photo.scale.set(...geometry.planeSize,1);s.edge.scale.copy(s.photo.scale);
  }
 };
 const reset=target=>{if(target===undefined)stations.forEach(s=>s.pivot.quaternion.identity());else{if(!Number.isInteger(target)||!stations[target])throw Error('unknown hand');stations[target].pivot.quaternion.identity();}scene.redraw();return read();};
 return {read,draw,load(next,nextImages){data=next;images=nextImages;frozen=null;},clear(){data=null;frozen=null;stations.forEach(s=>s.root.visible=false);},lock(value){locked=!!value;if(locked)reset();return read();},freeze(value){frozen=value?index:null;return read();},reset,rotate({dx,dy}){if(locked)throw Error('hands locked');if(!Number.isFinite(dx)||!Number.isFinite(dy))throw Error('invalid rotation');const view=scene.readView(),forward=new Vector3().fromArray(view.position??[0,0,10]).sub(new Vector3().fromArray(view.target??[0,0,0])).normalize(),up=new Vector3().fromArray(view.up??[0,1,0]),right=new Vector3().crossVectors(up,forward).normalize();up.crossVectors(forward,right).normalize();const q=new Quaternion().setFromAxisAngle(up,dx*.008).multiply(new Quaternion().setFromAxisAngle(right,dy*.008));stations.forEach(s=>s.pivot.quaternion.premultiply(q));scene.redraw();return read();},dispose(){for(const s of stations){s.texture.dispose();s.photo.geometry.dispose();s.photo.material.dispose();s.edge.geometry.dispose();s.edge.material.dispose();s.mesh.geometry.dispose();s.mesh.material.dispose();s.title.material.map.dispose();s.title.material.dispose();}}};
}
export function mountInspectionControls(document,invoke,read){
 const viewport=document.querySelector?.('#viewport');if(!viewport)return {sync(){},dispose(){}};
 const toolbar=document.createElement('div');toolbar.dataset.handInspection='toolbar';toolbar.style.cssText='position:absolute;z-index:15;top:18px;left:50%;transform:translateX(-50%);width:780px;max-width:calc(100% - 36px);display:flex;flex-wrap:wrap;justify-content:center;gap:8px;padding:12px;border:1px solid #718391;border-radius:14px;background:#14202de8;box-shadow:0 8px 30px #0005;backdrop-filter:blur(12px)';
 const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.style.cssText='padding:11px 16px;border:1px solid #8297a6;border-radius:8px;color:#f4f8ff;background:#30495c;font:600 14px system-ui;cursor:pointer';b.onclick=fn;toolbar.append(b);return b;};
 const call=(op,arg)=>Promise.resolve(invoke(op,arg)).catch(e=>{status.textContent=String(e);});
 const lock=button('Unlock hands',()=>call('setProjectionLocked',!read().inspection.locked));lock.style.background='#176c83';
 button('Snap all hands',()=>call('snapHands'));const freeze=button('Freeze pose',()=>call('setMeshFrozen',!read().inspection.frozen));button('Exact overlays',()=>call('setViewMode','camera'));
 const individual=document.createElement('div');individual.style.cssText='display:flex;gap:6px;justify-content:center;flex-wrap:wrap;width:100%';toolbar.append(individual);const status=document.createElement('small');status.style.cssText='width:100%;text-align:center;color:#c1d2de';toolbar.append(status);
 const ball=document.createElement('button');ball.type='button';ball.setAttribute('aria-label','Rotate all hands');ball.style.cssText='position:absolute;z-index:15;top:50%;left:50%;transform:translate(-50%,-50%);width:82px;height:82px;border-radius:50%;border:2px solid #aac9dd;color:white;background:radial-gradient(circle at 32% 28%,#92b8ce,#284c64 60%,#102735);box-shadow:0 6px 25px #0006;touch-action:none;cursor:grab;font:600 12px system-ui';ball.textContent='Drag to\nrotate hands';ball.style.whiteSpace='pre-line';
 let drag=null;ball.onpointerdown=e=>{e.preventDefault();e.stopPropagation();if(read().inspection.locked)return;drag=[e.clientX,e.clientY];ball.setPointerCapture(e.pointerId);};ball.onpointermove=e=>{if(!drag)return;e.preventDefault();e.stopPropagation();const delta={dx:e.clientX-drag[0],dy:e.clientY-drag[1]};drag=[e.clientX,e.clientY];void call('rotateHands',delta);};const end=e=>{if(drag){e.preventDefault();e.stopPropagation();drag=null;}if(ball.hasPointerCapture?.(e.pointerId))ball.releasePointerCapture(e.pointerId);};ball.onpointerup=end;ball.onpointercancel=end;
 for(const node of [toolbar,ball])for(const type of ['pointerdown','wheel','dblclick'])node.addEventListener(type,e=>e.stopPropagation());viewport.append(toolbar,ball);let signature='';
 return {sync(){const s=read(),v=s.viewMode==='inspection';toolbar.hidden=ball.hidden=!v;toolbar.style.display=v?'flex':'none';if(!v)return;lock.textContent=s.inspection.locked?'Unlock hands':'Lock to camera planes';lock.setAttribute('aria-pressed',String(s.inspection.locked));ball.disabled=s.inspection.locked;ball.style.opacity=s.inspection.locked?'.45':'1';freeze.textContent=s.inspection.frozen?'Resume pose':'Freeze pose';status.textContent=s.inspection.frozen?`Hand held at frame ${s.inspection.meshFrame+1} · image frame ${s.inspection.imageFrame+1}`:'Orbit the viewport · unlock, then drag the sphere to turn every hand';const sig=JSON.stringify(s.models.map(m=>m.label));if(sig!==signature){signature=sig;individual.replaceChildren();s.models.forEach((m,i)=>{const b=document.createElement('button');b.type='button';b.textContent='Snap '+m.label;b.style.cssText='padding:6px 10px;border:1px solid #647b8c;border-radius:6px;background:#223747;color:#d7e8f2;font:12px system-ui;cursor:pointer';b.onclick=()=>call('snapHand',i);individual.append(b);});}},dispose(){drag=null;toolbar.remove();ball.remove();}};
}
