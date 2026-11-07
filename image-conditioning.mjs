// Image conditioning owns a source-camera surface, not unseen reconstructed geometry.
export const CONDITIONING_ROUTE='source-camera-gaussian-coverage.v1';
export const conditioningDefaults=()=>({form:0,boundary:1.5,clay:0,contrast:1,density:6,background:[0.22,0.22,0.22]});
export function conditioningSettings(value={}){
 const p={...conditioningDefaults(),...value};
 for(const key of ['form','boundary','clay','contrast','density'])if(!Number.isFinite(p[key])||p[key]<0)throw Error(`Invalid conditioning ${key}`);
 if(p.clay>1||!Array.isArray(p.background)||p.background.length!==3||p.background.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Invalid conditioning appearance');
 return p;
}
export function conditioningCloud({width,height,depth,normals},image){
 const count=width*height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||depth?.length!==count||normals?.length!==count*3||image?.data?.length!==image.width*image.height*4)throw Error('Invalid conditioning geometry');
 const valid=Array.from(depth).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);if(!valid.length)throw Error('No valid conditioning depth');
 const median=valid[Math.floor(valid.length/2)],positions=new Float32Array(count*3),colors=new Float32Array(count*3),normal=new Float32Array(count*3),alpha=new Float32Array(count);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,d=depth[i]/median,src=(Math.min(image.height-1,Math.floor((y+.5)/height*image.height))*image.width+Math.min(image.width-1,Math.floor((x+.5)/width*image.width)))*4;
  if(!Number.isFinite(d)||d<=0)continue;
  positions.set([((x+.5)/width-.5)*(image.width/image.height)*d,((y+.5)/height-.5)*d,d],i*3);
  for(let k=0;k<3;k++){colors[i*3+k]=image.data[src+k]/255;normal[i*3+k]=normals[i*3+k];}
  alpha[i]=image.data[src+3]/255;
 }
 if(!alpha.some(x=>x>0))throw Error('No foreground coverage');
 return {width,height,aspect:image.width/image.height,positions,colors,normals:normal,alpha,projection:'source-pixel-rays-focal-height.v1'};
}
// Spatial means move XYZ in camera space. Each occupied voxel contributes its
// actual coverage mass; distant surfaces outside the smoothing scale stay apart.
export function smoothConditioningCloud(cloud,form){
 if(!Number.isFinite(form)||form<0)throw Error('Invalid conditioning form');if(!form)return cloud;
 const scale=form/cloud.height,cells=new Map(),key=(x,y,z)=>`${x},${y},${z}`;
 for(let i=0;i<cloud.alpha.length;i++){const mass=cloud.alpha[i];if(!mass)continue;const j=i*3,p=cloud.positions,x=Math.floor(p[j]/scale),y=Math.floor(p[j+1]/scale),z=Math.floor(p[j+2]/scale),k=key(x,y,z);let cell=cells.get(k);if(!cell)cells.set(k,cell=new Float64Array(7));cell[6]+=mass;for(let c=0;c<3;c++){cell[c]+=p[j+c]*mass;cell[c+3]+=cloud.normals[j+c]*mass;}}
 for(const cell of cells.values())for(let k=0;k<6;k++)cell[k]/=cell[6];
 const positions=new Float32Array(cloud.positions),normals=new Float32Array(cloud.normals);
 for(let i=0;i<cloud.alpha.length;i++){if(!cloud.alpha[i])continue;const j=i*3,p=cloud.positions,x=Math.floor(p[j]/scale),y=Math.floor(p[j+1]/scale),z=Math.floor(p[j+2]/scale),sum=new Float64Array(6);let total=0;
  for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const cell=cells.get(key(x+dx,y+dy,z+dz));if(!cell)continue;const distance=(cell[0]-p[j])**2+(cell[1]-p[j+1])**2+(cell[2]-p[j+2])**2;if(distance>scale*scale*4)continue;const weight=cell[6]*Math.exp(-distance/(2*scale*scale));total+=weight;for(let c=0;c<6;c++)sum[c]+=cell[c]*weight;
  }
  if(total){for(let c=0;c<3;c++){positions[j+c]=sum[c]/total;normals[j+c]=sum[c+3]/total;}}
 }
 return {...cloud,positions,normals};
}
export function opticalCoverage(tau){return 1-Math.exp(-Math.max(0,tau));}
export function packConditioningGeometry(geometry,metadata){
 const {width,height,depth,normals}=geometry,count=width*height;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||depth.length!==count||normals.length!==count*3)throw Error('Invalid retained geometry');
 const header=new TextEncoder().encode(JSON.stringify({schema:'kaminos.conditioning-geometry.v1',width,height,metadata})),offset=4+Math.ceil(header.length/4)*4,bytes=new Uint8Array(offset+count*16);new DataView(bytes.buffer).setUint32(0,header.length,true);bytes.set(header,4);new Float32Array(bytes.buffer,offset,count).set(depth);new Float32Array(bytes.buffer,offset+count*4,count*3).set(normals);return bytes;
}
export function unpackConditioningGeometry(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(bytes.byteLength<4)throw Error('Incomplete retained geometry');const n=view.getUint32(0,true),offset=4+Math.ceil(n/4)*4;
 if(offset>bytes.length)throw Error('Incomplete retained geometry header');const header=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+n))),{width,height}=header,count=width*height;
 if(header.schema!=='kaminos.conditioning-geometry.v1'||!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||bytes.length!==offset+count*16)throw Error('Invalid retained geometry');
 const copy=bytes.slice();return {...header,depth:new Float32Array(copy.buffer,offset,count),normals:new Float32Array(copy.buffer,offset+count*4,count*3)};
}
export function conditioningSourceName(entry){
 const url=new URL(entry.source,'http://conditioning.local'),path=url.searchParams.get('path')??url.searchParams.get('file')??url.pathname,extension=/\.(png|jpe?g|webp)$/i.exec(path)?.[0];
 if(!extension)throw Error('Choose a PNG, JPEG or WebP source');return /\.(png|jpe?g|webp)$/i.test(entry.name??'')?entry.name:`${entry.name||'Conditioning source'}${extension}`;
}
