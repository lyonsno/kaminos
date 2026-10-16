import {BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
 Mesh, MeshBasicMaterial, RingGeometry, TorusGeometry, Vector3} from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';

// Presentation adapter for the pinned Three r171 controller. Keep its drag plane,
// transforms, snapping and events; replace the crowd of opposing grips and the
// overlapping invisible 3D pick cones. The npm and page addon share this version.
const colors={X:0xe45c70,Y:0x83c65b,Z:0x5799f0,XY:0x5799f0,YZ:0xe45c70,XZ:0x83c65b,XYZ:0xe8e8e8,XYZE:0xb9b9b9,E:0xe8e8e8};
const axes={X:[1,0,0],Y:[0,1,0],Z:[0,0,1]};
const planeAxes={XY:[0,1],YZ:[1,2],XZ:[0,2]};
const point=(axis,t)=>axes[axis].map(v=>v*t);
function material(name,opacity=1){return new MeshBasicMaterial({color:colors[name],opacity,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,fog:false,side:DoubleSide});}
function orient(geometry,axis){if(axis==='X')geometry.rotateZ(-Math.PI/2);if(axis==='Z')geometry.rotateX(Math.PI/2);return geometry;}
function handle(name,geometry,path,{closed=false,fill=false,hull=false,margin=7,opacity=1,priority=1}={}){
 const mesh=new Mesh(geometry,material(name,opacity));mesh.name=name;mesh.renderOrder=Infinity;
 mesh.userData.grip={path,closed,fill,hull,margin,priority,opacity,samples:new Float64Array(path.length*2)};
 return mesh;
}
function axisGrips(mode,axis){
 const shaft=orient(new CylinderGeometry(.006,.006,.38,8).translate(0,.31,0),axis);
 const tip=mode==='translate'?orient(new CylinderGeometry(0,.036,.12,16).translate(0,.56,0),axis):orient(new BoxGeometry(.075,.075,.075).translate(0,.56,0),axis);
 const direction=new Vector3(...axes[axis]),side=new Vector3(...axes[axis==='X'?'Y':'X']),up=new Vector3().crossVectors(direction,side);
 const outline=mode==='translate'?[point(axis,.62),...Array.from({length:16},(_,i)=>direction.clone().multiplyScalar(.50).addScaledVector(side,.036*Math.cos(i*Math.PI/8)).addScaledVector(up,.036*Math.sin(i*Math.PI/8)).toArray())]:[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>[x,y,z].map((v,i)=>v*.0375+(i==='XYZ'.indexOf(axis)?.56:0)))));
 return [handle(axis,shaft,[point(axis,.12),point(axis,.50)]),handle(axis,tip,outline,{closed:true,fill:true,hull:true})];
}
function planeGrip(name){
 const [a,b]=planeAxes[name],path=[[.23,.23],[.35,.23],[.35,.35],[.23,.35]].map(([x,y])=>{const p=[0,0,0];p[a]=x;p[b]=y;return p;});
 const geometry=new BufferGeometry(),triangles=[0,1,2,0,2,3].flatMap(i=>path[i]);geometry.setAttribute('position',new Float32BufferAttribute(triangles,3));
 return handle(name,geometry,path,{closed:true,fill:true,margin:3,opacity:.28,priority:2});
}
function circle(radius,axis='Z',arc=Math.PI*2){
 // X/Y/Z ring orientation matches r171's camera-facing half-ring update.
 const map=([x,y])=>axis==='X'?[0,y,-x]:axis==='Y'?[x,0,y]:[x,y,0];
 return Array.from({length:65},(_,i)=>map([Math.cos(i/64*arc)*radius,Math.sin(i/64*arc)*radius]));
}
function ring(name,radius,arc=Math.PI*2){
 const geometry=new TorusGeometry(radius,.006,6,64,arc),axis=['X','Y','Z'].includes(name)?name:'Z';
 if(axis==='X')geometry.rotateY(Math.PI/2);if(axis==='Y')geometry.rotateX(Math.PI/2);
 return handle(name,geometry,circle(radius,axis,arc),{closed:arc===Math.PI*2,margin:7});
}
function center(name){return handle(name,new RingGeometry(.052,.068,32),circle(.068),{closed:true,fill:true,margin:2,priority:0});}
function distanceToSegment(x,y,ax,ay,bx,by){
 const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
 return Math.hypot(x-ax-t*dx,y-ay-t*dy);
}
function distanceToGrip(x,y,samples,closed,fill){
 let distance=Infinity,inside=false;const n=samples.length/2;
 for(let i=0,j=n-1;i<n;j=i++){
  const ax=samples[j*2],ay=samples[j*2+1],bx=samples[i*2],by=samples[i*2+1];
  if(i>0||closed)distance=Math.min(distance,distanceToSegment(x,y,ax,ay,bx,by));
  if(fill&&((ay>y)!==(by>y))&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
 }
 return inside?0:distance;
}
function convexHull(samples){
 const points=Array.from({length:samples.length/2},(_,i)=>[samples[i*2],samples[i*2+1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const half=points=>{const out=[];for(const p of points){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out;};
 return [...half(points).slice(0,-1),...half([...points].reverse()).slice(0,-1)].flat();
}

export class SceneTransformControls extends TransformControls {
 constructor(camera,canvas=null){
  super(camera,null);
  if(!this._gizmo?.gizmo?.translate||!this._gizmo?.picker?.rotate)throw Error('Kaminos gizmo requires the pinned Three r171 handle layout');
  for(const mode of ['translate','scale']){
   const group=this._gizmo.gizmo[mode];
   for(const child of [...group.children]){group.remove(child);child.geometry.dispose();}
   group.add(...Object.keys(axes).flatMap(axis=>axisGrips(mode,axis)),...Object.keys(planeAxes).map(planeGrip),center('XYZ'));
  }
  const rotate=this._gizmo.gizmo.rotate;
  for(const child of [...rotate.children]){rotate.remove(child);child.geometry.dispose();}
  rotate.add(ring('X',.5,Math.PI),ring('Y',.5,Math.PI),ring('Z',.5,Math.PI),ring('E',.67),center('XYZE'));
  const update=this._gizmo.updateMatrixWorld.bind(this._gizmo);
  this._gizmo.updateMatrixWorld=force=>{
   update(force);
   for(const grip of this._gizmo.gizmo[this.mode].children){
    const settings=grip.userData.grip;
    if(grip.name==='XYZ'||grip.name==='XYZE'){grip.quaternion.copy(this.cameraQuaternion);grip.updateMatrixWorld(force);}
    const active=grip.name===this.axis;
    grip.material.color.setHex(active?0xffffff:colors[grip.name]);grip.material.opacity=active?1:settings.opacity;
   }
   this._paintOverlay();
  };
  this._pickPoint=new Vector3();
  const down=this._onPointerDown;
  this._onPointerDown=event=>{
   if(!this.enabled||event.button!==0)return;
   this.pointerHover(this._getPointer(event));
   // Ordinary scene clicks must not be captured by a gizmo they missed.
   if(this.axis!==null)down(event);
  };
  if(canvas){
   this.domElement=canvas;
   // This is an editor layer, above the native volume canvas. It borrows the
   // existing helper's camera updates; there is no renderer or RAF of its own.
   if(canvas.parentElement&&canvas.ownerDocument?.createElement){
    this._overlay=canvas.ownerDocument.createElement('canvas');
    this._overlay.id='transform-gizmo-overlay';this._overlay.setAttribute('aria-hidden','true');
    Object.assign(this._overlay.style,{position:'absolute',pointerEvents:'none',zIndex:'8',overflow:'hidden'});
    canvas.parentElement.append(this._overlay);
    for(const group of Object.values(this._gizmo.gizmo))for(const grip of group.children)grip.material.visible=false;
   }
   this.connect();
  }
 }

 _projectedGrips(rect){
  const key=[this.mode,this.space,this.size,this.showX,this.showY,this.showZ,rect.width,rect.height,...this.camera.projectionMatrix.elements,...this.camera.matrixWorldInverse.elements,...this.object.matrixWorld.elements].join(',');
  if(key===this._projectionKey)return this._projections;
  this._projectionKey=key;const result=[];
  for(const grip of this._gizmo.gizmo[this.mode].children){
   if(!grip.visible)continue;
   const settings=grip.userData.grip;let clipped=false;
   for(let i=0;i<settings.path.length;i++){
    const p=this._pickPoint.fromArray(settings.path[i]).applyMatrix4(grip.matrixWorld).project(this.camera);
    if(!Number.isFinite(p.x+p.y+p.z)||p.z<-1||p.z>1){clipped=true;break;}
    settings.samples[i*2]=(p.x+1)*rect.width/2;settings.samples[i*2+1]=(1-p.y)*rect.height/2;
   }
   if(!clipped)result.push({grip,points:settings.hull?convexHull(settings.samples):settings.samples});
  }
  return this._projections=result;
 }

 _paintOverlay(){
  if(!this._overlay)return;
  const visible=!!(this.enabled&&this.object&&this.getHelper().visible);
  this._overlay.style.display=visible?'block':'none';if(!visible)return;
  const rect=this.domElement.getBoundingClientRect(),parent=this.domElement.parentElement.getBoundingClientRect();
  if(!(rect.width>0&&rect.height>0))return;
  const layout=[rect.left-parent.left,rect.top-parent.top,rect.width,rect.height].join(',');
  const width=this.domElement.width||Math.round(rect.width),height=this.domElement.height||Math.round(rect.height);
  if(layout!==this._overlayLayout||this._overlay.width!==width||this._overlay.height!==height){
   this._overlayLayout=layout;Object.assign(this._overlay.style,{left:(rect.left-parent.left)+'px',top:(rect.top-parent.top)+'px',width:rect.width+'px',height:rect.height+'px'});
   this._overlay.width=width;this._overlay.height=height;this._overlayPaths=null;
  }
  const paths=this._projectedGrips(rect).map(({grip,points})=>{
   const {closed,fill,opacity}=grip.userData.grip,active=grip.name===this.axis;
   return {points:[...points],closed,fill:fill&&grip.name!=='XYZ'&&grip.name!=='XYZE',color:active?'#ffffff':'#'+grip.material.color.getHexString(),opacity:active?Math.max(.55,opacity):opacity,width:active?2.5:1.8};
  });
  const key=JSON.stringify(paths);if(key===this._overlayPaths)return;this._overlayPaths=key;
  const context=this._overlay.getContext('2d');context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,width,height);context.setTransform(width/rect.width,0,0,height/rect.height,0,0);context.lineJoin='round';
  for(const path of paths){
   context.beginPath();for(let i=0;i<path.points.length;i+=2)if(i)context.lineTo(path.points[i],path.points[i+1]);else context.moveTo(path.points[i],path.points[i+1]);
   if(path.closed)context.closePath();
   if(path.fill){context.globalAlpha=path.opacity;context.fillStyle=path.color;context.fill();}
   context.globalAlpha=1;context.strokeStyle=path.color;context.lineWidth=path.width;context.stroke();
  }
 }

 getOverlay(){return this._overlay??null;}
 dispose(){this._overlay?.remove();super.dispose();}

 pointerHover(pointer){
  if(this.dragging)return;
  if(!this.enabled||!this.object||!this.getHelper().visible||!pointer){this.axis=null;return;}
  const rect=this.domElement?.getBoundingClientRect();
  if(!(rect?.width>0&&rect?.height>0)){this.axis=null;return;}
  // Picking sees the latest camera/target even before the next render frame.
  this.getHelper().updateMatrixWorld(true);
  const x=(pointer.x+1)*rect.width/2,y=(1-pointer.y)*rect.height/2;let best=null;
  for(const {grip,points} of this._projectedGrips(rect)){
   const {closed,fill,margin,priority}=grip.userData.grip;
   const distance=distanceToGrip(x,y,points,closed,fill);
   if(distance<=margin&&(!best||distance<best.distance-1e-5||(Math.abs(distance-best.distance)<1e-5&&priority<best.priority)))best={axis:grip.name,distance,priority};
  }
  this.axis=best?.axis??null;
  this._paintOverlay();
 }
}
