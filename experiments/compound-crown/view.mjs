import {Group,Mesh,Shape,Path,ExtrudeGeometry,CylinderGeometry,BoxGeometry,MeshStandardMaterial} from '../../lib/three.core.js';
import {evaluateCrown,leafDefinition,irisCamPoint,rotate} from './mechanism.mjs';
const TAU=2*Math.PI;
const planeGeometry=(shape,depth)=>{const g=new ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:32});g.translate(0,0,-depth/2);g.rotateX(Math.PI/2);return g;};
function ringGeometry(outer,inner,height){const s=new Shape();s.absarc(0,0,outer,0,TAU,false);const h=new Path();h.absarc(0,0,inner,0,TAU,true);s.holes.push(h);return planeGeometry(s,height);}
function polygonGeometry(points,height){const s=new Shape();s.moveTo(...points[0]);for(const p of points.slice(1))s.lineTo(...p);s.closePath();return planeGeometry(s,height);}
function slotPath(points,width){
 const left=[],right=[];
 for(let i=0;i<points.length;i++){
  const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=[b[0]-a[0],b[1]-a[1]],len=Math.hypot(...d),normal=[-d[1]/len*width/2,d[0]/len*width/2];
  left.push(points[i].map((x,k)=>x+normal[k]));right.push(points[i].map((x,k)=>x-normal[k]));
 }
 const all=[...left,...right.reverse()],p=new Path();p.moveTo(...all[0]);for(const q of all.slice(1))p.lineTo(...q);p.closePath();return p;
}
export function createCrownView(input={}){
 const root=new Group();root.name='Compound Crown';root.userData={feature:'compound-crown',kind:'kinematic-burner-mechanism'};
 const materials={steel:new MeshStandardMaterial({color:0x343b41,metalness:.85,roughness:.32}),bronze:new MeshStandardMaterial({color:0xaa7b39,metalness:.8,roughness:.28}),
  leaf:new MeshStandardMaterial({color:0x8d979c,metalness:.88,roughness:.25}),ceramic:new MeshStandardMaterial({color:0xd6cbb8,metalness:.1,roughness:.72}),pin:new MeshStandardMaterial({color:0xddd6c6,metalness:.9,roughness:.21})};
 let parts=new Map(),geometry=new Set(),buildKey,vanes=[],leaves=[],driveRing,irisRing,irisPinion;
 function mesh(parent,name,g,m,p=[0,0,0]){geometry.add(g);const x=new Mesh(g,m);x.name=name;x.position.fromArray(p);x.castShadow=true;x.receiveShadow=true;parent.add(x);return x;}
 function group(name,parent=root){const g=new Group();g.name=name;g.userData.partId=name;parent.add(g);parts.set(name,g);return g;}
 function axle(parent,name,r,height,pos,mat=materials.pin){return mesh(parent,name,new CylinderGeometry(r,r,height,24),mat,pos);}
 function bar(parent,name,a,b,y,thickness,mat=materials.bronze){
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),x=mesh(parent,name,new BoxGeometry(length,thickness,thickness),mat,[(a[0]+b[0])/2,y,(a[1]+b[1])/2]);x.rotation.y=-Math.atan2(dz,dx);return x;
 }
 function moveBar(x,a,b,y){x.position.set((a[0]+b[0])/2,y,(a[1]+b[1])/2);x.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);}
 function rebuild(pose){
  for(const g of geometry)g.dispose();geometry=new Set();root.clear();parts=new Map();vanes=[];leaves=[];
  const fixed=group('fixed-frame');
  mesh(fixed,'foot-ring',ringGeometry(1.95,.96,.18),materials.steel,[0,.09,0]);
  mesh(fixed,'vane-bearing-ring',ringGeometry(1.48,1.13,.10),materials.steel,[0,.48,0]);
  mesh(fixed,'upper-bearing-ring',ringGeometry(1.49,1.15,.10),materials.steel,[0,1.27,0]);
  mesh(fixed,'ceramic-mouth',ringGeometry(1.85,1.49,.12),materials.ceramic,[0,1.67,0]);
  for(let i=0;i<6;i++){
   const a=i*TAU/6,[x,z]=rotate([1.72,0],a);mesh(fixed,'frame-post-'+i,new CylinderGeometry(.075,.095,1.4,20),materials.steel,[x,.87,z]);
   axle(fixed,'frame-bolt-'+i,.095,.055,[x,1.76,z]);
   mesh(fixed,'foot-'+i,new BoxGeometry(.42,.10,.30),materials.steel,[x*1.08,.05,z*1.08]).rotation.y=-a;
  }
  driveRing=group('vane-unison-ring');mesh(driveRing,'unison-ring',ringGeometry(1.73,1.57,.075),materials.bronze,[0,.24,0]);
  const vaneGeometry=polygonGeometry([[0,-.035],[.70,-.10],[.76,.12],[.02,.035]],.66);
  for(const v of pose.vanes){
   const g=group(v.id);g.position.set(v.pivot[0],.88,v.pivot[1]);
   mesh(g,'vane-foil',vaneGeometry,materials.leaf);axle(g,'vane-shaft',.055,1.05,[0,-.08,0],materials.bronze);
   const crank=bar(root,v.id+'-crank',v.pivot,v.crankEnd,.32,.085),rod=bar(root,v.id+'-rod',v.crankEnd,v.ringEnd,.24,.045);
   const pinA=axle(root,v.id+'-crank-pin',.065,.18,[v.crankEnd[0],.28,v.crankEnd[1]]),pinB=axle(root,v.id+'-ring-pin',.055,.13,[v.ringEnd[0],.25,v.ringEnd[1]]);
   vanes.push({body:g,crank,rod,pinA,pinB});
  }
  irisRing=group('iris-cam-ring');
  const cam=new Shape();cam.absarc(0,0,1.48,0,TAU,false);const center=new Path();center.absarc(0,0,.79,0,TAU,true);cam.holes.push(center);
  for(let i=0;i<pose.recipe.irisCount;i++){
   const a=i*TAU/pose.recipe.irisCount,points=Array.from({length:65},(_,j)=>rotate(irisCamPoint(j/64,pose.recipe.irisCount),a));cam.holes.push(slotPath(points,.075));
  }
  mesh(irisRing,'cam-plate',planeGeometry(cam,.055),materials.bronze,[0,1.56,0]);
  for(let i=0;i<60;i++){const a=i*TAU/60,p=rotate([1.5,0],a);mesh(irisRing,'iris-gear-tooth-'+i,new BoxGeometry(.075,.055,.045),materials.bronze,[p[0],1.56,p[1]]).rotation.y=-a;}
  const leaf=leafDefinition(pose.recipe.irisCount),leafGeometry=polygonGeometry(leaf.polygon,.018);
  for(const l of pose.leaves){
   const g=group(l.id);g.position.set(l.pivot[0],1.37+.002*leaves.length,l.pivot[1]);mesh(g,'iris-leaf',leafGeometry,materials.leaf);
   axle(fixed,'fixed-leaf-pivot-'+leaves.length,.04,.20,[l.pivot[0],1.34,l.pivot[1]],materials.bronze);
   axle(g,'cam-follower',.025,.25,[leaf.follower[0],.10,leaf.follower[1]],materials.pin);
   leaves.push(g);
  }
  irisPinion=group('iris-drive-pinion');irisPinion.position.set(1.76,0,0);axle(irisPinion,'iris-drive-gear',.25,.08,[0,1.56,0],materials.steel);
  for(let i=0;i<10;i++){const a=i*TAU/10,p=rotate([.25,0],a);mesh(irisPinion,'pinion-tooth-'+i,new BoxGeometry(.075,.06,.045),materials.bronze,[p[0],1.56,p[1]]).rotation.y=-a;}
  mesh(fixed,'iris-motor',new BoxGeometry(.52,.34,.5),materials.steel,[2.10,1.55,0]);
  root.userData.partFamilies=['fixed-frame','vane-foil','vane-crank','vane-rod','iris-leaf','cam-ring'];
 }
 function update(input){const pose=evaluateCrown(input),key=pose.recipe.vaneCount+':'+pose.recipe.irisCount;
  if(key!==buildKey){rebuild(pose);buildKey=key;}
  for(const [i,v]of pose.vanes.entries()){
   const x=vanes[i];x.body.rotation.y=-v.angle;moveBar(x.crank,v.pivot,v.crankEnd,.32);moveBar(x.rod,v.crankEnd,v.ringEnd,.24);
   x.pinA.position.set(v.crankEnd[0],.28,v.crankEnd[1]);x.pinB.position.set(v.ringEnd[0],.25,v.ringEnd[1]);
  }
  for(const [i,l]of pose.leaves.entries())leaves[i].rotation.y=-l.angle;
  driveRing.rotation.y=-(pose.ringAngle-.22); // pin endpoints are explicit world-space rigid linkage outputs.
  // Ring is rotationally symmetric; its authored pin positions are separately visible above.
  irisRing.rotation.y=-pose.irisRingAngle;irisPinion.rotation.y=pose.irisRingAngle*6;
  root.userData.recipe={...pose.recipe};root.updateMatrixWorld(true);return pose;
 }
 const pose=update(input);
 return{root,update,get parts(){return new Map(parts);},pose,dispose(){for(const g of geometry)g.dispose();for(const m of Object.values(materials))m.dispose();}};
}
