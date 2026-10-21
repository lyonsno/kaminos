// Non-fracturing local-energy reference derived from the intact tetrahedral
// StVK + logarithmic-volume law in Stone@7739d5b77. This is not AVBD, calibrated
// flesh, or the Stone fracture runtime. Matrices here are row-major.
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const determinant=a=>a[0]*(a[4]*a[8]-a[5]*a[7])-a[1]*(a[3]*a[8]-a[5]*a[6])+a[2]*(a[3]*a[7]-a[4]*a[6]);
export function inverse(a){
 const d=determinant(a),m=Math.max(...a.map(Math.abs));
 if(!Number.isFinite(d)||m===0||Math.abs(d)/m**3<1e-12)throw Error('Degenerate material matrix');
 return [(a[4]*a[8]-a[5]*a[7])/d,(a[2]*a[7]-a[1]*a[8])/d,(a[1]*a[5]-a[2]*a[4])/d,
 (a[5]*a[6]-a[3]*a[8])/d,(a[0]*a[8]-a[2]*a[6])/d,(a[2]*a[3]-a[0]*a[5])/d,
 (a[3]*a[7]-a[4]*a[6])/d,(a[1]*a[6]-a[0]*a[7])/d,(a[0]*a[4]-a[1]*a[3])/d];
}
export const apply=(a,p)=>[dot(a.slice(0,3),p),dot(a.slice(3,6),p),dot(a.slice(6,9),p)];
const mul=(a,b)=>Array.from({length:9},(_,i)=>{const r=Math.floor(i/3),c=i%3;return a[r*3]*b[c]+a[r*3+1]*b[c+3]+a[r*3+2]*b[c+6];});
export const edgeMatrix=p=>[0,1,2].flatMap(a=>[p[1][a]-p[0][a],p[2][a]-p[0][a],p[3][a]-p[0][a]]);
export function tetrahedron(rest,{young=30,poisson=.35,bulk=100}={}){
 if(rest?.length!==4||!rest.every(p=>p.length===3&&p.every(Number.isFinite)))throw Error('Finite tetrahedral rest points required');
 if(!(Number.isFinite(young)&&young>0&&Number.isFinite(poisson)&&poisson>=0&&poisson<.5&&Number.isFinite(bulk)&&bulk>=0))throw Error('Invalid elastic material');
 const D=edgeMatrix(rest),inv=inverse(D),volume=Math.abs(determinant(D))/6,mu=young/(2*(1+poisson)),lambda=young*poisson/((1+poisson)*(1-2*poisson));
 const g=[[-inv[0]-inv[3]-inv[6],-inv[1]-inv[4]-inv[7],-inv[2]-inv[5]-inv[8]],inv.slice(0,3),inv.slice(3,6),inv.slice(6,9)];
 function evaluate(p,{local=null,hessian=false}={}){
  const F=mul(edgeMatrix(p),inv),J=determinant(F);if(!(J>0))throw Error('Inverted material element');
  const cols=[0,1,2].map(c=>[F[c],F[c+3],F[c+6]]),e=[(dot(cols[0],cols[0])-1)/2,(dot(cols[1],cols[1])-1)/2,(dot(cols[2],cols[2])-1)/2,dot(cols[0],cols[1]),dot(cols[0],cols[2]),dot(cols[1],cols[2])];
  const tr=e[0]+e[1]+e[2],s=[...e.slice(0,3).map(v=>2*mu*v+lambda*tr),...e.slice(3).map(v=>mu*v)],S=[s[0],s[3],s[4],s[3],s[1],s[5],s[4],s[5],s[2]],P=mul(F,S);
  const cofCols=[cross(cols[1],cols[2]),cross(cols[2],cols[0]),cross(cols[0],cols[1])],cofactor=[0,1,2].flatMap(a=>cofCols.map(c=>c[a]));
  const energy=volume*(e.reduce((sum,v,i)=>sum+v*s[i],0)/2+bulk*(J-1-Math.log(J)));
  const indices=local===null?[0,1,2,3]:[local],gradients=indices.map(i=>{const a=apply(P,g[i]),q=apply(cofactor,g[i]);return a.map((v,k)=>volume*(v+bulk*(1-1/J)*q[k]));});
  let H;
  if(hessian){
   if(local===null)throw Error('A local vertex is required for its block Hessian');
   const v=g[local],A=[cols[0].map(x=>x*v[0]),cols[1].map(x=>x*v[1]),cols[2].map(x=>x*v[2]),cols[1].map((x,a)=>x*v[0]+cols[0][a]*v[1]),cols[2].map((x,a)=>x*v[0]+cols[0][a]*v[2]),cols[2].map((x,a)=>x*v[1]+cols[1][a]*v[2])],sum=[0,1,2].map(a=>A[0][a]+A[1][a]+A[2][a]),q=apply(cofactor,v),geometric=Math.max(0,dot(v,apply(S,v)));
   H=Array.from({length:9},(_,k)=>{const a=Math.floor(k/3),b=k%3;return volume*(lambda*sum[a]*sum[b]+2*mu*A.slice(0,3).reduce((r,v)=>r+v[a]*v[b],0)+mu*A.slice(3).reduce((r,v)=>r+v[a]*v[b],0)+bulk*q[a]*q[b]/(J*J)+(a===b?geometric:0));});
  }
  return{energy,J,gradients,hessian:H};
 }
 return{volume,gradients:g,evaluate};
}
