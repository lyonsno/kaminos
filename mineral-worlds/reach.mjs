// Sparse compact-support deposits are the material authority. Water is a coarse
// transport field. Initial bedding is authored; later deposits retain their epoch.
export const REPRESENTATION='sparse-nested-mineral-reach-v1';
const TAU=2*Math.PI;
const random=(seed,k)=>{let h=Math.imul(seed^k,1597334677);h=Math.imul(h^(h>>>16),2246822519);return ((h^(h>>>13))>>>0)/4294967296;};
export function createReach({size=28,seed=17,extent=24}={}){
 if(!Number.isInteger(size)||size<4||!Number.isSafeInteger(seed)||!Number.isFinite(extent)||extent<=0)throw Error('Invalid reach dimensions');
 const s={representation:REPRESENTATION,size,seed,extent,tick:0,settings:{supply:1,mineral:1,drying:1},features:[],layers:[],water:Array(size*size).fill(.025),solute:Array(size*size).fill(.0008),ledger:{initial:size*size*.0008,incoming:0,outgoing:0},nextId:0};
 // Compact authored prehistory: composition and layer thickness are explicit state.
 let depth=0;
 for(let i=0;i<18;i++){const thickness=.025+.055*random(seed,i+1);depth+=thickness;s.layers.push({id:i,at:0,thickness,tone:random(seed,i+40),grain:.25+.6*random(seed,i+80),phase:random(seed,i+120)*TAU,authored:true,children:laminae(seed,i,3)});}
 s.beddingDepth=depth;openLayer(s);return s;
}
function laminae(seed,key,depth){
 const count=3+Math.floor(random(seed,key+9000)*4),out=[];let sum=0;
 for(let i=0;i<count;i++){const width=.3+random(seed,key*17+i+9200);sum+=width;out.push({width,tone:random(seed,key*19+i+9400),children:depth>1?laminae(seed,key*11+i+1,depth-1):[]});}
 for(const item of out)item.width/=sum;return out;
}
function openLayer(s){s.layers.push({id:s.layers.length,at:s.tick,thickness:0,tone:.18+.56*s.settings.mineral/(1+s.settings.mineral),grain:s.settings.drying/(1+s.settings.drying),phase:random(s.seed,s.tick+600)*TAU,authored:false,children:laminae(s.seed,s.tick+500,3)});}
export function conditions(s,patch){const next={...s.settings};for(const[k,v]of Object.entries(patch)){if(!(k in next)||!Number.isFinite(v)||v<0)throw Error('Invalid reach condition '+k);next[k]=v;}if(Object.keys(next).some(k=>next[k]!==s.settings[k])){s.settings=next;openLayer(s);}return s.settings;}
export function bedAt(s,x,z){return -.032*z+.13*Math.sin(x*.21+z*.17)+.075*Math.sin(z*.62+.65*Math.sin(x*.26))+.018*Math.sin(x*1.4+z*.5+s.seed);}
export function kernel(f,x,z){const dx=x-f.x,dz=z-f.z,c=Math.cos(f.angle),sn=Math.sin(f.angle),u=(c*dx+sn*dz)/f.rx,v=(-sn*dx+c*dz)/f.rz,q=1-u*u-v*v;return q>0?4*q*q*q/(Math.PI*f.rx*f.rz):0;}
export function depositAt(s,x,z){let h=0;for(const f of s.features)h+=f.volume*kernel(f,x,z);return h;}
export function layerAt(s,x,z,id){let h=0;for(const f of s.features)h+=(f.layers[id]??0)*kernel(f,x,z);return h;}
const caches=new WeakMap();
function cache(s){let c=caches.get(s);if(c)return c;const N=s.size*s.size;c={dw:new Float64Array(N),ds:new Float64Array(N),flux:new Float64Array(N),fx:new Float64Array(N),fz:new Float64Array(N),head:new Float64Array(N),byCell:new Map()};for(const f of s.features)if(f.cell!=null){const a=c.byCell.get(f.cell)??[];a.push(f);c.byCell.set(f.cell,a);}caches.set(s,c);return c;}
function add(s,c,i,volume){
 const n=s.size,d=s.extent/(n-1),x=(i%n/(n-1)-.5)*s.extent,z=(Math.floor(i/n)/(n-1)-.5)*s.extent;
 let fs=c.byCell.get(i);
 if(!fs){const angle=Math.atan2(c.fz[i],c.fx[i])+Math.PI/2;
  const parent={id:s.nextId++,cell:i,parent:null,level:0,x:x+(random(s.seed,i+1000)-.5)*d*.5,z:z+(random(s.seed,i+2000)-.5)*d*.5,rx:d*1.3,rz:d*.55,angle,volume:0,layers:Array(s.layers.length).fill(0)};
  fs=[parent];s.features.push(parent);c.byCell.set(i,fs);
 }
 const parent=fs[0];
 if(parent.volume>d*d*.0005&&fs.length===1){for(let j=0;j<3;j++){const offset=(j-1)*parent.rx*.55,along=Math.cos(parent.angle),across=Math.sin(parent.angle);const f={id:s.nextId++,cell:i,parent:parent.id,level:1,x:parent.x+along*offset,z:parent.z+across*offset,rx:parent.rx*.34,rz:parent.rz*.3,angle:parent.angle+(random(s.seed,i+j+3000)-.5)*.4,volume:0,layers:Array(s.layers.length).fill(0)};fs.push(f);s.features.push(f);}}
 const epoch=s.layers.length-1;
 // Growth is divided among scales; children do not duplicate the parent's mass.
 const weights=fs.map((f,j)=>j===0?1:.22*(.3+random(s.seed,i+j+4000))*(1+Math.min(2,c.flux[i]*30)));
 const total=weights.reduce((a,b)=>a+b,0);
 fs.forEach((f,j)=>{const amount=volume*weights[j]/total;f.volume+=amount;while(f.layers.length<=epoch)f.layers.push(0);f.layers[epoch]=(f.layers[epoch]??0)+amount;});
 s.layers[epoch].thickness+=volume/(s.extent*s.extent);
}
export function advanceReach(s,steps=1){if(!Number.isSafeInteger(steps)||steps<0)throw Error('Invalid reach steps');for(let k=0;k<steps;k++)step(s);return s;}
function step(s){
 const n=s.size,N=n*n,d=s.extent/(n-1),area=d*d,c=cache(s);c.dw.fill(0);c.ds.fill(0);c.flux.fill(0);c.fx.fill(0);c.fz.fill(0);
 if(s.tick>0&&s.tick%100===0)openLayer(s);
 for(let x=0;x<n;x++){const i=x,w=.012*s.settings.supply*(.85+.15*Math.sin(x*.4+s.seed)),m=w*.045*s.settings.mineral;s.water[i]+=w;s.solute[i]+=m;s.ledger.incoming+=m;}
 const sampler=spatialSampler(s);
 for(let i=0;i<N;i++){const x=(i%n/(n-1)-.5)*s.extent,z=(Math.floor(i/n)/(n-1)-.5)*s.extent;c.head[i]=bedAt(s,x,z)+sampler.height(x,z)+s.water[i];}
 const edge=(a,b,dx,dz)=>{let sign=1;if(c.head[a]<c.head[b]){[a,b]=[b,a];sign=-1;}const w=Math.min(s.water[a]*.2,Math.max(0,c.head[a]-c.head[b])*.32),m=s.water[a]>0?w*s.solute[a]/s.water[a]:0;c.dw[a]-=w;c.dw[b]+=w;c.ds[a]-=m;c.ds[b]+=m;c.flux[a]+=w;c.flux[b]+=w;c.fx[a]+=sign*dx*w;c.fx[b]+=sign*dx*w;c.fz[a]+=sign*dz*w;c.fz[b]+=sign*dz*w;};
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x;if(x+1<n)edge(i,i+1,1,0);if(z+1<n)edge(i,i+n,0,1);}
 for(let i=0;i<N;i++){
  s.water[i]=Math.max(0,s.water[i]+c.dw[i]);s.solute[i]=Math.max(0,s.solute[i]+c.ds[i]);
  if(i>=N-n){const out=s.solute[i]*.18;s.solute[i]-=out;s.water[i]*=.82;s.ledger.outgoing+=out;}
  s.water[i]=Math.max(0,s.water[i]-.00012*s.settings.drying);
  // Reduced degassing/supersaturation law. Throughflow, rather than net water
  // accumulation, strengthens precipitation. Geometry feeds the next step.
  const excess=Math.max(0,s.solute[i]-.022*s.water[i]);
  const amount=excess*(.004+.09*c.flux[i]/(.025+c.flux[i]));
  s.solute[i]-=amount;if(amount>1e-12)add(s,c,i,amount*area);
 }
 s.tick++;
}
export function readReach(s){const area=(s.extent/(s.size-1))**2,deposited=s.features.reduce((a,f)=>a+f.volume,0)/area,fluid=s.solute.reduce((a,b)=>a+b,0);return {tick:s.tick,settings:{...s.settings},features:s.features.length,children:s.features.filter(f=>f.level>0).length,layers:s.layers.length,deposited,mineralError:deposited+fluid-s.ledger.initial-s.ledger.incoming+s.ledger.outgoing,representation:s.representation,provenance:'Authored stratified sloping bed; reduced flow-driven sparse deposition; two feature levels, no geological calibration'};}
export function saveReach(s){return JSON.parse(JSON.stringify(s));}
export function restoreReach(value){const s=structuredClone(value);if(s?.representation!==REPRESENTATION)throw Error('Unknown reach checkpoint');createReach(s);if(!Number.isSafeInteger(s.tick)||s.tick<0||!Number.isSafeInteger(s.nextId)||s.nextId<0)throw Error('Invalid reach clock');for(const a of ['water','solute'])if(!Array.isArray(s[a])||s[a].length!==s.size*s.size||s[a].some(x=>!Number.isFinite(x)||x<0))throw Error('Invalid reach '+a);if(!Array.isArray(s.layers)||!s.layers.length||s.layers.some((l,i)=>l.id!==i||!['at','thickness','tone','grain','phase'].every(k=>Number.isFinite(l[k]))||l.thickness<0))throw Error('Invalid reach layers');const ids=new Set();for(const f of s.features){if(!Number.isSafeInteger(f.id)||ids.has(f.id)||!['x','z','rx','rz','angle','volume'].every(k=>Number.isFinite(f[k]))||f.rx<=0||f.rz<=0||f.volume<0||!Array.isArray(f.layers)||f.layers.some(v=>v!=null&&(!Number.isFinite(v)||v<0)))throw Error('Invalid feature volume/shape');ids.add(f.id);if(f.parent!=null&&!ids.has(f.parent))throw Error('Missing feature parent');}if(!s.ledger||!['initial','incoming','outgoing'].every(k=>Number.isFinite(s.ledger[k])&&s.ledger[k]>=0)||!Number.isFinite(s.beddingDepth)||s.beddingDepth<=0)throw Error('Invalid reach ledger');if(!s.settings||!['supply','mineral','drying'].every(k=>Number.isFinite(s.settings[k])&&s.settings[k]>=0)||Object.keys(s.settings).length!==3)throw Error('Invalid reach conditions');return s;}

// Derived spatial index only; exact compact kernels remain checkpoint authority.
export function spatialSampler(s){
 const n=s.size,d=s.extent/(n-1),bins=Array.from({length:n*n},()=>[]);
 for(const f of s.features){const r=Math.max(f.rx,f.rz),loX=Math.max(0,Math.floor((f.x-r+s.extent/2)/d)),hiX=Math.min(n-1,Math.floor((f.x+r+s.extent/2)/d)),loZ=Math.max(0,Math.floor((f.z-r+s.extent/2)/d)),hiZ=Math.min(n-1,Math.floor((f.z+r+s.extent/2)/d));for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++)bins[z*n+x].push(f);}
 const local=(x,z)=>bins[Math.max(0,Math.min(n-1,Math.floor((z+s.extent/2)/d)))*n+Math.max(0,Math.min(n-1,Math.floor((x+s.extent/2)/d)))];
 return {height(x,z){let h=0;for(const f of local(x,z))h+=f.volume*kernel(f,x,z);return h;},layers(x,z){const out=new Float64Array(s.layers.length);for(const f of local(x,z)){const w=kernel(f,x,z);if(w)for(let j=0;j<f.layers.length;j++)out[j]+=(f.layers[j]??0)*w;}return out;}};
}
