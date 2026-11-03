// Generalized winding of oriented segments, including open chains. Endpoint
// angles cancel only at exactly equal coordinates; no welding or approximation.
export function createSectionWinding(segments){
 const endpoints=new Map(),edges=new Float64Array(segments.length*4);
 for(let i=0;i<segments.length;i++){const [a,b]=segments[i];edges.set([...a,...b],i*4);for(const [p,sign]of [[a,-1],[b,1]]){const key=p.join(',');const value=endpoints.get(key)??[p[0],p[1],0];value[2]+=sign;endpoints.set(key,value);}}
 const residual=Float64Array.from([...endpoints.values()].filter(p=>p[2]).flat());
 const direct=(x,y)=>{let sum=0;for(let i=0;i<edges.length;i+=4){const ax=edges[i]-x,ay=edges[i+1]-y,bx=edges[i+2]-x,by=edges[i+3]-y;sum+=Math.atan2(ax*by-ay*bx,ax*bx+ay*by);}return sum/(2*Math.PI);};
 return (x,y)=>{
  let turns=0;
  for(let i=0;i<edges.length;i+=4){const ay=edges[i+1]-y,by=edges[i+3]-y;
   // Preserve atan2's original signed-zero and on-segment conventions.
   if(ay===0||by===0)return direct(x,y);
   if((ay>0)===(by>0))continue;
   const cross=(edges[i]-x)*by-ay*(edges[i+2]-x);
   if(cross===0)return direct(x,y);
   if(ay>0&&cross>0)turns++;else if(ay<0&&cross<0)turns--;
  }
  let angle=0;for(let i=0;i<residual.length;i+=3)angle+=residual[i+2]*Math.atan2(residual[i+1]-y,residual[i]-x);
  return turns+angle/(2*Math.PI);
 };
}
