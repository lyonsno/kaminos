// Diagnostic crop: retain triangles touching a source vertex inside the box.
// Boundary triangles stay whole. No clipping, interpolation or normal rebuilding.
export function cropSurfaceField(data,triangles,bounds){
 if(!(data instanceof Float32Array)||data.length%12||!data.every(Number.isFinite)||!(triangles instanceof Uint32Array)||triangles.length%3)throw Error('Invalid source fields');
 if(!Array.isArray(bounds)||bounds.length!==2||bounds.some(b=>b.length!==3||!b.every(Number.isFinite))||bounds[0].some((v,a)=>v>bounds[1][a]))throw Error('Invalid crop bounds');
 const count=data.length/12,inside=new Uint8Array(count),keep=new Uint8Array(count),triangleIds=[];
 for(let i=0;i<count;i++)inside[i]=[0,1,2].every(a=>data[i*12+a]>=bounds[0][a]&&data[i*12+a]<=bounds[1][a]);
 for(let t=0;t<triangles.length;t+=3){
  const a=triangles[t],b=triangles[t+1],c=triangles[t+2];if(a>=count||b>=count||c>=count)throw Error('Invalid source triangle');
  if(inside[a]||inside[b]||inside[c]){triangleIds.push(t/3);keep[a]=keep[b]=keep[c]=1;}
 }
 const sourceIds=[];for(let i=0;i<count;i++)if(keep[i]||inside[i])sourceIds.push(i);
 if(!sourceIds.length||!triangleIds.length)throw Error('Empty surface crop');
 const rows=new Float32Array(sourceIds.length*12),map=new Uint32Array(count),indices=new Uint32Array(triangleIds.length*3);
 sourceIds.forEach((id,i)=>{map[id]=i;rows.set(data.subarray(id*12,id*12+12),i*12);});
 triangleIds.forEach((id,i)=>{for(let a=0;a<3;a++)indices[i*3+a]=map[triangles[id*3+a]];});
 return {data:rows,triangles:indices,sourceIds:new Uint32Array(sourceIds),triangleIds:new Uint32Array(triangleIds)};
}
