// Analytical local response; inputs and output are linear and projected.
export const FITTED_REFLECTANCE_WGSL = /* wgsl */ `
fn fittedUnit(v:vec3<f32>)->vec3<f32>{ return v/max(length(v),1e-8); }
fn fittedMask(x:vec3<f32>,y:vec3<f32>,a:vec2<f32>,w:vec3<f32>,nz:f32)->f32{
  let slope=vec2(dot(x,w),dot(y,w))*a;
  return sqrt(1.+dot(slope,slope)/max(nz*nz,1e-8));
}
fn fittedReflectance(diffuse:vec3<f32>,f0:vec3<f32>,slope:vec2<f32>,alpha:vec2<f32>,azimuth:f32,v:vec3<f32>,l:vec3<f32>)->vec3<f32>{
  let n=fittedUnit(vec3(slope,1.));
  let nv=dot(n,v);let nl=dot(n,l);
  if(min(min(nv,nl),min(v.z,l.z))<=0.){return vec3(0.);}
  let t=fittedUnit(vec3(n.z,0.,-n.x));let b=cross(n,t);
  let c=cos(azimuth);let s=sin(azimuth);
  let x=t*c+b*s;let y=b*c-t*s;
  let h=fittedUnit(v+l);
  let xy=vec2(dot(x,h),dot(y,h))/alpha;
  let nh=max(dot(n,h),0.);
  let d=dot(xy,xy)+nh*nh;
  let distribution=1./(3.14159265359*alpha.x*alpha.y*d*d+1e-12);
  let mask=2./(fittedMask(x,y,alpha,v,nv)+fittedMask(x,y,alpha,l,nl));
  let fresnel=f0+(vec3(1.)-f0)*pow(max(1.-dot(v,h),0.),5.);
  return diffuse*(nl/3.14159265359)+fresnel*(distribution*mask/(4.*max(nv,1e-5)));
}
`;

const layout=['diffuseRGB','specularF0RGB','slopeXY','alphaXY','azimuth'];
export function readFittedReflectance(meta) {
 const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(meta?.schema!=='kaminos.fitted-reflectance.v1'||meta.response!=='projected-bsdf'||meta.filtering!=='nearest-authored-texel-mip'||!hash(meta.sourceSha256)||JSON.stringify(meta.layout)!==JSON.stringify(layout))throw Error('Invalid fitted reflectance metadata');
 if(!Array.isArray(meta.levels)||!meta.levels.length)throw Error('Fitted reflectance needs authored levels');
 let previous=Infinity;
 for(const level of meta.levels){
  if(!Number.isSafeInteger(level.size)||level.size<1||level.size>=previous||!Number.isInteger(Math.log2(level.size))||!Number.isSafeInteger(level.size**2*44)||!hash(level.sha256)||!/^fit-\d+\.f32$/.test(level.url??''))throw Error('Invalid fitted reflectance level');
  previous=level.size;
 }
 return meta;
}

async function checked(fetcher,path,expected) {
  const response=await fetcher(path);if(!response.ok)throw Error('Fitted reflectance HTTP '+response.status);
  const bytes=await response.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==expected)throw Error('Fitted reflectance payload digest mismatch');
  return bytes;
}

export async function loadFittedReflectanceManifest(url,{sha256,fetcher=fetch}={}){
 const base=new URL(url,globalThis.location?.href??'http://localhost/');
 const meta=readFittedReflectance(JSON.parse(new TextDecoder().decode(await checked(fetcher,base,sha256))));
 return {base,meta};
}

export async function loadFittedReflectance(url,{sha256,fetcher=fetch}={}){
 const {base,meta}=await loadFittedReflectanceManifest(url,{sha256,fetcher});
 const levels=await Promise.all(meta.levels.map(async level=>{
  const path=new URL(level.url,base);
  if(base.pathname==='/api/read'){
   const item=base.searchParams.get('path');
   if(!item||!base.searchParams.get('root'))throw Error('Mounted fitted bundle requires root and path');
   const mounted=new URL(base);mounted.searchParams.set('path',item.slice(0,item.lastIndexOf('/')+1)+level.url);
   path.href=mounted.href;
  }
  const bytes=await checked(fetcher,path,level.sha256);
  if(bytes.byteLength!==level.size**2*44)throw Error('Fitted reflectance byte count mismatch');
  const source=new DataView(bytes),data=new Float32Array(bytes.byteLength/4);
  for(let i=0;i<data.length;i++){
   const v=source.getFloat32(i*4,true),field=i%11;
   if(!Number.isFinite(v)||(field<6&&(v<0||v>1))||((field===8||field===9)&&(v<.0119||v>1)))throw Error('Invalid fitted reflectance parameter');
   data[i]=v;
  }
  return {...level,data};
 }));
 return {...meta,levels};
}
