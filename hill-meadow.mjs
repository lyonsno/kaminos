// Small authored initial conditions. No phase engine, stochastic search or frame-loop work.
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const blend=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t));
function lobe(x,z,{x:cx,z:cz,width,length,angle=0}){
  const dx=x-cx,dz=z-cz,c=Math.cos(angle),s=Math.sin(angle);
  const u=(c*dx+s*dz)/width,v=(-s*dx+c*dz)/length;
  return Math.exp(-1.5*(u*u+v*v));
}
function shape(s,kind){
  if(!s||!['x','z','width','length',kind==='hill'?'height':'depth'].every(k=>Number.isFinite(s[k]))||s.width<=0||s.length<=0||!Number.isFinite(s.angle??0)||s[kind==='hill'?'height':'depth']<0)throw Error(`Invalid ${kind} shape`);
}
export function buildMeadowHill(recipe,source={}){
  const r=structuredClone(recipe);
  if(!r||![r.width,r.length,r.groundHeight,r.edgeHeight,r.edgeBlend].every(Number.isFinite)||r.width<=0||r.length<=0||r.edgeBlend<=0||r.edgeHeight<0||r.groundHeight<r.edgeHeight)throw Error('Invalid meadow dimensions');
  if(r.grid?.length!==2||!r.grid.every(n=>Number.isSafeInteger(n)&&n>=2))throw Error('Invalid meadow grid');
  if(!Array.isArray(r.hills))throw Error('Invalid hills');r.hills.forEach(h=>shape(h,'hill'));shape(r.basin,'basin');shape(r.outlet,'outlet');
  for(const key of ['grass','crest','basin','earth'])if(r.palette?.[key]?.length!==3||!r.palette[key].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Invalid meadow palette');
  const [nx,nz]=r.grid,grid={x:nx,z:nz,min:[-r.width/2,-r.length/2],step:[r.width/(nx-1),r.length/(nz-1)]};
  const height=(x,z)=>{
    const edge=smooth(Math.min(r.width/2-Math.abs(x),r.length/2-Math.abs(z))/r.edgeBlend);
    const hills=r.hills.reduce((h,form)=>h+form.height*lobe(x,z,form),0);
    const basin=r.basin.depth*lobe(x,z,r.basin),outlet=r.outlet.depth*lobe(x,z,r.outlet);
    return r.edgeHeight+edge*(Math.max(r.edgeHeight,r.groundHeight+hills-basin-outlet)-r.edgeHeight);
  };
  const heights=[],colors=[];
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const wx=grid.min[0]+x*grid.step[0],wz=grid.min[1]+z*grid.step[1],h=height(wx,wz);
    heights.push(Math.fround(h));
    const slope=Math.hypot((height(wx+.02,wz)-height(wx-.02,wz))/.04,(height(wx,wz+.02)-height(wx,wz-.02))/.04);
    let color=blend(r.palette.grass,r.palette.crest,smooth((h-r.groundHeight)/1.05)*.85);
    color=blend(color,r.palette.basin,lobe(wx,wz,r.basin)*.55);
    color=blend(color,r.palette.earth,smooth((slope-.7)/.9)*.3);
    // Broad, restrained color variation gives scale without adding geometric noise.
    const variation=1+.025*Math.sin(wx*2.1+wz*.8)*Math.cos(wz*1.4-wx*.4);
    colors.push(...color.map(v=>Math.fround(clamp(v*variation))));
  }
  let hash=2166136261;for(const b of new Uint8Array(Float32Array.from(heights).buffer)){hash^=b;hash=Math.imul(hash,16777619);}
  return {schema:'kaminos.frozen-hill.v1',source:{repo:'kaminos',commit:source.commit??'authored-meadow-recipe',phase:'frozen',
    generator:'hill-meadow.mjs',...source,sampleChecksum:(hash>>>0).toString(16).padStart(8,'0')},
    title:r.name,recipe:r,grid,heights,colors,transform:{scale:1,translation:[0,0,0]}};
}
