// Geological preparation only. Neither this solver nor its cache runs in playback.
export const FORMATION_VERSION='hill-geology-5';
const defaults={seed:47,resolution:129,width:8,length:9,iterations:260,relief:3.8,tilt:.28,fold:.18,bedThickness:.32,hardness:4,incision:.065,channelArea:.18,weathering:.0008,transport:.12,creep:.018,repose:34,bankFailure:1,bankRepose:52,apron:.25};
export function formationConfig(input={}){
 const c=Object.fromEntries(Object.keys(defaults).map(k=>[k,input[k]??defaults[k]]));
 if(!Number.isSafeInteger(c.seed)||c.seed<0||c.seed>0xffffffff)throw Error('Formation seed must be uint32');
 if(!Number.isSafeInteger(c.resolution)||c.resolution<3)throw Error('Formation resolution must be a whole grid >=3');
 if(!Number.isSafeInteger(c.iterations)||c.iterations<0)throw Error('Formation iterations must be nonnegative whole steps');
 for(const k of ['width','length','bedThickness','relief'])if(!Number.isFinite(c[k])||c[k]<=0)throw Error('Positive formation '+k+' required');
 for(const k of ['hardness','incision','channelArea','weathering','transport','creep','fold','bankFailure'])if(!Number.isFinite(c[k])||c[k]<0)throw Error('Nonnegative formation '+k+' required');
 if(!Number.isFinite(c.tilt)||!Number.isFinite(c.repose)||c.repose<0||c.repose>=90)throw Error('Invalid formation slope');
 if(!Number.isFinite(c.bankRepose)||c.bankRepose<=0||c.bankRepose>=90||!Number.isFinite(c.apron)||c.apron<0||c.apron>=1)throw Error('Invalid rock-bank or apron geometry');
 return c;
}
export const formationKey=input=>JSON.stringify([FORMATION_VERSION,formationConfig(input)]);
function hash(x,z,seed){let h=Math.imul(x^seed,374761393)^Math.imul(z,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function noise(x,z,seed){const a=Math.floor(x),b=Math.floor(z),u=x-a,v=z-b,s=u*u*(3-2*u),t=v*v*(3-2*v);return (hash(a,b,seed)*(1-s)+hash(a+1,b,seed)*s)*(1-t)+(hash(a,b+1,seed)*(1-s)+hash(a+1,b+1,seed)*s)*t;}
export function rockResistance(x,y,z,c){
 const phase=(y-c.tilt*x-c.fold*Math.sin(z*.7+x*.2)+c.seed*.017)/c.bedThickness;
 // Persistent beds in world space: excavation exposes a different resistance.
 const band=.5+.5*Math.sin(phase*Math.PI*2);
 return 1+c.hardness*band**6;
}
export function seedGeology(input){
 const c=formationConfig(input),n=c.resolution,s=new Float32Array(n*n*4);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const u=x/(n-1),v=z/(n-1),px=(u-.5)*c.width,pz=(v-.5)*c.length;
  let texture=0,weight=1;for(let o=0;o<5;o++){texture+=weight*(noise(u*3*2**o,v*3*2**o,c.seed+o*71)-.5);weight*=.5;}
  // An inherited upland dipping toward the open front edge. No authored channels.
  const upland=Math.max(0,(1-v-c.apron)/(1-c.apron));
  const broad=.10+(.64+.42*(2*u-1)**2)*upland**2;
  s[(z*n+x)*4]=.10+c.relief*(broad+.24*texture*Math.sin(Math.PI*upland)**2)+.015*Math.sin(px*.5+pz*.4);
  s[(z*n+x)*4+1]=.025;
 }
 return s;
}
const offsets=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
// Priority-flood gives depressions a spill route without changing bedrock. The
// strict flood rank makes the receiver graph acyclic even across a filled lake.
export function drainage(state,input){
 const c=formationConfig(input),n=c.resolution,N=n*n,filled=new Float64Array(N),receiver=new Int32Array(N).fill(-1),rank=new Int32Array(N),seen=new Uint8Array(N),order=new Int32Array(N),heap=[];
 const before=(a,b)=>filled[a]<filled[b]||(filled[a]===filled[b]&&a<b);
 const push=i=>{heap.push(i);let k=heap.length-1;while(k){const p=(k-1)>>1;if(!before(heap[k],heap[p]))break;[heap[k],heap[p]]=[heap[p],heap[k]];k=p;}};
 const pop=()=>{const a=heap[0],tail=heap.pop();if(heap.length){heap[0]=tail;let k=0;while(2*k+1<heap.length){let j=2*k+1;if(j+1<heap.length&&before(heap[j+1],heap[j]))j++;if(!before(heap[j],heap[k]))break;[heap[k],heap[j]]=[heap[j],heap[k]];k=j;}}return a;};
 for(let x=0;x<n;x++){if(Math.abs(x/(n-1)-.5)>.09)continue;const i=(n-1)*n+x;seen[i]=1;filled[i]=state[i*4]+state[i*4+1];push(i);}
 let count=0;
 while(heap.length){const i=pop(),x=i%n,z=Math.floor(i/n);rank[i]=count;order[count++]=i;
  for(const [ox,oz]of offsets){const xx=x+ox,zz=z+oz;if(xx<0||xx>=n||zz<0||zz>=n)continue;const j=zz*n+xx;if(seen[j])continue;seen[j]=1;filled[j]=Math.max(state[j*4]+state[j*4+1],filled[i]);receiver[j]=i;push(j);}
 }
 const dx=c.width/(n-1),dz=c.length/(n-1),distance=new Float64Array(N),area=new Float64Array(N).fill(dx*dz);
 for(let i=0;i<N;i++){if(receiver[i]<0)continue;let best=-Infinity;const x=i%n,z=Math.floor(i/n);
  for(const [ox,oz]of offsets){const xx=x+ox,zz=z+oz;if(xx<0||xx>=n||zz<0||zz>=n)continue;const j=zz*n+xx;if(rank[j]>=rank[i])continue;const d=Math.hypot(ox*dx,oz*dz),slope=(filled[i]-filled[j])/d;if(slope>best){best=slope;receiver[i]=j;distance[i]=d;}}
 }
 for(let k=N-1;k>=0;k--){const i=order[k],r=receiver[i];if(r>=0)area[r]+=area[i];}
 let outletArea=0;for(let i=0;i<N;i++)if(receiver[i]<0)outletArea+=area[i];
 return{receiver,order,area,distance,filled,outletArea};
}
export function formationStep(state,input,metrics){
 const c=formationConfig(input),n=c.resolution,N=n*n,dx=c.width/(n-1),dz=c.length/(n-1),cell=dx*dz,out=Float64Array.from(state),d=drainage(state,c),load=new Float64Array(N);
 for(let i=0;i<N;i++){const w=c.weathering*Math.exp(-out[i*4+1]/.12);out[i*4]-=w;out[i*4+1]+=w;metrics.weathered+=w*cell;}
 for(let k=N-1;k>=0;k--){const i=d.order[k],j=i*4,r=d.receiver[i];if(r<0){metrics.exportedVolume+=load[i];continue;}
  const h=out[j]+out[j+1],down=out[r*4]+out[r*4+1],slope=Math.max(0,(h-down)/d.distance[i]),stream=Math.sqrt(Math.max(0,d.area[i]-c.channelArea));
  const capacity=c.transport*stream*slope;let sediment=load[i];
  if(sediment>capacity){// Deposition steepens this reach and therefore increases its capacity.
   // Solve both together instead of dropping the entire excess into one cell.
   const deposit=(sediment-capacity)/(cell+c.transport*stream/d.distance[i]);out[j+1]+=deposit;metrics.deposited+=deposit*cell;sediment-=deposit*cell;}
  else{
   // Stream-power incision is limited by available relief and carrying capacity.
   const x=(i%n/(n-1)-.5)*c.width,z=(Math.floor(i/n)/(n-1)-.5)*c.length,K=c.incision*stream/d.distance[i];
   const incision=(Math.max(0,h-down)*K/(1+K));
   let need=Math.min(incision,(capacity-sediment)/(cell+c.transport*stream/d.distance[i])),soil=Math.min(out[j+1],need);out[j+1]-=soil;need-=soil;
   const rock=need/rockResistance(x,out[j],z,c);out[j]-=rock;sediment+=(soil+rock)*cell;metrics.erodedVolume+=(soil+rock)*cell;metrics.rockEroded+=rock*cell;
  }
  load[r]+=sediment;
 }
 // Exposed over-steep rock banks fail locally into loose talus. Transfer from
 // rock to neighboring loose cover conserves volume; buried banks are supported
 // by that cover. The implicit four-neighbor factor bounds each shared transfer.
 const bankFlow=new Float64Array(N*4),bankLimit=Math.tan(c.bankRepose*Math.PI/180);
 for(let i=0;i<N;i++){const x=i%n,z=Math.floor(i/n),bed=out[i*4],strength=rockResistance((x/(n-1)-.5)*c.width,bed,(z/(n-1)-.5)*c.length,c),rate=c.bankFailure/(1+4*c.bankFailure)/Math.sqrt(strength);
  for(let k=0;k<4;k++){const [ox,oz]=offsets[k],xx=x+ox,zz=z+oz;if(xx<0||xx>=n||zz<0||zz>=n)continue;const j=zz*n+xx;
   bankFlow[i*4+k]=Math.max(0,bed-out[j*4]-out[j*4+1]-bankLimit*(k<2?dx:dz))*rate;}
 }
 for(let i=0;i<N;i++){const x=i%n,z=Math.floor(i/n),j=i*4,loss=bankFlow[j]+bankFlow[j+1]+bankFlow[j+2]+bankFlow[j+3];out[j]-=loss;
  out[j+1]+=(x?bankFlow[j-3]:0)+(x+1<n?bankFlow[j+4]:0)+(z?bankFlow[j-n*4+3]:0)+(z+1<n?bankFlow[j+n*4+2]:0);metrics.bankCollapsed=(metrics.bankCollapsed??0)+loss*cell;
 }
 // Conservative downslope creep and over-steep loose-material failure. The
 // donor bound prevents a cell from transporting more cover than it owns.
 const flow=new Float64Array(N*4),talus=Math.tan(c.repose*Math.PI/180);
 for(let i=0;i<N;i++){const x=i%n,z=Math.floor(i/n),h=out[i*4]+out[i*4+1],e=[];let total=0;
  for(let k=0;k<4;k++){const [ox,oz]=offsets[k],xx=x+ox,zz=z+oz;let amount=0;if(xx>=0&&xx<n&&zz>=0&&zz<n){const j=zz*n+xx,diff=Math.max(0,h-out[j*4]-out[j*4+1]);amount=diff*c.creep+Math.max(0,diff-talus*(k<2?dx:dz))*.18;}e[k]=amount;total+=amount;}
  const factor=total>0?Math.min(1,out[i*4+1]/total):0;for(let k=0;k<4;k++)flow[i*4+k]=e[k]*factor;
 }
 for(let i=0;i<N;i++){const x=i%n,z=Math.floor(i/n),j=i*4;
  out[j+1]+=(x?flow[j-3]:0)+(x+1<n?flow[j+4]:0)+(z?flow[j-n*4+3]:0)+(z+1<n?flow[j+n*4+2]:0)-flow[j]-flow[j+1]-flow[j+2]-flow[j+3];
  out[j+1]=Math.max(0,out[j+1]);out[j+2]=0;out[j+3]=0;
 }
 return Float32Array.from(out);
}
export function createFormation(input){
 const config=formationConfig(input);let state=seedGeology(config),steps=0;
 const metrics={cellArea:config.width*config.length/(config.resolution-1)**2,weathered:0,rockEroded:0,bankCollapsed:0,erodedVolume:0,deposited:0,exportedVolume:0};
 return{step(){if(steps<config.iterations){state=formationStep(state,config,metrics);steps++;}return steps;},get done(){return steps===config.iterations;},result(){if(steps!==config.iterations)throw Error('Formation is incomplete');return{version:FORMATION_VERSION,config,state,metrics:{...metrics},steps};}};
}
export function formTerrain(input){const f=createFormation(input);while(!f.done)f.step();return f.result();}
function checksum(bytes){let h=2166136261;for(const b of bytes)h=Math.imul(h^b,16777619);return h>>>0;}
function validate(result){const c=formationConfig(result.config);if(result.version!==FORMATION_VERSION||result.steps!==c.iterations)throw Error('Stale or incomplete formation cache');if(!(result.state instanceof Float32Array)||result.state.length!==c.resolution**2*4||!result.state.every(Number.isFinite))throw Error('Invalid formation state');for(let i=0;i<result.state.length;i+=4)if(result.state[i+1]<0||result.state[i+2]!==0||result.state[i+3]!==0)throw Error('Invalid initial material or actor history');return c;}
export function encodeFormation(result){
 const config=validate(result),payload=new Uint8Array(result.state.buffer,result.state.byteOffset,result.state.byteLength),header=new TextEncoder().encode(JSON.stringify({version:FORMATION_VERSION,config,steps:result.steps,metrics:result.metrics,checksum:checksum(payload)})),offset=8+Math.ceil(header.length/4)*4,b=new ArrayBuffer(offset+payload.length),v=new DataView(b);
 v.setUint32(0,0x48494c4c,true);v.setUint32(4,header.length,true);new Uint8Array(b,8,header.length).set(header);new Uint8Array(b,offset).set(payload);return b;
}
export function decodeFormation(buffer,expected){
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<8)throw Error('Invalid formation cache');const v=new DataView(buffer);if(v.getUint32(0,true)!==0x48494c4c)throw Error('Unknown formation cache');const length=v.getUint32(4,true),offset=8+Math.ceil(length/4)*4;if(offset>buffer.byteLength)throw Error('Partial formation cache header');
 const header=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,8,length))),config=formationConfig(header.config);
 if(buffer.byteLength!==offset+config.resolution**2*16)throw Error('Formation cache length mismatch');const bytes=new Uint8Array(buffer,offset);if(checksum(bytes)!==header.checksum)throw Error('Formation cache checksum mismatch');
 if(expected&&formationKey(expected)!==formationKey(config))throw Error('Formation cache recipe mismatch');const result={...header,config,state:new Float32Array(buffer.slice(offset))};validate(result);return result;
}
