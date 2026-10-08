const pointsValid=p=>Array.isArray(p)&&p.length&&p.every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite));
const distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
export function contactPatch(current,point,{components,component,radius,pinned}={}){
 if(!pointsValid(current)||!pointsValid([point])||!Array.isArray(components)||components.length!==current.length||!Array.isArray(pinned)||pinned.length!==current.length||!(Number.isFinite(radius)&&radius>0))throw new Error('Complete finite contact state required');
 const patch=current.flatMap((p,index)=>{const r=distance(p,point)/radius;return components[index]===component&&!pinned[index]&&r<1?[{index,weight:(1-r*r)**2}]:[];});
 const total=patch.reduce((s,p)=>s+p.weight,0);if(!(total>0))throw new Error('Picked contact has no movable material within its radius');
 return patch.map(p=>({...p,weight:p.weight/total}));
}

export function principalTension(matrix){
 if(!Array.isArray(matrix)||matrix.length!==3||!matrix.every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite)))throw new Error('Finite symmetric stress required');
 const a=matrix.map((row,i)=>row.map((v,j)=>(v+matrix[j][i])*.5)),v=[[1,0,0],[0,1,0],[0,0,1]],scale=Math.max(1,...a.flat().map(Math.abs));
 // Jacobi rotations resolve the largest algebraic eigenvalue, not the largest magnitude (compression).
 for(let sweep=0;;sweep++){
  let p=0,q=1;for(const [i,j] of [[0,2],[1,2]])if(Math.abs(a[i][j])>Math.abs(a[p][q])){p=i;q=j;}
  if(Math.abs(a[p][q])<=scale*1e-12)break;if(sweep>100)throw new Error('Principal stress did not converge');
  const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(angle),s=Math.sin(angle),ap=a[p][p],aq=a[q][q],b=a[p][q];
  a[p][p]=c*c*ap-2*s*c*b+s*s*aq;a[q][q]=s*s*ap+2*s*c*b+c*c*aq;a[p][q]=a[q][p]=0;
  for(let k=0;k<3;k++){if(k!==p&&k!==q){const x=a[k][p],y=a[k][q];a[k][p]=a[p][k]=c*x-s*y;a[k][q]=a[q][k]=s*x+c*y;}const x=v[k][p],y=v[k][q];v[k][p]=c*x-s*y;v[k][q]=s*x+c*y;}
 }
 const axis=[0,1,2].reduce((best,i)=>a[i][i]>a[best][best]?i:best,0),normal=v.map(row=>row[axis]);
 const largest=normal.reduce((best,x,i)=>Math.abs(x)>Math.abs(normal[best])?i:best,0);if(normal[largest]<0)normal.forEach((x,i)=>normal[i]=-x);
 return{value:a[axis][axis],normal};
}

export function selectStressRelease({rest,elements,samples,components,component,radius,threshold}){
 if(!pointsValid(rest)||!Array.isArray(elements)||!Array.isArray(samples)||samples.length!==elements.length||!Array.isArray(components)||components.length!==rest.length||!(radius>0&&Number.isFinite(radius))||!(threshold>0&&Number.isFinite(threshold)))throw new Error('A complete resident stress field and explicit criterion required');
 const centers=elements.map(ids=>ids.reduce((s,i)=>s.map((v,k)=>v+rest[i][k]/ids.length),[0,0,0]));
 if(samples.some(s=>s.invalid||!Array.isArray(s.stress)||!Array.isArray(s.F)||![...s.stress.flat(),...s.F.flat(),s.volume,s.energy].every(Number.isFinite)))throw new Error('Invalid or incomplete resident stress field');
 const eligible=elements.flatMap((ids,i)=>ids.every(node=>components[node]===component)&&samples[i].active?[i]:[]),cells=new Map(),cell=p=>p.map(v=>Math.floor(v/radius));let best=null;
 for(const i of eligible){const key=cell(centers[i]).join(',');if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);}
 for(const index of eligible){
  let weight=0;const stress=Array.from({length:3},()=>[0,0,0]),F=Array.from({length:3},()=>[0,0,0]);
  const c=cell(centers[index]),neighbors=[];for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)neighbors.push(...(cells.get([c[0]+x,c[1]+y,c[2]+z].join(','))??[]));
  for(const j of neighbors){const r=distance(centers[index],centers[j])/radius;if(r>=1)continue;const w=samples[j].volume*(1-r*r)**2;if(!(w>0))throw new Error('Positive stress quadrature required');weight+=w;for(let a=0;a<3;a++)for(let b=0;b<3;b++){stress[a][b]+=w*samples[j].stress[a][b];F[a][b]+=w*samples[j].F[a][b];}}
  if(!weight)continue;for(let a=0;a<3;a++)for(let b=0;b<3;b++){stress[a][b]/=weight;F[a][b]/=weight;}
  const principal=principalTension(stress);if(principal.value<threshold||best&&principal.value<=best.tension)continue;
  const pulledBack=[0,1,2].map(k=>F.reduce((s,row,j)=>s+row[k]*principal.normal[j],0)),length=Math.hypot(...pulledBack);if(!(length>0))continue;
  const normal=pulledBack.map(v=>v/length),offset=dot(normal,centers[index]),sides=[0,0];
  rest.forEach((p,i)=>{if(components[i]===component)sides[dot(normal,p)>=offset?0:1]++;});
  if(Math.min(...sides)<4)continue;
  best={kind:'component-tensile-through-cut-v0',normal,offset,tension:principal.value,currentNormal:principal.normal,element:index,center:centers[index],averagingRadius:radius,threshold,sidePoints:sides};
 }
 return best;
}
