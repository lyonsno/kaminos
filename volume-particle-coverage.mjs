const flat=Object.freeze([Object.freeze([0,1]),Object.freeze([1,1])]);
export function particleCoverage(value={}){
 const {basis='lifetime',footprint=flat,opacity=flat}=value;
 if(basis!=='lifetime'&&basis!=='mixing')throw Error('Unknown particle coverage basis');
 const knots=(points)=>{
  if(!Array.isArray(points)||points.length<2)throw Error('Coverage needs both endpoints');
  const result=points.map(point=>{
   if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||point[1]<0||!Number.isFinite(Math.fround(point[1])))throw Error('Coverage knots need finite coordinates and a nonnegative multiplier');
   return point.map(Math.fround);
  });
  if(result[0][0]!==0||result.at(-1)[0]!==1||result.some(([x],i)=>i&&x<=result[i-1][0]))throw Error('Coverage knots must be strictly ordered from zero to one');
  return result;
 };
 return {basis,footprint:knots(footprint),opacity:knots(opacity)};
}

export const PARTICLE_COVERAGE_WGSL=/* wgsl */`
struct CoverageCurves { counts:vec2<u32>, basis:u32, spare:u32, points:array<vec2<f32>> }
@group(0) @binding(10) var<storage,read> coverage:CoverageCurves;
fn coverageAt(t:f32,start:u32,count:u32)->f32{
 var low=start;var high=start+count-1u;
 while(high-low>1u){let mid=low+(high-low)/2u;if(t<coverage.points[mid].x){high=mid;}else{low=mid;}}
 let a=coverage.points[low];let b=coverage.points[high];
 return mix(a.y,b.y,clamp((t-a.x)/(b.x-a.x),0.0,1.0));
}
fn coverageStyle(p:Particle,u:Options)->vec2<f32>{
 if(all(coverage.counts==vec2<u32>(0u))){return vec2<f32>(1.0);}
 let age=max(0.0,p.anchor.w-1.0);
 var life=p.motion.w;
 if(u.gain.z>0){life=max(life,age/u.gain.z);}
 if(u.lifeControl.x==0&&u.gain.z==0){life=0.0;}
 if(coverage.basis==1u&&p.emission.w>0.0){life=1.0-p.state.x/p.emission.w;}
 var style=vec2<f32>(1.0);
 if(coverage.counts.x>0u){style.x=coverageAt(life,0u,coverage.counts.x);}
 if(coverage.counts.y>0u){style.y=coverageAt(life,coverage.counts.x,coverage.counts.y);}
 return style;
}
`;

export function coverageBufferData({basis,footprint,opacity}){
 const active=points=>points.every(([,y])=>y===1)?[]:points;
 const f=active(footprint),o=active(opacity),data=new ArrayBuffer(16+8*(f.length+o.length));
 new Uint32Array(data,0,4).set([f.length,o.length,Number(basis==='mixing'),0]);
 const xy=new Float32Array(data,16);let i=0;
 for(const points of [f,o])for(const [x,y] of points){xy[i++]=x;xy[i++]=y;}
 return data;
}
