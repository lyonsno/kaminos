import {facePoint,facePatch} from './crust-faces.mjs';
import {Group,Mesh,InstancedMesh,BoxGeometry,PlaneGeometry,BufferGeometry,Float32BufferAttribute,MeshStandardNodeMaterial,MeshBasicNodeMaterial,Matrix4,Quaternion,Vector3,Color,DoubleSide} from '../lib/three.webgpu.js';
import {grainDimensions,grainCenter,trackGeometry,trackPoint} from './crust.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function createCrustSurface(state){
 const root=new Group();root.name='Living salt crust';
 const crystalGeometry=new BoxGeometry(1,1,1),crystalMaterial=new MeshStandardNodeMaterial({color:0xffffff,roughness:.36,metalness:0,envMapIntensity:.65,flatShading:true});
 const bedGeometry=new PlaneGeometry(state.rows*1.05+.5,state.rows*1.05+.5),bedMaterial=new MeshStandardNodeMaterial({color:0xc2bba8,roughness:.94,metalness:0});
 const bed=new Mesh(bedGeometry,bedMaterial);bed.rotation.x=-Math.PI/2;bed.position.y=-.012;bed.receiveShadow=true;bed.name='Authored substrate';root.add(bed);
 let crystals=null,capacity=0,wetGeometry=new BufferGeometry(),frontGeometry=new BufferGeometry();
 const liquidMaterial=new MeshStandardNodeMaterial({color:0x548f98,roughness:.13,metalness:.03,transparent:true,opacity:.55,depthWrite:false,side:DoubleSide});
 const frontMaterial=new MeshBasicNodeMaterial({color:0xa5ffff,transparent:true,opacity:.92,side:DoubleSide,depthWrite:false});
 const liquid=new Mesh(wetGeometry,liquidMaterial),fronts=new Mesh(frontGeometry,frontMaterial);liquid.name='Retained brine films';fronts.name='Liquid-air fronts';root.add(liquid,fronts);
 const matrix=new Matrix4(),rotation=new Quaternion(),scale=new Vector3(),position=new Vector3(),up=new Vector3(0,1,0),color=new Color();
 let showInterfaces=true,last=-1,uploads=0;
 function update(s){
  if(last===s.tick&&crystals)return;
  if(s.grains.length>capacity){if(crystals){root.remove(crystals);crystals.dispose();}capacity=2**Math.ceil(Math.log2(Math.max(1,s.grains.length)));crystals=new InstancedMesh(crystalGeometry,crystalMaterial,capacity);crystals.name='Retained crystal faces';crystals.castShadow=true;crystals.receiveShadow=true;root.add(crystals);}
  crystals.count=s.grains.length;
  s.grains.forEach((g,i)=>{const d=grainDimensions(g),c=grainCenter(g),wet=s.pools[g.topPool]?.water??0,cap=d[0]*d[2]*.016,f=clamp(wet/Math.max(cap,1e-12),0,1);position.fromArray(c);scale.fromArray(d);rotation.setFromAxisAngle(up,-g.angle);matrix.compose(position,rotation,scale);crystals.setMatrixAt(i,matrix);color.setRGB(.88-.15*f,.86-.12*f,.77-.06*f);if(!g.authored)color.multiplyScalar(1.04);crystals.setColorAt(i,color);});
  crystals.instanceMatrix.needsUpdate=true;crystals.instanceColor.needsUpdate=true;crystals.computeBoundingSphere();
  const water=[],lines=[];
  const triangle=(arr,a,b,c)=>arr.push(...a,...b,...c);
  const quad=(arr,a,b,c,d)=>{triangle(arr,a,b,c);triangle(arr,a,c,d);};
  const ribbon=(arr,a,b,width,normal=[0,1,0])=>{const v=new Vector3().fromArray(b).sub(new Vector3().fromArray(a)),n=new Vector3().fromArray(normal),side=new Vector3().crossVectors(v,n);if(side.lengthSq()<1e-12)side.set(0,0,1);side.normalize().multiplyScalar(width/2);const at=(p,sign)=>[p[0]+side.x*sign,p[1]+side.y*sign,p[2]+side.z*sign];quad(arr,at(a,1),at(a,-1),at(b,-1),at(b,1));};
  for(const p of s.pools){
   const g=trackGeometry(s,p);if(p.water<=0||g.closed)continue;
   const fraction=clamp(p.water/g.capacity,0,1);
   if(p.kind==='face'&&typeof p.face==='number'){
    const grain=s.grains[p.grain],patch=facePatch(s,p),[u,v]=patch.lo,[U,V]=patch.hi,points=[[u,v],[U,v],[U,V],[u,V]].map(uv=>facePoint(grain,p.face,uv,.001));
    quad(water,...points);if(showInterfaces)for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4];ribbon(lines,a,b,.0015);}continue;
   }
   if(p.kind==='face'){
    const grain=s.grains[p.grain],center=grainCenter(grain),[w,,d]=grainDimensions(grain),r=Math.sqrt(fraction),co=Math.cos(grain.angle),sn=Math.sin(grain.angle),point=(x,z)=>[center[0]+co*x-sn*z,grain.faces[4]+.003,center[2]+sn*x+co*z];
    quad(water,point(-w*r/2,-d*r/2),point(w*r/2,-d*r/2),point(w*r/2,d*r/2),point(-w*r/2,d*r/2));continue;
   }
   if(p.kind==='junction'&&s.setup==='neighbors'){
    const w=.6*Math.sqrt(fraction);quad(water,[-w,.002,-w],[w,.002,-w],[w,.002,w],[-w,.002,w]);continue;
   }
   if(p.kind==='junction'){
    const point=g.point,r=Math.sqrt(g.area/Math.PI)*Math.sqrt(fraction),steps=20;
    for(let j=0;j<steps;j++){const a=j/steps*Math.PI*2,b=(j+1)/steps*Math.PI*2;triangle(water,point,[point[0]+Math.cos(a)*r,point[1]+.001,point[2]+Math.sin(a)*r],[point[0]+Math.cos(b)*r,point[1]+.001,point[2]+Math.sin(b)*r]);}
    continue;
   }
   const from=p.owner===p.a?0:1,to=p.owner===p.a?fraction:1-fraction,segments=Math.max(2,g.points.length*3),normal=p.kind==='film'?[Math.cos(s.grains[p.carrier].angle),0,Math.sin(s.grains[p.carrier].angle)]:[0,1,0];
   if(g.profile){const lo=Math.min(from,to)*g.length,hi=Math.max(from,to)*g.length,[tx,tz]=g.profile.axis,[nx,nz]=g.profile.normal,origin=g.endpoints[0],point=(along,across)=>[origin[0]+tx*along+nx*across,.023,origin[2]+tz*along+nz*across];for(const segment of g.profile.segments){const a=Math.max(lo,segment.lo),b=Math.min(hi,segment.hi);if(b<=a)continue;for(const [left,right]of segment.open)quad(water,point(a,left),point(a,right),point(b,right),point(b,left));}}
   else for(let j=0;j<segments;j++){const a=trackPoint(s,p,from+(to-from)*j/segments,g),b=trackPoint(s,p,from+(to-from)*(j+1)/segments,g);ribbon(water,a,b,g.width,Math.abs(b[1]-a[1])>.001?normal:[0,1,0]);}
   if(p.maxWetFraction>fraction){const extent=p.owner===p.a?p.maxWetFraction:1-p.maxWetFraction;for(let j=0;j<segments;j++){const a=trackPoint(s,p,from+(extent-from)*j/segments,g),b=trackPoint(s,p,from+(extent-from)*(j+1)/segments,g);ribbon(water,a,b,(p.kind==='gap'?Math.min(g.gap,.28):g.width)*.12*Math.sqrt(fraction));}}
   const at=trackPoint(s,p,to,g),before=trackPoint(s,p,clamp(to-.005,0,1),g),tangent=new Vector3().fromArray(at).sub(new Vector3().fromArray(before));
   let nx=-tangent.z,nz=tangent.x,length=Math.hypot(nx,nz);if(length<1e-9){nx=0;nz=1;length=1;}nx/=length;nz/=length;
   const width=p.kind==='gap'?Math.min(g.gap,.3):g.width,along=length>0?[tangent.x/length,0,tangent.z/length]:[1,0,0];
   const radius=width/(2*Math.cos(.35)),sag=radius-Math.sqrt(Math.max(0,radius*radius-width*width/4));
   let previous=null;
   for(let j=0;j<=12;j++){const across=(j/12-.5)*width,bend=Math.sqrt(Math.max(0,radius*radius-across*across))-(radius-sag),point=[at[0]+nx*across-along[0]*bend,at[1]+.004,at[2]+nz*across-along[2]*bend];if(previous)ribbon(lines,previous,point,.006);previous=point;}
  }
  const stream=(geometry,data)=>{
   const count=data.length/3;
   if(!geometry.attributes.position||geometry.attributes.position.array.length<data.length){
    geometry.dispose();geometry=new BufferGeometry();const capacity=3*2**Math.ceil(Math.log2(Math.max(1,count)));
    geometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(capacity),3));geometry.setAttribute('normal',new Float32BufferAttribute(new Float32Array(capacity),3));
   }
   for(const attribute of Object.values(geometry.attributes)){attribute.count=count;attribute.clearUpdateRanges();if(data.length)attribute.addUpdateRange(0,data.length);}
   geometry.attributes.position.array.set(data);geometry.attributes.position.needsUpdate=true;geometry.setDrawRange(0,count);geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
  };
  wetGeometry=stream(wetGeometry,water);frontGeometry=stream(frontGeometry,lines);
  liquid.geometry=wetGeometry;fronts.geometry=frontGeometry;fronts.visible=showInterfaces;last=s.tick;uploads++;
 }
 update(state);
 return {root,update,interfaces(value){showInterfaces=Boolean(value);fronts.visible=showInterfaces;},read:()=>({grains:crystals.count,triangles:crystals.count*12+wetGeometry.attributes.position.count/3+frontGeometry.attributes.position.count/3,interfaces:showInterfaces,uploads,tick:last,renderer:'instanced opaque facets + retained film strips; no raymarch'}),dispose(){crystalGeometry.dispose();crystalMaterial.dispose();bedGeometry.dispose();bedMaterial.dispose();wetGeometry.dispose();frontGeometry.dispose();liquidMaterial.dispose();frontMaterial.dispose();}};
}
