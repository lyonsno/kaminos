import {BufferGeometry,Float32BufferAttribute,Mesh,MeshStandardMaterial} from './lib/three.core.js';

export const STAGE_MOLD_SOURCE='kaminos:stage-mold-v1';
export function checkedStageMold(value){
 if(value?.schema!=='kaminos.stage-mold.v1'||typeof value.label!=='string'||!value.label.trim())throw Error('Stage mold requires a label');
 const {rows}=value;
 if(!Array.isArray(rows)||rows.length<3||typeof rows[0]!=='string'||rows[0].length<3||rows.some(r=>typeof r!=='string'||r.length!==rows[0].length||/[^.#]/.test(r)))throw Error('Stage mold requires a rectangular solid/channel raster');
 if(!rows.some(r=>r.includes('.'))||!rows.some(r=>r.includes('#')))throw Error('Stage mold requires both channels and walls');
 for(const key of ['pitch','wallHeight','baseThickness'])if(!Number.isFinite(value[key])||value[key]<=0)throw Error(`Invalid stage mold ${key}`);
 return {schema:value.schema,label:value.label,rows:[...rows],pitch:value.pitch,wallHeight:value.wallHeight,baseThickness:value.baseThickness};
}

// Squared Euclidean distance transform, separable lower envelopes of parabolas.
function distanceTo(rows,ink){
 const w=rows[0].length,h=rows.length,out=new Float64Array(w*h),size=Math.max(w,h),v=new Int32Array(size),z=new Float64Array(size+1),f=new Float64Array(size),d=new Float64Array(size);
 function pass(n){
  let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
  for(let q=1;q<n;q++){
   let s;do{s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));if(s>z[k])break;k--;}while(k>=0);
   k++;v[k]=q;z[k]=s;z[k+1]=Infinity;
  }
  k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]];}
 }
 for(let y=0;y<h;y++){for(let x=0;x<w;x++)f[x]=rows[y][x]===ink?0:1e12;pass(w);for(let x=0;x<w;x++)out[y*w+x]=d[x];}
 for(let x=0;x<w;x++){for(let y=0;y<h;y++)f[y]=out[y*w+x];pass(h);for(let y=0;y<h;y++)out[y*w+x]=d[y];}
 return out;
}
const fields=new WeakMap();
export function stageMoldField(value){
 if(fields.has(value))return fields.get(value);
 const p=checkedStageMold(value),width=p.rows[0].length,height=p.rows.length,solid=distanceTo(p.rows,'#'),empty=distanceTo(p.rows,'.'),data=new Float32Array(width*height);
 for(let i=0;i<data.length;i++)data[i]=(p.rows[Math.floor(i/width)][i%width]==='#'?-(Math.sqrt(empty[i])-.5):Math.sqrt(solid[i])-.5)*p.pitch;
 const result={width,height,data};fields.set(value,result);return result;
}
const box2=(x,z,hx,hz)=>{const a=Math.abs(x)-hx,b=Math.abs(z)-hz;return Math.min(Math.max(a,b),0)+Math.hypot(Math.max(a,0),Math.max(b,0));};
const extrude=(d,y,lo,hi)=>{const b=Math.abs(y-(hi+lo)/2)-(hi-lo)/2;return Math.min(Math.max(d,b),0)+Math.hypot(Math.max(d,0),Math.max(b,0));};
export function stageMoldDistance(p,q){
 const f=stageMoldField(p),hx=f.width*p.pitch/2,hz=f.height*p.pitch/2;
 const px=Math.max(0,Math.min(f.width-1,(q[0]+hx)/p.pitch-.5)),pz=Math.max(0,Math.min(f.height-1,(q[2]+hz)/p.pitch-.5)),x=Math.floor(px),z=Math.floor(pz),tx=px-x,tz=pz-z;
 const sample=(x,z)=>f.data[Math.min(z,f.height-1)*f.width+Math.min(x,f.width-1)];
 const sd=(sample(x,z)*(1-tx)+sample(x+1,z)*tx)*(1-tz)+(sample(x,z+1)*(1-tx)+sample(x+1,z+1)*tx)*tz;
 const edge=box2(q[0],q[2],hx,hz);
 return Math.min(extrude(Math.max(sd,edge),q[1],0,p.wallHeight),extrude(edge,q[1],-p.baseThickness,0));
}
export function stageMoldNormal(p,q){
 const e=p.pitch*.25,g=[0,1,2].map(k=>{const a=[...q],b=[...q];a[k]+=e;b[k]-=e;return stageMoldDistance(p,a)-stageMoldDistance(p,b);}),n=Math.hypot(...g);
 return n>1e-10?g.map(v=>v/n):[0,1,0];
}

export function createStageMold(value){
 const p=checkedStageMold(value),w=p.rows[0].length,h=p.rows.length,vertices=[],normals=[];
 const point=(x,y,z)=>[(x-w/2)*p.pitch,y,(z-h/2)*p.pitch];
 function quad(a,b,c,d,n){for(const v of [a,b,c,a,c,d]){vertices.push(...v);normals.push(...n);}}
 const height=(x,z)=>x>=0&&z>=0&&x<w&&z<h?(p.rows[z][x]==='#'?p.wallHeight:0):-p.baseThickness;
 for(let z=0;z<h;z++){
  for(let x=0;x<w;){let end=x+1,y=height(x,z);while(end<w&&height(end,z)===y)end++;
   quad(point(x,y,z),point(x,y,z+1),point(end,y,z+1),point(end,y,z),[0,1,0]);x=end;}
  for(let x=0;x<w;x++){
   const y=height(x,z);
   for(const [dx,dz]of [[-1,0],[1,0],[0,-1],[0,1]]){
    const lower=height(x+dx,z+dz);if(lower>=y)continue;
    if(dx===-1)quad(point(x,lower,z),point(x,lower,z+1),point(x,y,z+1),point(x,y,z),[-1,0,0]);
    if(dx===1)quad(point(x+1,lower,z+1),point(x+1,lower,z),point(x+1,y,z),point(x+1,y,z+1),[1,0,0]);
    if(dz===-1)quad(point(x+1,lower,z),point(x,lower,z),point(x,y,z),point(x+1,y,z),[0,0,-1]);
    if(dz===1)quad(point(x,lower,z+1),point(x+1,lower,z+1),point(x+1,y,z+1),point(x,y,z+1),[0,0,1]);
   }
  }
 }
 quad(point(0,-p.baseThickness,h),point(0,-p.baseThickness,0),point(w,-p.baseThickness,0),point(w,-p.baseThickness,h),[0,-1,0]);
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));geometry.computeBoundingBox();geometry.computeBoundingSphere();
 const object=new Mesh(geometry,new MeshStandardMaterial({color:0x887b69,roughness:.85,metalness:0}));
 object.name=p.label+' · casting mold';object.castShadow=true;object.receiveShadow=true;object.userData.kaminosStageMold=p;return object;
}
export function stageWordMold(document,label='DENOISER'){
 if(typeof label!=='string'||!label.trim())throw Error('Enter a stage word');
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 ctx.font='900 48px monospace';const width=Math.ceil(ctx.measureText(label).width)+32;
 canvas.width=width;canvas.height=96;ctx.font='900 48px monospace';ctx.textBaseline='alphabetic';ctx.fillStyle='white';ctx.fillText(label,16,58);
 const data=ctx.getImageData(0,0,width,96).data,rows=[];
 // A shared runner and short risers feed disconnected glyphs from one pour.
 // They are ordinary open channels in the same saved mold, not animated fill.
 const mask=Array.from({length:96},(_,z)=>Array.from({length:width},(_,x)=>data[(z*width+x)*4+3]>=128));
 for(let x=12;x<width-12;x++)for(let z=68;z<78;z++)mask[z][x]=true;
 let inGlyph=false;
 for(let x=0;x<width;x++){
  const occupied=mask.slice(0,64).some(row=>row[x]);
  if(occupied&&!inGlyph){let end=x;while(end+1<width&&mask.slice(0,64).some(row=>row[end+1]))end++;
   const mid=Math.floor((x+end)/2);for(let a=mid-3;a<=mid+3;a++)for(let z=45;z<73;z++)mask[z][a]=true;
  }inGlyph=occupied;
 }
 for(let z=0;z<96;z++)rows.push(mask[z].map(v=>v?'.':'#').join(''));
 return checkedStageMold({schema:'kaminos.stage-mold.v1',label,pitch:.025,wallHeight:.18,baseThickness:.1,rows});
}
export const stageMoldRecordDomain={type:'pbr',source:STAGE_MOLD_SOURCE,
 recognize:object=>Boolean(object?.userData?.kaminosStageMold),
 check:r=>({...r,stageMold:checkedStageMold(r.stageMold)}),fields:r=>({stageMold:r.stageMold}),
 capture:entry=>({stageMold:checkedStageMold(entry.object.userData.kaminosStageMold)}),
 reloadable:r=>{checkedStageMold(r.stageMold);return true;},
 load:(r,loaders,options)=>loaders.constructed(createStageMold(r.stageMold),r,options)};
