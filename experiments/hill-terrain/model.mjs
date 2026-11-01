// Small source recipes and offline numerical oracle. Live field evolution is GPU-owned.
export const ROUTE='kaminos/hill-terrain/gpu-height-material-v1';
export function terrainConfig(input={}){
 const c={seed:47,resolution:129,width:8,length:9,layout:'basin',repose:32,transport:1.6,uplift:.035,soil:.22,...input};
 if(!Number.isSafeInteger(c.seed)||c.seed<0||c.seed>0xffffffff)throw Error('Seed must be a uint32');
 if(!Number.isSafeInteger(c.resolution)||c.resolution<3)throw Error('Terrain resolution must be a whole grid of at least three');
 for(const k of ['width','length'])if(!Number.isFinite(c[k])||c[k]<=0)throw Error('Positive terrain '+k+' required');
 if(!['basin','saddle'].includes(c.layout))throw Error('Unknown landscape layout');
 if(!Number.isFinite(c.repose)||c.repose<0||c.repose>=90)throw Error('Repose angle must be in [0,90)');
 for(const k of ['transport','soil'])if(!Number.isFinite(c[k])||c[k]<0)throw Error('Nonnegative '+k+' required');
 if(!Number.isFinite(c.uplift))throw Error('Finite uplift required');
 return c;
}
export function makeRidges(input){
 const c=terrainConfig(input);let seed=c.seed||0x6d2b79f5;
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
 const node=(x,z,h,w)=>[x*c.width/2+(random()-.5)*.35,z*c.length/2+(random()-.5)*.3,h*(.85+random()*.3),w*(.9+random()*.2)];
 const points=[node(-.78,.42,.55,.37),node(-.63,-.1,1.2,.5),node(-.4,-.63,1.85,.57),node(.18,-.7,c.layout==='saddle'?.72:1.4,.5),node(.7,-.43,1.6,.5),node(.72,.16,.8,.4),node(.85,.58,.3,.3),node(-.85,-.72,.8,.35),node(.12,.15,.38,.27)];
 const edges=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[2,7],[3,8]];
 return edges.map(([a,b])=>({a:points[a],b:points[b]}));
}
export function initialState(input,ridges=makeRidges(input)){
 const c=terrainConfig(input),n=c.resolution,out=new Float32Array(n*n*4);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const px=(x/(n-1)-.5)*c.width,pz=(z/(n-1)-.5)*c.length;let ridge=0;
  for(const {a,b} of ridges){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((px-a[0])*dx+(pz-a[1])*dz)/(dx*dx+dz*dz))),rx=px-a[0]-t*dx,rz=pz-a[1]-t*dz,w=a[3]+t*(b[3]-a[3]);ridge=Math.max(ridge,(a[2]+t*(b[2]-a[2]))*Math.exp(-(rx*rx+rz*rz)/(2*w*w)));}
  const i=(z*n+x)*4,grain=.5+.5*Math.sin(px*2.1+.7*Math.sin(pz*1.4))*Math.sin(pz*1.8+px*.4),edge=Math.min(x,z,n-1-x,n-1-z)/(n-1),coast=Math.min(1,edge/.10);
  out[i]=.09+coast*(ridge*.78+.025*grain);out[i+1]=coast*(.055+c.soil*(.3+.7*ridge/1.8));out[i+2]=0;out[i+3]=0;
 }
 return out;
}
export function transportStep(state,input,dt){
 const c=terrainConfig(input),n=c.resolution;
 if(state.length!==n*n*4||!state.every(Number.isFinite))throw Error('Complete finite terrain state required');
 if(!Number.isFinite(dt)||dt<=0)throw Error('Positive terrain timestep required');
 const flow=new Float32Array(state.length),out=new Float32Array(state.length),sx=c.width/(n-1),sz=c.length/(n-1),slope=Math.tan(c.repose*Math.PI/180),fraction=1-Math.exp(-c.transport*dt);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const i=z*n+x,h=state[i*4]+state[i*4+1],neighbors=[x>0?i-1:-1,x<n-1?i+1:-1,z>0?i-n:-1,z<n-1?i+n:-1];let sum=0;
  const excess=neighbors.map((j,k)=>{const e=j<0?0:Math.max(0,h-state[j*4]-state[j*4+1]-slope*(k<2?sx:sz));sum+=e;return e;});
  const amount=Math.min(state[i*4+1],sum*.25)*fraction;
  for(let k=0;k<4;k++)flow[i*4+k]=sum>0?amount*excess[k]/sum:0;
 }
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const i=z*n+x,j=i*4,px=(x/(n-1)-.5)*c.width,pz=(z/(n-1)-.5)*c.length;
  const incoming=(x>0?flow[j-4+1]:0)+(x<n-1?flow[j+4]:0)+(z>0?flow[j-n*4+3]:0)+(z<n-1?flow[j+n*4+2]:0),outgoing=flow[j]+flow[j+1]+flow[j+2]+flow[j+3];
  out[j]=state[j]+c.uplift*dt*Math.exp(-((px+.4)**2)/3-((pz+1.5)**2)/.5);
  out[j+1]=Math.max(0,state[j+1]+incoming-outgoing);out[j+2]=(out[j]+out[j+1]-state[j]-state[j+1])/dt;out[j+3]=state[j+3];
 }
 return out;
}
