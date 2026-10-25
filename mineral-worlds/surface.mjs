import {Group,Mesh,BufferGeometry,Float32BufferAttribute,Uint32BufferAttribute,MeshStandardMaterial,DoubleSide,DynamicDrawUsage} from '../lib/three.webgpu.js';
export function sample(field,n,u,v){
 const x=Math.max(0,Math.min(n-1,u*(n-1))),z=Math.max(0,Math.min(n-1,v*(n-1))),a=Math.floor(x),b=Math.floor(z),fx=x-a,fz=z-b;
 return (field[b*n+a]*(1-fx)+field[b*n+Math.min(n-1,a+1)]*fx)*(1-fz)+(field[Math.min(n-1,b+1)*n+a]*(1-fx)+field[Math.min(n-1,b+1)*n+Math.min(n-1,a+1)]*fx)*fz;
}
function grainNoise(x,z){
 const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
 const hash=(a,b)=>{let h=Math.imul(a,374761393)^Math.imul(b,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
 const a=fx*fx*(3-2*fx),b=fz*fz*(3-2*fz);
 return (hash(ix,iz)*(1-a)+hash(ix+1,iz)*a)*(1-b)+(hash(ix,iz+1)*(1-a)+hash(ix+1,iz+1)*a)*b;
}
// Retained local surface patches. Adjacent patches share exact boundary positions
// while keeping independent storage. Fixed surface topology; no extraction,
// raymarch, transparency, or camera-facing billboard rotation.
export function createSurface(state,{samples=320,extent=64,bedScale=2.5,depositScale=state.kind==='salt'?.12:1.6}={}){
 if(!Number.isInteger(samples)||samples<4||!Number.isFinite(extent)||extent<=0)throw Error('Invalid surface resolution or extent');
 if(![bedScale,depositScale].every(v=>Number.isFinite(v)&&v>=0))throw Error('Invalid surface height scale');
 const configuration={samples,extent,bedScale,depositScale};
 const root=new Group();root.name=state.kind==='salt'?'Salt plain':'Flowstone reach';
 const segments=4,stride=segments+1,count=samples*samples,coords=new Float32Array(count*stride*2),indices=new Uint32Array(count*segments*3);
 const warp=t=>extent*.5*(.12*t+.88*t*t*t),grid=i=>warp(2*i/(samples-1)-1);
 for(let z=0;z<samples;z++)for(let x=0;x<samples;x++){
  const site=z*samples+x,cx=grid(x),cz=grid(z);
  const corners=[[cx,cz],[grid(x-.5),grid(z-.5)],[grid(x+.5),grid(z-.5)],[grid(x+.5),grid(z+.5)],[grid(x-.5),grid(z+.5)]];
  for(let k=0;k<=segments;k++){const j=site*stride+k;coords[j*2]=corners[k][0];coords[j*2+1]=corners[k][1];}
  for(let k=0;k<segments;k++)indices.set([site*stride,site*stride+1+(k+1)%segments,site*stride+1+k],(site*segments+k)*3);
 }
 const geometry=new BufferGeometry();geometry.setIndex(new Uint32BufferAttribute(indices,1));
 const positions=new Float32Array(count*stride*3),normals=new Float32Array(positions.length),colors=new Float32Array(positions.length);
 geometry.setAttribute('position',new Float32BufferAttribute(positions,3).setUsage(DynamicDrawUsage));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3).setUsage(DynamicDrawUsage));geometry.setAttribute('color',new Float32BufferAttribute(colors,3).setUsage(DynamicDrawUsage));
 const material=new MeshStandardMaterial({roughness:state.kind==='salt'?.94:.7,metalness:0,side:DoubleSide,vertexColors:true,envMapIntensity:.15});
 const mesh=new Mesh(geometry,material);mesh.name='Retained mineral surface';mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh);
 let uploads=0,lastTick=-1;
 const height=(s,x,z)=>{
  const u=x/extent+.5,v=z/extent+.5,dep=sample(s.solid,s.size,u,v);
  // Stable authored microrelief. Growth modulates its prominence; it is not
  // labelled as resolved individual-crystal dynamics.
  const grain=.003*(grainNoise(x*35,z*35)-.5)+.007*(grainNoise(x*8,z*8)-.5)+.007*(grainNoise(x*1.7,z*1.7)-.5);
  return sample(s.bed,s.size,u,v)*bedScale+dep*depositScale+grain*(s.kind==='salt'?2:1.5);

 };
 function update(s){
  if(s.tick===lastTick&&uploads)return;
  const position=geometry.attributes.position.array,normal=geometry.attributes.normal.array,color=geometry.attributes.color.array;
  for(let i=0;i<coords.length/2;i++){
   const x=coords[i*2],z=coords[i*2+1],u=x/extent+.5,v=z/extent+.5,h=height(s,x,z),e=.015;
   const dx=(height(s,x+e,z)-height(s,x-e,z))/(2*e),dz=(height(s,x,z+e)-height(s,x,z-e))/(2*e),l=Math.hypot(dx,1,dz);
   position.set([x,h,z],i*3);normal.set([-dx/l,1/l,-dz/l],i*3);
   const deposit=sample(s.solid,s.size,u,v),wet=sample(s.water,s.size,u,v);
   const m=.025*Math.sin(x*.7+z*.3)+.017*Math.sin(z*1.7-x*.4);
   if(s.kind==='salt'){const value=.65+.16*(1-Math.exp(-deposit*3))+m;color.set([value,value*.97,value*.88],i*3);}
   else {const value=.3+.32*(1-Math.exp(-deposit*8))+m-Math.min(.08,wet*.6);color.set([value,value*.88,value*.69],i*3);}
  }
  for(const key of ['position','normal','color'])geometry.attributes[key].needsUpdate=true;
  geometry.computeBoundingBox();geometry.computeBoundingSphere();uploads++;lastTick=s.tick;
 }
 update(state);
 return {root,update,read:()=>({representation:'opaque-boundary-matched-surface-patches',configuration:{...configuration},elements:count,uploads,tick:lastTick,extent,samples,topology:'fixed attached surface sites; evolving relief and material'}),dispose(){geometry.dispose();material.dispose();}};
}
