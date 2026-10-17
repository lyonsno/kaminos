// Fixed, progressive volume-point quadrature induces a known angular density.
// A sample selects a DIRECTION, not a point light: integrate its whole visible
// chord. Neighboring receivers share source points; nothing rotates per vertex.
export const SOURCE_LO=[-1,-1,-1], SOURCE_HI=[1,3,1], SOURCE_VOLUME=16;
function radicalInverse(index,base) {
  let value=0,scale=1/base;
  while(index){value+=(index%base)*scale;index=Math.floor(index/base);scale/=base;}
  return value;
}
export function progressiveSourcePoint(index,rotation=0) {
  if(!Number.isSafeInteger(index)||index<0||!Number.isFinite(rotation))throw new Error('finite progressive source index and rotation required');
  return [2,3,5].map((base,a)=>{
    const v=radicalInverse(index+1,base)+rotation/(2*Math.PI);
    return SOURCE_LO[a]+(SOURCE_HI[a]-SOURCE_LO[a])*(v-Math.floor(v));
  });
}
export function sourceInterval(p,d,limit=Infinity) {
  let near=0,far=limit;
  for(let a=0;a<3;a++){
    if(d[a]===0){if(p[a]<SOURCE_LO[a]||p[a]>SOURCE_HI[a])return [0,0];}
    else {const x=(SOURCE_LO[a]-p[a])/d[a],y=(SOURCE_HI[a]-p[a])/d[a];near=Math.max(near,Math.min(x,y));far=Math.min(far,Math.max(x,y));}
  }
  return far>near?[near,far]:[0,0];
}
export function sourceRaySample(p,index,rotation=0) {
  const point=progressiveSourcePoint(index,rotation);
  const v=point.map((x,a)=>x-p[a]),length=Math.hypot(...v);
  // A volume receiver coinciding with a quadrature point is measure zero. Use
  // a declared deterministic direction, retaining its actual angular PDF.
  const direction=length>0?v.map(x=>x/length):[0,1,0];
  const span=sourceInterval(p,direction),[a,b]=span;
  const pdf=(b-a)*(b*b+b*a+a*a)/(3*SOURCE_VOLUME);
  return {point,direction,pdf,span};
}
// Independent CPU reference for the production piecewise-constant-cell model.
export function integrateCellRay(sample,dimensions,p,d,limit=Infinity) {
  const [near,far]=sourceInterval(p,d,limit),out=[0,0,0];
  if(far<=near)return out;
  const pitch=dimensions.map((n,a)=>(SOURCE_HI[a]-SOURCE_LO[a])/n);
  const cell=p.map((x,a)=>{
    const u=(x+d[a]*near-SOURCE_LO[a])/pitch[a];
    return Math.max(0,Math.min(dimensions[a]-1,d[a]<0?Math.ceil(u)-1:Math.floor(u)));
  });
  const step=d.map(Math.sign);
  const crossing=()=>cell.map((c,a)=>d[a]===0?Infinity:(SOURCE_LO[a]+(c+(d[a]>0?1:0))*pitch[a]-p[a])/d[a]);
  let t=near,transmission=1;
  while(t<far&&cell.every((c,a)=>c>=0&&c<dimensions[a])){
    const next=crossing(),end=Math.min(far,...next),ds=Math.max(0,end-t);
    if(ds>0){
      const m=sample([...cell]),sigma=Math.max(0,m[3]);
      const w=sigma?-Math.expm1(-sigma*ds)/sigma:ds;
      for(let k=0;k<3;k++)out[k]+=transmission*m[k]*w;
      transmission*=Math.exp(-sigma*ds);
    }
    if(end>=far)break;
    for(let a=0;a<3;a++)if(next[a]<=end)cell[a]+=step[a];
    t=Math.max(t,end);
  }
  return out;
}

export const SOURCE_AWARE_BODY_WGSL=`
fn sourceDirection(p:vec3<f32>,a:u32)->vec3<f32> {
  let v=directions[a].xyz-p;
  if(dot(v,v)==0.0){return vec3<f32>(0.0,1.0,0.0);}
  return normalize(v);
}
fn uniformSourcePdf(p:vec3<f32>,d:vec3<f32>)->f32 {
  let span=interval(p,d,vec3<f32>(-1.0),vec3<f32>(1.0,3.0,1.0),1e30);
  if(span.y<=span.x){return 0.0;}
  return (span.y-span.x)*(span.y*span.y+span.y*span.x+span.x*span.x)/48.0;
}
fn integrateCells(p:vec3<f32>,d:vec3<f32>,limit:f32)->vec3<f32> {
  let lo=vec3<f32>(-1.0);let hi=vec3<f32>(1.0,3.0,1.0);
  let span=interval(p,d,lo,hi,limit);
  if(span.y<=span.x){return vec3<f32>(0.0);}
  let dims=vec3<i32>(textureDimensions(coefficients));
  let pitch=(hi-lo)/vec3<f32>(dims);
  let u=(p+d*span.x-lo)/pitch;
  var cell=clamp(vec3<i32>(select(floor(u),ceil(u)-vec3<f32>(1.0),d<vec3<f32>(0.0))),vec3<i32>(0),dims-1);
  let step=vec3<i32>(sign(d));
  var t=span.x;var transmission=1.0;var radiance=vec3<f32>(0.0);
  loop {
    if(t>=span.y||any(cell<vec3<i32>(0))||any(cell>=dims)){break;}
    var crossing=vec3<f32>(1e30);
    for(var a=0u;a<3u;a++){
      if(d[a]!=0.0){crossing[a]=(lo[a]+(f32(cell[a])+select(0.0,1.0,d[a]>0.0))*pitch[a]-p[a])/d[a];}
    }
    let end=min(span.y,min(crossing.x,min(crossing.y,crossing.z)));
    let ds=max(0.0,end-t);
    if(ds>0.0){
      let m=textureLoad(coefficients,cell,0);let sigma=max(0.0,m.a);let tau=sigma*ds;
      var weight=ds*(1.0-tau*0.5+tau*tau/6.0);
      if(tau>=0.001){weight=(1.0-exp(-tau))/sigma;}
      radiance+=transmission*m.rgb*weight;transmission*=exp(-tau);
    }
    if(end>=span.y){break;}
    for(var a=0u;a<3u;a++){if(crossing[a]<=end){cell[a]+=step[a];}}
    t=max(t,end);
  }
  return radiance;
}
`;
export const SOURCE_AWARE_WGSL=SOURCE_AWARE_BODY_WGSL+`
fn sourcePdf(p:vec3<f32>,d:vec3<f32>)->f32 {return uniformSourcePdf(p,d);}
`;
