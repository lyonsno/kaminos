// Camera-space reconstruction and history validation. Radiance remains HDR and
// premultiplied by screen-hit coverage; source geometry/direct light is untouched.
export const SCENE_REFLECTION_RECONSTRUCTION_WGSL=/* wgsl */`
fn reflectionEncodeMoment(value:f32)->f32{return log2(1.0+max(value,0.0));}
fn reflectionDecodeMoment(value:f32)->f32{return max(0.0,exp2(value)-1.0);}
fn reflectionFilterPosition(uv:vec2<f32>,depth:f32,inverseProjection:mat4x4<f32>)->vec3<f32>{
 let p=inverseProjection*vec4<f32>(uv.x*2.0-1.0,1.0-uv.y*2.0,depth,1.0);return p.xyz/p.w;
}
fn reflectionPreviousUV(p:vec3<f32>,distance:f32,toPrevious:mat4x4<f32>,projection:mat4x4<f32>)->vec3<f32>{
 let virtualPoint=p+normalize(p)*distance;let clip=projection*toPrevious*vec4<f32>(virtualPoint,1.0);
 if(clip.w<=0.000001){return vec3<f32>(0.0);}
 let q=vec2<f32>(clip.x/clip.w*.5+.5,.5-clip.y/clip.w*.5);
 let inside=all(q>=vec2<f32>(0.0))&&all(q<=vec2<f32>(1.0));return vec3<f32>(q,select(0.0,1.0,inside));
}
fn reflectionGeometryWeight(depth:f32,expected:f32,normal:vec3<f32>,expectedNormal:vec3<f32>,roughness:f32,expectedRoughness:f32)->f32{
 let tolerance=max(.015,abs(expected)*.01);let error=abs(depth-expected);let agreement=dot(normal,expectedNormal);
 if(expected<=0.0||error>tolerance||agreement<.95||abs(roughness-expectedRoughness)>.08){return 0.0;}
 return exp(-error/tolerance)*pow(max(agreement,0.0),32.0)*exp(-abs(roughness-expectedRoughness)*16.0);
}
fn reflectionHistoryAt(coords:vec2<f32>,previousPoint:vec3<f32>,previousNormal:vec3<f32>,roughness:f32,distance:f32,distanceVariance:f32,
 oldColor:texture_2d<f32>,oldNormal:texture_2d<f32>,oldDepth:texture_2d<f32>,oldStats:texture_2d<f32>,previousInverseProjection:mat4x4<f32>)->mat4x4<f32>{
 let size=vec2<i32>(textureDimensions(oldColor));let grid=coords*vec2<f32>(size)-.5;let base=vec2<i32>(floor(grid));let fraction=fract(grid);
 var color=vec4<f32>(0.0);var stats=vec4<f32>(0.0);var total=0.0;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let pixel=base+vec2<i32>(x,y);if(any(pixel<vec2<i32>(0))||any(pixel>=size)){continue;}
  let q=(vec2<f32>(pixel)+.5)/vec2<f32>(size);let ray=reflectionFilterPosition(q,1.0,previousInverseProjection);
  let denominator=dot(previousNormal,ray);if(abs(denominator)<0.000001){continue;}
  let t=dot(previousNormal,previousPoint)/denominator;if(t<=0.0){continue;}
  let expected=-ray.z*t;let nr=textureLoad(oldNormal,pixel,0);let depth=textureLoad(oldDepth,pixel,0).r;
  var weight=reflectionGeometryWeight(depth,expected,nr.xyz,previousNormal,nr.w,roughness);
  let metadata=textureLoad(oldStats,pixel,0);let oldDistance=reflectionDecodeMoment(metadata.r);let oldVariance=reflectionDecodeMoment(metadata.g);
  if(distance>0.0&&oldDistance>0.0){
   let tolerance=max(.04,.15*(distance+oldDistance)+2.0*sqrt(distanceVariance+oldVariance));
   let delta=abs(distance-oldDistance);weight*=exp(-delta*delta/(tolerance*tolerance));
  }
  weight*=select(1.0-fraction.x,fraction.x,x==1)*select(1.0-fraction.y,fraction.y,y==1);
  color+=textureLoad(oldColor,pixel,0)*weight;stats+=metadata*weight;total+=weight;
 }}
 return mat4x4<f32>(color/max(total,.00001),stats/max(total,.00001),vec4<f32>(total,0.0,0.0,0.0),vec4<f32>(0.0));
}
fn reconstructSceneReflection(coords:vec2<f32>,current:texture_2d<f32>,currentStats:texture_2d<f32>,depthMap:texture_depth_2d,normalMap:texture_2d<f32>,
 oldColor:texture_2d<f32>,oldNormal:texture_2d<f32>,oldDepth:texture_2d<f32>,oldStats:texture_2d<f32>,
 inverseProjection:mat4x4<f32>,toPrevious:mat4x4<f32>,previousProjection:mat4x4<f32>,previousInverseProjection:mat4x4<f32>,historyValid:bool,historyWeight:f32,roughnessCutoff:f32)->mat4x4<f32>{
 let size=vec2<i32>(textureDimensions(current));let dimensions=vec2<i32>(textureDimensions(depthMap));
 let pixel=clamp(vec2<i32>(coords*vec2<f32>(dimensions)),vec2<i32>(0),dimensions-vec2<i32>(1));
 let depth=textureLoad(depthMap,pixel,0);let nr=textureLoad(normalMap,pixel,0);
 var resolved=vec4<f32>(0.0);var metadata=vec4<f32>(0.0);var metricDepth=0.0;
 if(depth>=1.0||dot(nr.xyz,nr.xyz)<.5){return mat4x4<f32>(resolved,nr,vec4<f32>(metricDepth,0.0,0.0,0.0),metadata);}
 let p=reflectionFilterPosition(coords,depth,inverseProjection);let n=normalize(nr.xyz);metricDepth=-p.z;
 if(nr.w>=roughnessCutoff){return mat4x4<f32>(resolved,nr,vec4<f32>(metricDepth,0.0,0.0,0.0),metadata);}
 let centre=clamp(vec2<i32>(coords*vec2<f32>(size)),vec2<i32>(0),size-vec2<i32>(1));let centreStats=textureLoad(currentStats,centre,0);
 let centreDistance=reflectionDecodeMoment(centreStats.r);let centreVariance=reflectionDecodeMoment(centreStats.g);
 let offsets=array<vec2<f32>,13>(vec2<f32>(0.0),vec2<f32>(1.0,0.0),vec2<f32>(-1.0,0.0),vec2<f32>(0.0,1.0),vec2<f32>(0.0,-1.0),vec2<f32>(1.0,1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,-1.0),vec2<f32>(2.0,0.0),vec2<f32>(-2.0,0.0),vec2<f32>(0.0,2.0),vec2<f32>(0.0,-2.0));
 var sum=vec4<f32>(0.0);var squared=vec3<f32>(0.0);var neighborhood=vec3<f32>(0.0);var neighborhoodWeight=0.0;var total=0.0;var distanceSum=0.0;var distanceSquared=0.0;var support=0.0;
 var lower=vec3<f32>(1e30);var upper=vec3<f32>(0.0);var maximumCoverage=0.0;
 let radius=.5+2.0*nr.w;let glossyFilter=smoothstep(.06,.2,nr.w);
 // Sharp samples retain their centre color; only a small cross is needed for
 // temporal clipping. Broad gloss uses the full reconstruction neighborhood.
 let taps=select(13u,5u,nr.w<=.06);
 for(var i=0u;i<taps;i++){
  let q=coords+offsets[i]*radius/vec2<f32>(size);if(any(q<vec2<f32>(0.0))||any(q>vec2<f32>(1.0))){continue;}
  let qp=clamp(vec2<i32>(q*vec2<f32>(size)),vec2<i32>(0),size-vec2<i32>(1));let actual=(vec2<f32>(qp)+.5)/vec2<f32>(size);
  let qpixel=clamp(vec2<i32>(actual*vec2<f32>(dimensions)),vec2<i32>(0),dimensions-vec2<i32>(1));let qdepth=textureLoad(depthMap,qpixel,0);if(qdepth>=1.0){continue;}
  let neighbor=textureLoad(normalMap,qpixel,0);let point=reflectionFilterPosition(actual,qdepth,inverseProjection);
  let plane=abs(dot(point-p,n))/max(.01,abs(p.z)*.003);
  var weight=exp(-plane)*pow(max(dot(n,neighbor.xyz),0.0),64.0)*exp(-abs(nr.w-neighbor.w)*16.0)*exp(-dot(offsets[i],offsets[i])*.25);
  let value=textureLoad(current,qp,0);let stats=textureLoad(currentStats,qp,0);if(stats.w<0.0){continue;}let distance=reflectionDecodeMoment(stats.r);let variance=reflectionDecodeMoment(stats.g);
  if(centreDistance>0.0&&distance>0.0){let tolerance=max(.04,.15*(centreDistance+distance)+2.0*sqrt(centreVariance+variance));let delta=centreDistance-distance;weight*=exp(-delta*delta/(tolerance*tolerance));}
  neighborhood+=value.rgb*weight;squared+=value.rgb*value.rgb*weight;neighborhoodWeight+=weight;
  let filterWeight=weight*select(glossyFilter,1.0,i==0u);sum+=value*filterWeight;total+=filterWeight;
  distanceSum+=distance*value.a*filterWeight;distanceSquared+=(variance+distance*distance)*value.a*filterWeight;support+=value.a*filterWeight;
  if(weight>.00001){lower=min(lower,value.rgb);upper=max(upper,value.rgb);maximumCoverage=max(maximumCoverage,value.a);}
 }
 resolved=sum/max(total,.00001);let mean=neighborhood/max(neighborhoodWeight,.00001);let variance=max(vec3<f32>(0.0),squared/max(neighborhoodWeight,.00001)-mean*mean);
 let brightness=dot(resolved.rgb,vec3<f32>(.2126,.7152,.0722));let currentVariance=dot(variance,vec3<f32>(.2126,.7152,.0722));
 let distance=distanceSum/max(support,.00001);let distanceVariance=max(0.0,distanceSquared/max(support,.00001)-distance*distance);
 metadata=vec4<f32>(reflectionEncodeMoment(distance),reflectionEncodeMoment(distanceVariance),reflectionEncodeMoment(currentVariance),0.0);
 if(historyValid&&historyWeight>0.0&&maximumCoverage>0.0){
  let previousPoint=(toPrevious*vec4<f32>(p,1.0)).xyz;let previousNormal=normalize((toPrevious*vec4<f32>(n,0.0)).xyz);
  let surfaceUV=reflectionPreviousUV(p,0.0,toPrevious,previousProjection);let mirrorUV=reflectionPreviousUV(p,distance,toPrevious,previousProjection);
  var surfaceHistory=mat4x4<f32>(vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0));var mirrorHistory=surfaceHistory;
  if(surfaceUV.z>0.0){surfaceHistory=reflectionHistoryAt(surfaceUV.xy,previousPoint,previousNormal,nr.w,distance,distanceVariance,oldColor,oldNormal,oldDepth,oldStats,previousInverseProjection);}
  if(mirrorUV.z>0.0){mirrorHistory=reflectionHistoryAt(mirrorUV.xy,previousPoint,previousNormal,nr.w,distance,distanceVariance,oldColor,oldNormal,oldDepth,oldStats,previousInverseProjection);}
  let surfaceScore=surfaceHistory[2].x*nr.w*nr.w;let mirrorScore=mirrorHistory[2].x*(1.0-nr.w*nr.w);
  var history=surfaceHistory;if(mirrorScore>surfaceScore){history=mirrorHistory;}
  let blend=historyWeight*clamp(history[2].x,0.0,1.0);
  let sigma=sqrt(variance);let lo=max(lower,resolved.rgb-2.5*sigma);let hi=min(upper,resolved.rgb+2.5*sigma);
  let old=vec4<f32>(clamp(history[0].rgb,lo,hi),clamp(history[0].a,0.0,maximumCoverage));
  let oldBrightness=dot(old.rgb,vec3<f32>(.2126,.7152,.0722));let oldVariance=reflectionDecodeMoment(history[1].b);
  resolved=mix(resolved,old,blend);
  metadata.b=reflectionEncodeMoment(mix(currentVariance,oldVariance,blend)+blend*(1.0-blend)*(oldBrightness-brightness)*(oldBrightness-brightness));metadata.a=blend;
 }
 return mat4x4<f32>(resolved,nr,vec4<f32>(metricDepth,0.0,0.0,0.0),metadata);
}
`;
