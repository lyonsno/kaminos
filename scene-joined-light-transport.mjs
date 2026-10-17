// The fine box replaces (never adds to) overlapping exterior storage. Traverse
// at most three ordered spans: exterior, fine, exterior, retaining transmittance.
export const JOINED_LIGHT_TRANSPORT_WGSL=`
@group(0) @binding(11) var exteriorCoefficients:texture_3d<f32>;
fn joinedGridSegment(p:vec3<f32>,d:vec3<f32>,span:vec2<f32>,fine:bool)->vec4<f32>{
  if(span.y<=span.x){return vec4<f32>(0,0,0,1);}
  var lo=SOURCE_DOMAIN_LO;var hi=SOURCE_DOMAIN_HI;
  var dims=vec3<i32>(textureDimensions(exteriorCoefficients));
  if(fine){lo=FINE_SOURCE_LO;hi=FINE_SOURCE_HI;dims=vec3<i32>(textureDimensions(coefficients));}
  let pitch=(hi-lo)/vec3<f32>(dims);let u=(p+d*span.x-lo)/pitch;
  var cell=clamp(vec3<i32>(select(floor(u),ceil(u)-vec3<f32>(1),d<vec3<f32>(0))),vec3<i32>(0),dims-1);
  let step=vec3<i32>(sign(d));var t=span.x;var transmittance=1.0;var radiance=vec3<f32>(0);
  loop{
    if(t>=span.y||any(cell<vec3<i32>(0))||any(cell>=dims)){break;}
    var crossing=vec3<f32>(1e30);
    for(var a=0u;a<3u;a++){if(d[a]!=0.0){crossing[a]=(lo[a]+(f32(cell[a])+select(0.0,1.0,d[a]>0.0))*pitch[a]-p[a])/d[a];}}
    let end=min(span.y,min(crossing.x,min(crossing.y,crossing.z)));let ds=max(0.0,end-t);
    if(ds>0.0){
      var m:vec4<f32>;if(fine){m=textureLoad(coefficients,cell,0);}else{m=textureLoad(exteriorCoefficients,cell,0);}
      let sigma=max(0.0,m.a);let tau=sigma*ds;var weight=ds*(1.0-tau*.5+tau*tau/6.0);
      if(tau>=.001){weight=(1.0-exp(-tau))/sigma;}
      radiance+=transmittance*m.rgb*weight;transmittance*=exp(-tau);
    }
    if(end>=span.y){break;}
    for(var a=0u;a<3u;a++){if(crossing[a]<=end){cell[a]+=step[a];}}
    t=max(t,end);
  }
  return vec4<f32>(radiance,transmittance);
}
fn integrateJoinedRay(p:vec3<f32>,d:vec3<f32>,limit:f32)->vec3<f32>{
  let outer=interval(p,d,SOURCE_DOMAIN_LO,SOURCE_DOMAIN_HI,limit);
  if(outer.y<=outer.x){return vec3<f32>(0);}
  let fine=interval(p,d,FINE_SOURCE_LO,FINE_SOURCE_HI,limit);
  let start=max(outer.x,fine.x);let end=min(outer.y,fine.y);
  if(end<=start){return joinedGridSegment(p,d,outer,false).rgb;}
  let before=joinedGridSegment(p,d,vec2<f32>(outer.x,start),false);
  let inside=joinedGridSegment(p,d,vec2<f32>(start,end),true);
  let after=joinedGridSegment(p,d,vec2<f32>(end,outer.y),false);
  return before.rgb+before.a*(inside.rgb+inside.a*after.rgb);
}
`;
