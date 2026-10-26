import {Group,Mesh,PlaneGeometry,MeshStandardNodeMaterial,DataTexture,FloatType,RGBAFormat,NearestFilter,TSL} from '../lib/three.webgpu.js';
import {bedAt,spatialSampler} from './reach.mjs';
const {Fn,vec3,vec2,ivec2,float,int,positionLocal,textureLoad,uniform,Loop,If,sin,cos,exp,abs,max,min,clamp,mix,smoothstep,fwidth,bumpMap}=TSL;
function dataTexture(data,w,h){const t=new DataTexture(data,w,h,RGBAFormat,FloatType);t.minFilter=t.magFilter=NearestFilter;t.needsUpdate=true;return t;}
export function createReachSurface(state,{segments=128,depth=.22,finish=.5}={}){
 if(!Number.isInteger(segments)||segments<8||![depth,finish].every(Number.isFinite)||depth<0||finish<0||finish>1)throw Error('Invalid reach surface');
 const root=new Group();root.name='Layered mineral reach';
 const geometry=new PlaneGeometry(state.extent,state.extent,segments,segments);geometry.rotateX(-Math.PI/2);
 const material=new MeshStandardNodeMaterial({roughness:.6,metalness:0,envMapIntensity:.12});
 const exposure=uniform(depth),polish=uniform(finish),bedDepth=uniform(state.beddingDepth),layerCount=uniform(0,'int');
 let layerTexture=dataTexture(new Float32Array(4),1,1),featureTexture=dataTexture(new Float32Array(12),3,1),headerTexture=dataTexture(new Float32Array(state.size*state.size*4),state.size,state.size),refsTexture=dataTexture(new Float32Array(4),1,1);
 let profileTexture=dataTexture(new Float32Array(4),1,1);const profileNode=textureLoad(profileTexture),profileWidth=uniform(1,'int');
 const layerNode=textureLoad(layerTexture),featureNode=textureLoad(featureTexture),headerNode=textureLoad(headerTexture),refsNode=textureLoad(refsTexture);
 const refsWidth=uniform(1,'int'),gridSize=uniform(state.size,'int'),extent=uniform(state.extent);
 const x=positionLocal.x,z=positionLocal.z;
 // Initial strata are explicit authored bedding. Continuous boundary deformation
 // is shared by layers; finite layer descriptors supply colour, width and phase.
 const coordinate=clamp(float(.48).add(z.mul(.032)).add(sin(x.mul(.32).add(sin(z.mul(.4)))).mul(.025)).add(sin(z.mul(1.25).add(x.mul(.24))).mul(.008)).add(sin(x.mul(2.6).add(z.mul(1.7))).mul(.0015)).sub(exposure.mul(.48)),.001,bedDepth.sub(.001));
 // Integral of the piecewise-linear colour basis over the pixel footprint.
 // Prefix integrals allow fine laminae to merge into their actual mean colour.
 const beddingIntegral=Fn(([q])=>{
  const lo=int(0).toVar(),hi=layerCount.sub(1).toVar();
  Loop(lo.lessThan(hi),()=>{const mid=lo.add(hi).div(2).toInt(),l=layerNode.load(ivec2(mid,0));If(q.greaterThanEqual(l.y),()=>lo.assign(mid.add(1))).Else(()=>hi.assign(mid));});
  const l=layerNode.load(ivec2(lo,0));return l.w.add(clamp(q.sub(l.x),0,l.y.sub(l.x)).mul(l.z));
 });
 const strata=Fn(()=>{
  const aa=max(fwidth(coordinate),.000015),lo=max(coordinate.sub(aa.mul(.5)),0),hi=min(coordinate.add(aa.mul(.5)),bedDepth);
  const tone=beddingIntegral(hi).sub(beddingIntegral(lo)).div(max(hi.sub(lo),.000001));
  return mix(vec3(.16,.18,.17),vec3(.64,.56,.43),tone);
 });
 const deposits=Fn(()=>{
  const cell=clamp(positionLocal.xz.div(extent).add(.5).mul(gridSize.sub(1).toFloat()).floor(),vec2(0),vec2(gridSize.sub(1).toFloat()));
  const header=headerNode.load(ivec2(cell)),h=float(0).toVar(),tone=float(0).toVar();
  Loop({start:int(0),end:int(header.y),type:'int',condition:'<'},({i})=>{
   const ref=int(header.x).add(i),id=int(refsNode.load(ivec2(ref.mod(refsWidth),ref.div(refsWidth))).x);
   const f=featureNode.load(ivec2(0,id)),g=featureNode.load(ivec2(1,id));
   const delta=positionLocal.xz.sub(f.xy),u=delta.x.mul(g.x).add(delta.y.mul(g.y)).div(f.z),v=delta.y.mul(g.x).sub(delta.x.mul(g.y)).div(f.w),q=max(float(1).sub(u.mul(u)).sub(v.mul(v)),0);
   const value=q.mul(q).mul(q).mul(g.z).mul(4/Math.PI).div(f.z.mul(f.w));
   const profile=featureNode.load(ivec2(2,id)),lo=int(profile.x).toVar(),hi=int(profile.x.add(profile.y).sub(1)).toVar();
   const at=clamp(float(1).sub(exposure.mul(.12).div(max(value,.000001))),0,1);
   Loop(lo.lessThan(hi),()=>{const mid=lo.add(hi).div(2).toInt(),p=profileNode.load(ivec2(mid.mod(profileWidth),mid.div(profileWidth)));If(at.greaterThanEqual(p.y),()=>lo.assign(mid.add(1))).Else(()=>hi.assign(mid));});
   const selected=profileNode.load(ivec2(lo.mod(profileWidth),lo.div(profileWidth)));
   h.addAssign(value);tone.addAssign(value.mul(selected.z));
  });
  return vec2(h,tone.div(max(h,.000001)));
 });
 const dep=deposits(),coat=smoothstep(.001,.035,dep.x.sub(exposure.mul(.12))),stone=strata();
 const grown=mix(vec3(.55,.55,.48),vec3(.84,.78,.64),dep.y);
 material.colorNode=mix(stone,grown,coat.mul(.82));
 material.roughnessNode=mix(.9,.28,polish).sub(coat.mul(.09));
 // Subpixel relief follows retained layer boundaries and evolved deposit shape.
 material.normalNode=bumpMap(sin(coordinate.mul(520)).mul(.00035).mul(float(1).sub(polish)).add(dep.x.mul(.025)));
 const mesh=new Mesh(geometry,material);mesh.name='Retained strata and deposits';root.add(mesh);
 let last=-1,uploads=0,focus=[0,0];
 function refocus(target){const next=[Math.max(-state.extent*.45,Math.min(state.extent*.45,target[0])),Math.max(-state.extent*.45,Math.min(state.extent*.45,target[2]))];if(Math.hypot(next[0]-focus[0],next[1]-focus[1])<state.extent/100)return;focus=next;last=-1;}

 function update(s){
  if(last===s.tick&&uploads)return;
  const a=geometry.attributes.position.array,sampler=spatialSampler(s);
  const warp=(t,f)=>f+(t<0?s.extent/2+f:s.extent/2-f)*(.12*t+.88*t*t*t);
  for(let iz=0;iz<=segments;iz++)for(let ix=0;ix<=segments;ix++){const i=(iz*(segments+1)+ix)*3,x=warp(ix/segments*2-1,focus[0]),z=warp(iz/segments*2-1,focus[1]);a[i]=x;a[i+2]=z;a[i+1]=bedAt(s,x,z)+sampler.height(x,z);}
  geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const leaves=[];let boundary=0;
  const flatten=(children,start,width,tone)=>{let at=start;for(const child of children){const w=child.width*width,t=tone*.65+child.tone*.35;if(child.children.length)flatten(child.children,at,w,t);else leaves.push([at,at+w,t,0]);at+=w;}};
  for(const layer of s.layers.filter(l=>l.authored)){flatten(layer.children,boundary,layer.thickness,layer.tone);boundary+=layer.thickness;}
  let integral=0;for(const leaf of leaves){leaf[3]=integral;integral+=(leaf[1]-leaf[0])*leaf[2];}const ld=Float32Array.from(leaves.flat());
  const ft=new Float32Array(Math.max(1,s.features.length)*12),profiles=[];const bins=Array.from({length:s.size*s.size},()=>[]),d=s.extent/(s.size-1);
  s.features.forEach((f,i)=>{
   let total=0,tone=0;f.layers.forEach((v,j)=>{total+=v??0;tone+=(v??0)*(s.layers[j]?.tone??.5);});
   const start=profiles.length;let at=0;
   f.layers.forEach((volume,j)=>{if(!volume)return;const layer=s.layers[j],width=volume/total;
    for(const child of layer.children){profiles.push([at,at+width*child.width,layer.tone*.6+child.tone*.4,child.width]);at+=width*child.width;}
   });
   if(profiles.length===start)profiles.push([0,1,.5,0]);
   ft.set([f.x,f.z,f.rx,f.rz,Math.cos(f.angle),Math.sin(f.angle),f.volume,total?tone/total:.5,start,profiles.length-start,0,0],i*12);
   const r=Math.max(f.rx,f.rz),lx=Math.max(0,Math.floor((f.x-r+s.extent/2)/d)),hx=Math.min(s.size-1,Math.floor((f.x+r+s.extent/2)/d)),lz=Math.max(0,Math.floor((f.z-r+s.extent/2)/d)),hz=Math.min(s.size-1,Math.floor((f.z+r+s.extent/2)/d));for(let z=lz;z<=hz;z++)for(let x=lx;x<=hx;x++)bins[z*s.size+x].push(i);
  });
  const total=bins.reduce((a,b)=>a+b.length,0),width=Math.max(1,Math.ceil(Math.sqrt(total))),height=Math.max(1,Math.ceil(total/width)),rd=new Float32Array(width*height*4),hd=new Float32Array(s.size*s.size*4);let offset=0;bins.forEach((b,i)=>{hd.set([offset,b.length,0,0],i*4);for(const id of b)rd[(offset++)*4]=id;});
  for(const t of [layerTexture,featureTexture,headerTexture,refsTexture,profileTexture])t.dispose();
  layerTexture=dataTexture(ld,leaves.length,1);featureTexture=dataTexture(ft,3,Math.max(1,s.features.length));headerTexture=dataTexture(hd,s.size,s.size);refsTexture=dataTexture(rd,width,height);
  const pw=Math.max(1,Math.ceil(Math.sqrt(profiles.length))),ph=Math.max(1,Math.ceil(profiles.length/pw)),pd=new Float32Array(pw*ph*4);profiles.forEach((p,i)=>pd.set(p,i*4));profileTexture=dataTexture(pd,pw,ph);profileNode.value=profileTexture;profileWidth.value=pw;
  layerNode.value=layerTexture;featureNode.value=featureTexture;headerNode.value=headerTexture;refsNode.value=refsTexture;
  layerCount.value=leaves.length;refsWidth.value=width;gridSize.value=s.size;extent.value=s.extent;bedDepth.value=s.beddingDepth;
  last=s.tick;uploads++;
 }
 update(state);
 return {root,update,focus:refocus,appearance(p){if(p.depth!=null&&(!Number.isFinite(p.depth)||p.depth<0))throw Error('Invalid exposure depth');if(p.finish!=null&&(!Number.isFinite(p.finish)||p.finish<0||p.finish>1))throw Error('Invalid finish');if(p.depth!=null){if(!Number.isFinite(p.depth)||p.depth<0)throw Error('Invalid exposure depth');exposure.value=p.depth;}if(p.finish!=null){if(!Number.isFinite(p.finish)||p.finish<0||p.finish>1)throw Error('Invalid finish');polish.value=p.finish;}},read:()=>({segments,depth:exposure.value,finish:polish.value,vertices:geometry.attributes.position.count,uploads,tick:last,representation:'continuous stratigraphy + exact sparse kernel evaluation; mesh geometry cache'}),dispose(){geometry.dispose();material.dispose();for(const t of [layerTexture,featureTexture,headerTexture,refsTexture,profileTexture])t.dispose();}};
}
