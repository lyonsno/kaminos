// A deliberately cheap empirical baseline: joint first-order view/light
// moments, no offset network. Coefficients describe a filtered RGB response,
// not inferred albedo, normals, roughness or a physically identified BRDF.
export function filteredSurfaceCasePlan(footprints,referenceResolution=256){
 if(!Number.isSafeInteger(referenceResolution)||referenceResolution<1||!Array.isArray(footprints)||!footprints.length||!footprints.every(v=>Number.isFinite(v)&&v>=1/referenceResolution&&v<=1))throw Error('Footprints must be representable at the selected reference resolution');
 return footprints.map((footprint,index)=>({footprint,index,lod:Math.log2(footprint*referenceResolution),tag:`case-${index}-footprint-${footprint}`}));
}
export function angularBasis(direction){
 if(!direction||direction.length!==4||!direction.every(Number.isFinite))throw Error('Four finite view/light coordinates required');
 const [vx,vy,lx,ly]=direction;
 if(vx*vx+vy*vy>1||lx*lx+ly*ly>1)throw Error('Directions must lie in the hemisphere disk');
 const v=[1,vx,vy,Math.sqrt(Math.max(0,1-vx*vx-vy*vy))],l=[1,lx,ly,Math.sqrt(Math.max(0,1-lx*lx-ly*ly))];
 return v.flatMap(a=>l.map(b=>a*b));
}
export function fitFilteredSurface({width,height,angles,labels,ridge=1e-5}){
 if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0)||!Array.isArray(angles)||angles.length<16||!(labels instanceof Float32Array)||labels.length!==width*height*angles.length*3||!labels.every(Number.isFinite)||!Number.isFinite(ridge)||ridge<0)throw Error('Invalid filtered surface training data');
 const basis=angles.map(angularBasis),n=16,matrix=Array.from({length:n},(_,i)=>Float64Array.from({length:n*2},(_,j)=>j<n?basis.reduce((s,b)=>s+b[i]*b[j],0)+(i===j?ridge:0):+(j-n===i)));
 for(let c=0;c<n;c++){
  let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(matrix[r][c])>Math.abs(matrix[pivot][c]))pivot=r;
  if(Math.abs(matrix[pivot][c])<1e-14)throw Error('Regularized angular system is numerically singular');
  [matrix[c],matrix[pivot]]=[matrix[pivot],matrix[c]];const d=matrix[c][c];for(let j=0;j<2*n;j++)matrix[c][j]/=d;
  for(let r=0;r<n;r++)if(r!==c){const s=matrix[r][c];for(let j=0;j<2*n;j++)matrix[r][j]-=s*matrix[c][j];}
 }
 const coefficients=new Float32Array(width*height*n*3),mean=new Float32Array(width*height*3);
 for(let p=0;p<width*height;p++){
  const rhs=Array.from({length:n},()=>new Float64Array(3));
  basis.forEach((b,a)=>{for(let c=0;c<3;c++){const y=labels[(p*angles.length+a)*3+c];mean[p*3+c]+=y/angles.length;for(let i=0;i<n;i++)rhs[i][c]+=b[i]*y;}});
  for(let i=0;i<n;i++)for(let c=0;c<3;c++){let v=0;for(let j=0;j<n;j++)v+=matrix[i][n+j]*rhs[j][c];coefficients[(p*n+i)*3+c]=v;}
 }
 if(!coefficients.every(Number.isFinite))throw Error('Non-finite filtered surface fit');
 return {schema:'kaminos.filtered-surface-moments.v1',width,height,terms:n,coefficients,mean,ridge,claim:'Empirical filtered directional response; no parallax or physical parameter recovery'};
}
export function evaluateFilteredSurface(model,uv,direction){
 if(!model||![model.width,model.height].every(n=>Number.isSafeInteger(n)&&n>0)||model.coefficients?.length!==model.width*model.height*48)throw Error('Invalid filtered response model field');
 if(!uv||uv.length!==2||!uv.every(Number.isFinite))throw Error('Finite UV required');
 const b=angularBasis(direction),rgb=[0,0,0],xy=[uv[0]*model.width-.5,uv[1]*model.height-.5],lo=xy.map(Math.floor),t=xy.map((v,i)=>v-lo[i]);
 for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
  const x=((lo[0]+dx)%model.width+model.width)%model.width,y=((lo[1]+dy)%model.height+model.height)%model.height,w=(dx?t[0]:1-t[0])*(dy?t[1]:1-t[1]);
  for(let i=0;i<16;i++)for(let c=0;c<3;c++)rgb[c]+=w*b[i]*model.coefficients[((y*model.width+x)*16+i)*3+c];
 }
 if(!rgb.every(Number.isFinite))throw Error('Nonfinite filtered response');
 return rgb.map(v=>Math.max(0,v));
}
