// Exact fine-disc payload control. No learned compression is claimed here.
export const MICRO_DISC_WGSL = `fn micro_disc_hit(ro:vec3<f32>,rd:vec3<f32>,p:vec3<f32>,n:vec3<f32>,r:f32)->f32 {
 let denom=dot(rd,n);
 if(abs(denom)<1e-8*length(rd)*length(n)){return -1.0;}
 let t=dot(p-ro,n)/denom;
 if(t<0.0){return -1.0;}
 let offset=ro+rd*t-p;
 if(dot(offset,offset)>r*r){return -1.0;}
 return t;
}`;

export const MICRO_NEAREST_WGSL = `fn micro_nearest(ro:vec3<f32>,rd:vec3<f32>,r:f32,start:u32,count:u32,
 rows:ptr<storage,array<vec4<f32>>,read>)->vec2<f32> {
 var best=vec2<f32>(-1.0,-1.0);
 for(var j=start;j<start+count;j++){
  let a=(*rows)[j*3u];let b=(*rows)[j*3u+1u];let c=(*rows)[j*3u+2u];
  if(c.w<=0.0){continue;}
  let t=micro_disc_hit(ro,rd,a.xyz,vec3<f32>(a.w,b.xy),r);
  if(t>=0.0 && (best.x<0.0 || t<best.x)){best=vec2<f32>(t,f32(j));}
 }
 return best;
}`;

export function intersectDisc(origin,direction,center,normal,radius) {
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const denom=dot(direction,normal);
  if(Math.abs(denom)<1e-8*Math.hypot(...direction)*Math.hypot(...normal))return null;
  const t=dot(center.map((p,a)=>p-origin[a]),normal)/denom;
  if(t<0)return null;
  const offset=center.map((p,a)=>origin[a]+direction[a]*t-p);
  return dot(offset,offset)<=radius*radius?t:null;
}

export function packMicrostructure(data,{radius,cellSize,sourceIds=null}={}) {
  if(!(data instanceof Float32Array)||!data.length||data.length%12)throw Error('Complete nonempty 12-float source rows required');
  if(!Number.isFinite(radius)||radius<=0)throw Error('Positive finite radius required');
  if(!Number.isFinite(cellSize)||cellSize<=0)throw Error('Positive finite carrier cell size required');
  const count=data.length/12;
  if(sourceIds!==null&&(!(sourceIds instanceof Uint32Array)||sourceIds.length!==count))throw Error('One source ID per row required');
  const bins=new Map();let alphaMin=Infinity,alphaMax=-Infinity;
  for(let i=0;i<count;i++){
    const o=i*12;
    for(let a=0;a<12;a++)if(!Number.isFinite(data[o+a]))throw Error(`Nonfinite source row ${i}`);
    if(Math.hypot(data[o+3],data[o+4],data[o+5])<1e-8)throw Error(`Invalid source normal ${i}`);
    alphaMin=Math.min(alphaMin,data[o+11]);alphaMax=Math.max(alphaMax,data[o+11]);
    const key=[0,1,2].map(a=>Math.floor(data[o+a]/cellSize)).join(',');
    if(!bins.has(key))bins.set(key,[]);bins.get(key).push(i);
  }
  // Layout: min.xyz, max.xyz, first row, row count. Bounds include fine support
  // outside the grouping cell, so grazing rays cannot lose edge discs.
  const carriers=new Float32Array(bins.size*8),rows=new Float32Array(data.length),ids=new Uint32Array(count);
  let cursor=0,c=0,maxChildren=0;
  for(const children of bins.values()){
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],start=cursor;
    for(const i of children){
      rows.set(data.subarray(i*12,i*12+12),cursor*12);ids[cursor]=sourceIds?sourceIds[i]:i;
      for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],data[i*12+a]-radius);hi[a]=Math.max(hi[a],data[i*12+a]+radius);}
      cursor++;
    }
    carriers.set([...lo,...hi,start,children.length],c++*8);maxChildren=Math.max(maxChildren,children.length);
  }
  return {rows,carriers,sourceIds:ids,count,carrierCount:bins.size,radius,cellSize,maxChildren,alpha:{min:alphaMin,max:alphaMax}};
}

export function traceMicrostructure(field,origin,direction) {
  let best=null;
  for(let i=0;i<field.count;i++){
    const o=i*12;if(field.rows[o+11]<=0)continue;
    const t=intersectDisc(origin,direction,field.rows.subarray(o,o+3),field.rows.subarray(o+3,o+6),field.radius);
    if(t!==null&&(!best||t<best.t||(t===best.t&&field.sourceIds[i]<best.sourceId)))best={t,sourceId:field.sourceIds[i]};
  }
  return best;
}
