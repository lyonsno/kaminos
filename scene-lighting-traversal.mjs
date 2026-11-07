export const FINE_LIGHTING_TRAVERSAL_WGSL=/* wgsl */`
var<private> fineRaySourceReads:u32=0u;
fn readOpticalCell(c:vec3<i32>)->vec4<f32>{fineRaySourceReads++;return textureLoad(coefficients,c,0);}

fn activeOpticalSpan(p:vec3<f32>,d:vec3<f32>,limit:f32)->vec2<f32>{
 if(sourceBounds[1].w==0u){return interval(p,d,vec3<f32>(-1),sourceDomainHi(),limit);}
 let dims=textureDimensions(coefficients);let low=sourceBounds[0].xyz;let high=sourceBounds[1].xyz;
 if(any(high<=low)){return vec2<f32>(1,-1);}
 let pitch=2.0/f32(dims.x);
 return interval(p,d,vec3<f32>(-1)+vec3<f32>(low)*pitch,vec3<f32>(-1)+vec3<f32>(high)*pitch,limit);
}
fn integrateFineRayPhased(p:vec3<f32>,d:vec3<f32>,limit:f32,phase:f32)->vec4<f32> {
  if(SOURCE_PATTERN){return integrateCellsTransfer(p,d,limit);}
  let span=interval(p,d,vec3<f32>(-1.0),sourceDomainHi(),limit);
  if(span.y<=span.x){return vec4<f32>(0,0,0,1);}
  let count=u32(ceil((span.y-span.x)/settings.y));let ds=(span.y-span.x)/f32(count);
  let occupiedSpan=activeOpticalSpan(p,d,limit);
  if(occupiedSpan.y<occupiedSpan.x){return vec4<f32>(0,0,0,1);}
  let first=u32(clamp(ceil((occupiedSpan.x-span.x)/ds-phase),0.0,f32(count)));
  let last=u32(clamp(floor((occupiedSpan.y-span.x)/ds-phase)+1.0,0.0,f32(count)));
  let dims=textureDimensions(coefficients);let pitch=2.0/f32(dims.x);
  var radiance=vec3<f32>(0.0);var transmission=1.0;
  for(var i=first;i<last;i++) {
    let samplePosition=p+d*(span.x+(f32(i)+phase)*ds);
    let c=clamp(vec3<i32>(floor((samplePosition+vec3<f32>(1.0))/pitch)),vec3<i32>(0),vec3<i32>(dims)-1);
    let m=readOpticalCell(c);let sigma=max(0.0,m.a);let tau=sigma*ds;
    var weight=ds*(1.0-tau*0.5+tau*tau/6.0);
    if(tau>=0.001){weight=(1.0-exp(-tau))/sigma;}
    radiance+=transmission*m.rgb*weight;transmission*=exp(-tau);
    if(transmission==0.0){break;}
  }
  return vec4<f32>(radiance,transmission);
}
`;

export function lightingCellTraversalCode(code){return code
 .replace('let span=interval(p,d,lo,hi,limit);','let span=activeOpticalSpan(p,d,limit);')
 .replace('let m=textureLoad(coefficients,cell,0);','let m=readOpticalCell(cell);')
 .replace('t=max(t,end);','t=max(t,end);if(transmission==0.0){break;}');}


export const LIGHTING_INTERVAL_WGSL=/* wgsl */`
fn interval(p:vec3<f32>,d:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>,limit:f32)->vec2<f32> {
  var near=0.0;var far=limit;
  for(var a=0u;a<3u;a++) {
    if(abs(d[a])<1e-20) {if(p[a]<lo[a]||p[a]>hi[a]) {return vec2<f32>(1.0,-1.0);}}
    else {let t0=(lo[a]-p[a])/d[a];let t1=(hi[a]-p[a])/d[a];near=max(near,min(t0,t1));far=min(far,max(t0,t1));}
  }
  return vec2<f32>(near,far);
}
`;
