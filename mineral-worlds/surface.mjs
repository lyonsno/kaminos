import {Group,Mesh,BufferGeometry,Float32BufferAttribute,Uint32BufferAttribute,MeshStandardMaterial,DoubleSide,DynamicDrawUsage} from '../lib/three.webgpu.js';
export function sample(field,n,u,v){
 const x=Math.max(0,Math.min(n-1,u*(n-1))),z=Math.max(0,Math.min(n-1,v*(n-1))),a=Math.floor(x),b=Math.floor(z),fx=x-a,fz=z-b;
 return (field[b*n+a]*(1-fx)+field[b*n+Math.min(n-1,a+1)]*fx)*(1-fz)+(field[Math.min(n-1,b+1)*n+a]*(1-fx)+field[Math.min(n-1,b+1)*n+Math.min(n-1,a+1)]*fx)*fz;
}
// Independent curved surfel patches, retained between domain updates. The fan
// rasterizes each patch's footprint; there is no connected terrain mesh or
// extraction, raymarch, transparency, or camera-facing billboard rotation.
export function createSurface(state,{samples=160,extent=64}={}){
 if(!Number.isInteger(samples)||samples<4||!Number.isFinite(extent)||extent<=0)throw Error('Invalid surface resolution or extent');
 const root=new Group();root.name=state.kind==='salt'?'Salt plain':'Flowstone reach';
 const segments=8,stride=segments+1,count=samples*samples,coords=new Float32Array(count*stride*2),indices=new Uint32Array(count*segments*3);
 const warp=t=>extent*.5*(.25*t+.75*t*t*t),grid=i=>warp(2*i/(samples-1)-1);
 for(let z=0;z<samples;z++)for(let x=0;x<samples;x++){
  const site=z*samples+x,cx=grid(x),cz=grid(z),rx=(grid(x+.5)-grid(x-.5))*.87,rz=(grid(z+.5)-grid(z-.5))*.87;
  for(let k=0;k<=segments;k++){const j=site*stride+k,a=(k-1)/segments*Math.PI*2;coords[j*2]=cx+(k?rx*Math.cos(a):0);coords[j*2+1]=cz+(k?rz*Math.sin(a):0);}
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
  const grain=.004*Math.sin(x*22+Math.sin(z*7)) *Math.sin(z*19+x*3)+.008*Math.sin(x*5-z*8)*Math.sin(z*6);
  return sample(s.bed,s.size,u,v)*2.5+dep*1.6+grain*(s.kind==='salt'?1.5:1)*(1+Math.min(2,dep*5));
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
 return {root,update,read:()=>({representation:'opaque-curved-surfel-patches',elements:count,uploads,tick:lastTick,extent,samples,topology:'fixed attached surface sites; evolving relief and material'}),dispose(){geometry.dispose();material.dispose();}};
}
