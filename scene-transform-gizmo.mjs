import {BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
 Mesh, MeshBasicMaterial, Raycaster, RingGeometry, TorusGeometry, Vector3} from 'three';
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
function handle(name,geometry,path,{closed=false,fill=false,margin=7,opacity=1,priority=1}={}){
 const mesh=new Mesh(geometry,material(name,opacity));mesh.name=name;mesh.renderOrder=Infinity;
 mesh.userData.grip={path,closed,fill,margin,priority,opacity,samples:new Float64Array(path.length*2)};
 return mesh;
}
function axisGrips(mode,axis){
 const shaft=orient(new CylinderGeometry(.006,.006,.38,8).translate(0,.31,0),axis);
 const tip=mode==='translate'?orient(new CylinderGeometry(0,.036,.12,16).translate(0,.56,0),axis):orient(new BoxGeometry(.075,.075,.075).translate(0,.56,0),axis);
 const direction=new Vector3(...axes[axis]),side=new Vector3(...axes[axis==='X'?'Y':'X']);
 const outline=mode==='translate'?[direction.clone().multiplyScalar(.62).toArray(),direction.clone().multiplyScalar(.50).addScaledVector(side,.036).toArray(),direction.clone().multiplyScalar(.50).addScaledVector(side,-.036).toArray()]:[.52,.60].flatMap(t=>[-.04,.04].map(s=>direction.clone().multiplyScalar(t).addScaledVector(side,s).toArray()));
 // Tip outline for distance/containment follows the visible grip, not a cone
 // extending over nearby scene objects. The shaft itself has a pixel margin.
 if(mode==='scale')outline.splice(2,2,outline[3],outline[2]);
 return [handle(axis,shaft,[point(axis,.12),point(axis,.50)]),handle(axis,tip,outline,{closed:true,fill:true})];
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
  };
  this._pickPoint=new Vector3();
  this._visibleRaycaster=new Raycaster();
  this._visibleHits=[];
  const down=this._onPointerDown;
  this._onPointerDown=event=>{
   if(!this.enabled||event.button!==0)return;
   this.pointerHover(this._getPointer(event));
   // Ordinary scene clicks must not be captured by a gizmo they missed.
   if(this.axis!==null)down(event);
  };
  if(canvas){this.domElement=canvas;this.connect();}
 }

 pointerHover(pointer){
  if(this.dragging)return;
  if(!this.enabled||!this.object||!this.getHelper().visible||!pointer){this.axis=null;return;}
  const rect=this.domElement?.getBoundingClientRect();
  if(!(rect?.width>0&&rect?.height>0)){this.axis=null;return;}
  // Picking sees the latest camera/target even before the next render frame.
  this.getHelper().updateMatrixWorld(true);
  this._visibleRaycaster.setFromCamera(pointer,this.camera);
  const x=(pointer.x+1)*rect.width/2,y=(1-pointer.y)*rect.height/2;let best=null;
  for(const grip of this._gizmo.gizmo[this.mode].children){
   if(!grip.visible)continue;
   const {path,samples,closed,fill,margin,priority}=grip.userData.grip;let clipped=false;
   for(let i=0;i<path.length;i++){
    const p=this._pickPoint.fromArray(path[i]).applyMatrix4(grip.matrixWorld).project(this.camera);
    if(!Number.isFinite(p.x+p.y+p.z)||p.z<-1||p.z>1){clipped=true;break;}
    samples[i*2]=(p.x+1)*rect.width/2;samples[i*2+1]=(1-p.y)*rect.height/2;
   }
   if(clipped)continue;
   this._visibleHits.length=0;
   this._visibleRaycaster.intersectObject(grip,false,this._visibleHits);
   // Actual drawn triangles remain hittable at every camera angle and UI
   // scale. The screen path adds a small CSS-pixel margin around thin grips.
   const distance=this._visibleHits.length?0:distanceToGrip(x,y,samples,closed,fill);
   if(distance<=margin&&(!best||distance<best.distance-1e-5||(Math.abs(distance-best.distance)<1e-5&&priority<best.priority)))best={axis:grip.name,distance,priority};
  }
  this.axis=best?.axis??null;
 }
}
