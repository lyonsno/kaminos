// Sparse material storage and an explicit frontier. Coordinates are integer cells;
// amounts are fractions of loose cell volume. No elapsed-time or renderer dependency.
const key=p=>p.join(',');
const point=k=>k.split(',').map(Number);
const neighbors=[[0,-1,0],[0,1,0],[-1,0,0],[1,0,0],[0,0,-1],[0,0,1]];
const plus=(a,b)=>a.map((v,i)=>v+b[i]);
const check=p=>{if(!Array.isArray(p)||p.length!==3||!p.every(Number.isSafeInteger))throw Error('Expected integer cell coordinates');return p;};
export class AshDeposit {
 constructor({solid=p=>p[1]<0,blockSize=8}={}) {
  if(typeof solid!=='function'||!Number.isSafeInteger(blockSize)||blockSize<1)throw Error('Invalid deposit configuration');
  this.solid=solid;this.blockSize=blockSize;this.blocks=new Map();this.active=new Set();this.dirty=new Set();this.mass=0;this.cells=0;this.tick=0;
 }
 block(p){return key(p.map(v=>Math.floor(v/this.blockSize)));}
 amount(p){return this.blocks.get(this.block(p))?.get(key(p))?.[3]??0;}
 read(){return {mass:this.mass,occupiedCells:this.cells,blocks:this.blocks.size,activeCells:this.active.size,dirtyBlocks:this.dirty.size,tick:this.tick};}
 wake(p){if(this.amount(p)>0)this.active.add(key(p));}
 set(p,n){
  const id=this.block(p),k=key(p),old=this.amount(p);if(n===old)return;
  let block=this.blocks.get(id);
  if(n>0){if(!block)this.blocks.set(id,block=new Map());block.set(k,[...p,n]);if(!old)this.cells++;}
  else if(old){block.delete(k);this.cells--;this.active.delete(k);if(!block.size)this.blocks.delete(id);}
  this.mass+=n-old;this.dirty.add(id);this.wake(p);
  for(const delta of neighbors){const q=plus(p,delta);this.wake(q);this.dirty.add(this.block(q));}
 }
 add(p,n){check(p);if(!Number.isFinite(n)||n<=0||this.amount(p)+n>1+1e-12)throw Error('Cell amount must be positive and fit available capacity');if(this.solid(p))throw Error('Cannot deposit inside solid');this.set(p,this.amount(p)+n);}
 transfer(p,q,n){if(n<=1e-9)return 0;this.set(p,this.amount(p)-n);this.set(q,this.amount(q)+n);return n;}
 step(){
  if(!this.active.size)return {visited:0,moved:0,...this.read()};
  const work=this.active;this.active=new Set();let moved=0;
  for(const k of work){const p=point(k);if(!this.amount(p))continue;
   const below=plus(p,[0,-1,0]);
   if(!this.solid(below))moved+=this.transfer(p,below,Math.min(this.amount(p),1-this.amount(below)));
   // Only supported material spreads. A half-cell difference is the provisional
   // repose threshold. Rotate neighbor preference to reduce directional bias.
   if(this.amount(p)>0&&(this.solid(below)||this.amount(below)>1-1e-9)){
    const lateral=[[-1,0,0],[0,0,-1],[1,0,0],[0,0,1]];
    for(let j=0;j<4;j++){const q=plus(p,lateral[(j+this.tick)%4]);if(this.solid(q))continue;
     moved+=this.transfer(p,q,Math.max(0,(this.amount(p)-this.amount(q)-.5)/2));
    }
   }
  }
  this.tick++;return {visited:work.size,moved,...this.read()};
 }
 wakeBox(lo,hi){check(lo);check(hi);for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)this.wake([x,y,z]);}
 press(center,radius){
  check(center);if(!Number.isFinite(radius)||radius<=0)throw Error('Contact radius must be positive');
  const r=Math.ceil(radius),inside=p=>Math.hypot(...p.map((v,i)=>v-center[i]))<=radius;
  const sources=[],targets=[];
  // Search only the contact and its one-cell shell. Unaccommodated material
  // remains in place and is reported, never erased or silently clipped.
  for(let z=-r-1;z<=r+1;z++)for(let y=-r-1;y<=r+1;y++)for(let x=-r-1;x<=r+1;x++){
   const p=plus(center,[x,y,z]);if(this.solid(p))continue;
   if(inside(p)){if(this.amount(p))sources.push(p);}else if(Math.hypot(x,y,z)<=radius+1.5)targets.push(p);
  }
  targets.sort((a,b)=>a[1]-b[1]);let displaced=0,blocked=0,index=0;
  for(const p of sources){while(this.amount(p)>1e-9&&index<targets.length){const q=targets[index],n=Math.min(this.amount(p),1-this.amount(q));displaced+=this.transfer(p,q,n);if(1-this.amount(q)<1e-9)index++;else break;}blocked+=this.amount(p);}
  return {displaced,blocked};
 }
 takeDirtyBlocks(){const result=[...this.dirty];this.dirty.clear();return result;}
 snapshot(){return {schema:'kaminos.ash-deposit.v1',blockSize:this.blockSize,tick:this.tick,cells:[...this.blocks.values()].flatMap(b=>[...b.values()].map(v=>[...v])),active:[...this.active]};}
 static restore(data,{solid}={}){
  if(data?.schema!=='kaminos.ash-deposit.v1'||!Array.isArray(data.cells)||!Array.isArray(data.active)||!Number.isSafeInteger(data.tick)||data.tick<0)throw Error('Invalid ash checkpoint');
  const d=new AshDeposit({blockSize:data.blockSize,solid});
  for(const row of data.cells){if(!Array.isArray(row)||row.length!==4)throw Error('Invalid ash cell');const p=check(row.slice(0,3));if(d.amount(p))throw Error('Duplicate ash cell');d.add(p,row[3]);}
  d.active.clear();for(const k of data.active){if(typeof k!=='string')throw Error('Invalid active cell');const p=check(point(k));if(key(p)!==k||!d.amount(p))throw Error('Missing active cell');d.active.add(k);}d.tick=data.tick;return d;
 }
}
