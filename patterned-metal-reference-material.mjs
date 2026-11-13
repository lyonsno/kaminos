import {createLocalResponseMaterial} from './fitted-reflectance-material.mjs';
import {DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, RepeatWrapping, NoColorSpace, TSL} from './lib/three.webgpu.js';
const {wgslFn,texture,sampler}=TSL;

const evaluate=wgslFn(`fn patternedResponse(base:texture_2d<f32>,nmap:texture_2d<f32>,rmap:texture_2d<f32>,metal:texture_2d<f32>,s:sampler,uv:vec2<f32>,v:vec3<f32>,l:vec3<f32>)->vec3<f32>{
 if(min(v.z,l.z)<=0.){return vec3(0.);}
 let p=uv*vec2(1.,-1.);
 let color=pow(textureSampleLevel(base,s,p,0.).rgb,vec3(2.2));
 let packed=textureSampleLevel(nmap,s,p,0.).rgb;
 var n=vec3(0.,0.,1.);
 if(length(packed)>0.){n=normalize(2.*packed-1.);}
 if(dot(v,n)<=0.){
  var axis=cross(v,n);
  if(max(abs(axis.x),max(abs(axis.y),abs(axis.z)))<1e-4){axis=cross(v,vec3(0.,0.,1.));}
  if(length(axis)<1e-4){axis=vec3(0.,1.,0.);}
  n=normalize(cross(normalize(axis),v)+1e-4*v);
 }
 let r=textureSampleLevel(rmap,s,p,0.).r;
 let m=textureSampleLevel(metal,s,p,0.).r;
 let nv=dot(n,v);let nl=dot(n,l);
 if(min(nv,nl)<=0.){return vec3(0.);}
 let h=normalize(v+l);let nh=dot(n,h);let vh=clamp(dot(v,h),0.,1.);
 let alpha=clamp(r*r,1e-4,2.);let a2=alpha*alpha;
 let d0=nh*nh*(a2-1.)+1.;
 let D=a2/(3.14159265359*d0*d0);
 let c2=vec2(nv*nv,nl*nl);
 let lambda=sqrt(1.+a2*max(1.-c2,vec2(0.))/max(c2,vec2(1e-30)));
 let lobe=D/(2.*(lambda.x+lambda.y)*max(nv,1e-30));
 let x=abs(nv);let y=sqrt(alpha);let x2=x*x;let y2=y*y;
 let coeff=vec4(.1003,.9345,1.,1.)+vec4(-.6303,-2.323,-1.765,.2281)*x+vec4(9.748,2.229,8.263,15.94)*y+
  vec4(-2.038,-3.748,11.53,-55.83)*x*y+vec4(29.34,1.424,28.96,13.08)*x2+vec4(-8.245,-.7684,-7.507,41.26)*y2+
  vec4(-26.44,1.436,-36.11,54.9)*x2*y+vec4(19.99,.2913,15.86,300.2)*x*y2+vec4(-5.448,.6286,33.37,-285.1)*x2*y2;
 let e=dot(clamp(coeff.xy/coeff.zw,vec2(0.),vec2(1.)),vec2(1.));
 let missing=(1.-e)/max(e,1e-6);
 let refl=clamp(color,vec3(0.),vec3(.99));let eta=(1.-refl)/(1.+refl);
 let k2=max(((eta+1.)*(eta+1.)*refl-(eta-1.)*(eta-1.))/(1.-refl),vec3(0.));
 let cv=vh*vh;let sv=1.-cv;let t0=eta*eta-k2-sv;let ab=sqrt(t0*t0+4.*eta*eta*k2);
 let t1=ab+cv;let t2=2.*vh*sqrt(max(.5*(ab+t0),vec3(0.)));
 let rs=(t1-t2)/max(t1+t2,vec3(1e-30));let t3=cv*ab+sv*sv;let t4=t2*sv;
 let fc=.5*clamp(rs*(t3-t4)/max(t3+t4,vec3(1e-30))+rs,vec3(0.),vec3(2.));
 let cc=clamp(vec2(vh,abs(nv)),vec2(0.),vec2(1.));let g=sqrt(.69+cc*cc);
 let a=(g-cc)/(g+cc);let b=(cc*(g+cc)-1.)/(cc*(g-cc)+1.);let fd=.5*a*a*(1.+b*b);
 return max(mix(vec3(lobe*fd.x*(1.+fd.x*missing))+color*(nl*(1.-fd.y)/3.14159265359),lobe*fc*(1.+fc*missing),m),vec3(0.));
}`);

export async function loadPatternedMetalMaterial(url,expected,options) {
 async function checked(location,sha) {
  const r=await fetch(location);if(!r.ok)throw Error('PatternedMetal source HTTP '+r.status);
  const bytes=await r.arrayBuffer();
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(actual!==sha)throw Error('PatternedMetal source digest mismatch');
  return bytes;
 }
 const base=new URL(url,location.href);
 const manifest=JSON.parse(new TextDecoder().decode(await checked(base,expected)));
 if(manifest.schema!=='kaminos.patterned-metal-reference.v1'||manifest.neuralSource!=='305b4b9c12e679398c487603dd8245c3f348526c'||manifest.falcorSource!=='d629c967fa800af81cf5c916bfb2a825b012f473')throw Error('Wrong PatternedMetal source graph');
 const maps=[];
 try {
  for(const name of ['basecolor','normal','roughness','metallic']){
   const file=manifest.files[name],path=new URL(file.path,base);
   if(base.pathname==='/api/read'){
    const item=base.searchParams.get('path');
    if(!item||!base.searchParams.get('root'))throw Error('Mounted source requires root and path');
    path.href=base.href;path.searchParams.set('path',item.slice(0,item.lastIndexOf('/')+1)+file.path);
   }
   const image=await createImageBitmap(new Blob([await checked(path,file.sha256)]),{colorSpaceConversion:'none'});
   try{
    if(image.width!==4096||image.height!==4096)throw Error('Wrong PatternedMetal map dimensions');
    const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(image,0,0);
    const map=new DataTexture(new Uint8Array(ctx.getImageData(0,0,image.width,image.height).data.buffer),image.width,image.height,RGBAFormat,UnsignedByteType);
    map.colorSpace=NoColorSpace;map.wrapS=map.wrapT=RepeatWrapping;map.minFilter=map.magFilter=LinearFilter;map.generateMipmaps=false;map.needsUpdate=true;maps.push(map);
   }finally{image.close();}
  }
  const [baseColor,normal,roughness,metal]=maps.map(value=>texture(value));
  const result=createLocalResponseMaterial('PatternedMetal source',(uv,_dx,_dy,v,l)=>evaluate(baseColor,normal,roughness,metal,sampler(baseColor),uv,v,l),options);
  result.material.addEventListener('dispose',()=>maps.forEach(map=>map.dispose()));
  return result;
 }catch(error){maps.forEach(map=>map.dispose());throw error;}
}
