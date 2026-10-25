// Transfer-only preparation; the physical volume and state stay unchanged.
// Catmull-Rom on the authored section lattice is interpolating and C1 across
// cell boundaries. Linear ghost samples preserve affine displacement at ends.
const cubic=t=>[-.5*t+t*t-.5*t*t*t,1-2.5*t*t+1.5*t*t*t,.5*t+2*t*t-1.5*t*t*t,-.5*t*t+.5*t*t*t];
const sample=(i,n)=>i<0?[[0,2],[1,-1]]:i>=n?[[n-1,2],[n-2,-1]]:[[i,1]];
export function prepareSmoothFleshEmbedding(prepared){
 if(prepared.interpolation==='tricubic-grid')return prepared;
 const {crossSection:c,sections:s}=prepared.construction??{},vertices=prepared.source?.vertices,n=prepared.positions?.length;
 if(!Number.isSafeInteger(c)||c<3||!Number.isSafeInteger(s)||s<3||n!==c*c*s||!Number.isSafeInteger(vertices)||vertices<1||prepared.bindings?.length!==vertices*4||prepared.bindingWeights?.length!==vertices*4)throw Error('Smooth transfer requires the complete section lattice and linear embedding');
 const ids=[],weights=[],offsets=new Uint32Array(vertices+1),id=(i,j,k)=>(k*c+j)*c+i;
 for(let v=0;v<vertices;v++){
  const point=[0,0,0];let strength=0;
  for(let a=0;a<4;a++){
   const i=prepared.bindings[v*4+a],w=prepared.bindingWeights[v*4+a];
   if(!Number.isSafeInteger(i)||i<0||i>=n||!Number.isFinite(w)||w<0)throw Error('Invalid linear physical embedding');
   strength+=w;point[0]+=w*(i%c);point[1]+=w*(Math.floor(i/c)%c);point[2]+=w*Math.floor(i/(c*c));
  }
  if(strength>1+1e-5)throw Error('Physical embedding strength exceeds one');
  if(strength>0){
   const sizes=[c,c,s];for(let a=0;a<3;a++)point[a]=Math.min(sizes[a]-1,Math.max(0,point[a]/strength));
   const base=point.map(Math.floor),basis=point.map((x,a)=>cubic(x-base[a])),terms=new Map();
   for(let k=0;k<4;k++)for(let j=0;j<4;j++)for(let i=0;i<4;i++){
    const w=basis[0][i]*basis[1][j]*basis[2][k]*strength;if(w===0)continue;
    for(const [x,wx]of sample(base[0]+i-1,c))for(const [y,wy]of sample(base[1]+j-1,c))for(const [z,wz]of sample(base[2]+k-1,s)){
     const node=id(x,y,z);terms.set(node,(terms.get(node)??0)+w*wx*wy*wz);
    }
   }
   for(const [node,w]of terms)if(w!==0){ids.push(node);weights.push(w);}
  }
  offsets[v+1]=ids.length;
 }
 return {...prepared,interpolation:'tricubic-grid',bindings:Uint32Array.from(ids),bindingWeights:Float32Array.from(weights),bindingOffsets:offsets};
}
