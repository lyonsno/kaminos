// Translate and clip a surface into a single canonical repeating cell. Surface
// area is retained; triangles crossing a boundary reappear on its other side.
export function periodicSurfaceTriangles(triangles,width,depth){
 const result=[],half=[width/2,depth/2];
 const clip=(polygon,axis,bound,keepAbove)=>{
  const out=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],inside=p=>keepAbove?p[axis]>=bound:p[axis]<=bound,aa=inside(a),bb=inside(b);
   if(aa)out.push(a);if(aa!==bb){const t=(bound-a[axis])/(b[axis]-a[axis]),p=a.map((v,k)=>v+t*(b[k]-v));p[axis]=bound;out.push(p);}}
  return out;
 };
 for(const tri of triangles){
  const points=[tri.a,tri.b,tri.c],xs=points.map(p=>p[0]),zs=points.map(p=>p[2]);
  for(let z=Math.floor((Math.min(...zs)+half[1])/depth);z<=Math.floor((Math.max(...zs)+half[1])/depth);z++)for(let x=Math.floor((Math.min(...xs)+half[0])/width);x<=Math.floor((Math.max(...xs)+half[0])/width);x++){
   let polygon=points.map(p=>[p[0]-x*width,p[1],p[2]-z*depth]);
   for(const [axis,h]of [[0,half[0]],[2,half[1]]]){polygon=clip(polygon,axis,-h,true);polygon=clip(polygon,axis,h,false);}
   for(let i=1;i+1<polygon.length;i++){
    const [a,b,c]=[polygon[0],polygon[i],polygon[i+1]],u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]);
    if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])===0)continue;
    result.push({...tri,a,b,c,identity:`${tri.identity}:cell:${x}:${z}:${i-1}`});
   }
  }
 }
 return result;
}
