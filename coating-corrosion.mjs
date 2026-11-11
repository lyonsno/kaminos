// Reduced, nondimensional thin-interface corrosion model. Exposure time is not
// calibrated service age. Iron thickness-equivalent is conserved as metal loss
// -> dissolved iron -> deposited oxide. Chemistry is locally oxygen-coupled;
// separate electrochemical potentials/cathodic fronts and osmotic fluid pressure
// are not solved. The coating is a small-slope elastic plate with an irreversible
// cohesive attachment, contacted by the growing solid oxide.
const defaults={transportRegime:'defect-fed',bondedMobility:.02,resolution:48,seed:19,wetPeriod:2,wetFraction:.65,oxygenSupply:1,
 moistureDiffusion:.002,oxygenDiffusion:.004,ironDiffusion:.0008,
 openingPermeability:2,paintPermeability:.012,corrosionRate:.18,
 precipitationRate:1.2,oxygenCapacity:.3,oxideExpansion:2.5,oxidePorosity:.35,
 metalScale:.025,filmThickness:.001,plateBending:2e-8,plateTension:.0002,
 attachmentStiffness:400,adhesionEnergy:.001,
 mechanicalInterval:.1,mechanicalTolerance:1e-7,
 defects:[{a:[.24,.45],b:[.59,.56],radius:.018},{a:[.76,.72],b:[.76,.72],radius:.024}]};
const names=['moisture','oxygen','dissolvedIron','rustIron','metalLoss','filmHeight','bond','opening','reactivity','nucleation','toughness'];
const total=a=>a.reduce((s,v)=>s+v,0);
function configuration(options={}){
 const c={...defaults,...options};
 if(!Number.isSafeInteger(c.resolution)||c.resolution<4)throw Error('resolution must be an integer at least four');
 if(!Number.isSafeInteger(c.seed))throw Error('seed must be an integer');
 for(const [k,v]of Object.entries(c)){
  if(['seed','resolution','defects','transportRegime'].includes(k))continue;
  if(!Number.isFinite(v)||v<0)throw Error(`Invalid corrosion setting ${k}`);
 }
 for(const k of ['wetPeriod','oxygenCapacity','oxideExpansion','metalScale','filmThickness','attachmentStiffness','adhesionEnergy','mechanicalInterval','mechanicalTolerance'])if(c[k]<=0)throw Error(`${k} must be positive`);
 if(!['defect-fed','distributed'].includes(c.transportRegime))throw Error('Unknown corrosion transport regime');
 if(c.wetFraction>1||c.oxygenSupply>1||c.oxidePorosity>=1)throw Error('Invalid concentration or porosity');
 if(!Array.isArray(c.defects)||!c.defects.every(d=>d&&[d.a,d.b].every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1))&&Number.isFinite(d.radius)&&d.radius>0&&d.radius<=.5))throw Error('Invalid coating defects');
 return structuredClone(c);
}
function distance(p,a,b){const x=b[0]-a[0],y=b[1]-a[1],q=x*x+y*y,t=q?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/q)):0;return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y);}
export function createCorrosionState(options={}){
 const config=configuration(options),n=config.resolution,s={schema:'kaminos.coating-corrosion.v1',config,time:0,chemicalSteps:0,mechanicalSolves:0};
 for(const name of names)s[name]=new Float64Array(n*n);
 let seed=config.seed>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=y*n+x,p=[(x+.5)/n,(y+.5)/n];let open=false;
  for(const d of config.defects)for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)if(distance([p[0]+ox,p[1]+oy],d.a,d.b)<=d.radius)open=true;
  s.opening[i]=Number(open);s.bond[i]=Number(!open);s.filmHeight[i]=config.filmThickness;
  s.reactivity[i]=.6+.8*random();s.nucleation[i]=.2+1.6*random();s.toughness[i]=config.adhesionEnergy*(.55+.9*random());
 }
 return s;
}
function neighborTable(n){const table=new Int32Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*n+x;table.set([y*n+(x+1)%n,y*n+(x+n-1)%n,((y+1)%n)*n+x,((y+n-1)%n)*n+x],i*4);}return table;}
function diffuse(field,coefficient,dt,n,neighbors,mobility){
 if(!coefficient)return;
 const next=new Float64Array(field.length),factor=coefficient*dt*n*n;
 for(let i=0;i<field.length;i++){
  let flux=0;for(let k=0;k<4;k++){const j=neighbors[i*4+k];flux+=(field[j]-field[i])*(mobility?Math.min(mobility[i],mobility[j]):1);}
  next[i]=field[i]+factor*flux;
 }
 field.set(next);
}
function relaxFilm(s,neighbors){
 const c=s.config,n=c.resolution,count=n*n,dx=1/n,D=c.plateBending/dx**4,T=c.plateTension/dx**2;
 const h=s.filmHeight,base=new Float64Array(count),obstacle=new Float64Array(count),lap=new Float64Array(count),next=new Float64Array(count);
 for(let i=0;i<count;i++){base[i]=c.filmThickness-c.metalScale*s.metalLoss[i];obstacle[i]=base[i]+c.metalScale*c.oxideExpansion*s.rustIron[i]/(1-c.oxidePorosity);}
 // The quadratic plate energy with a unilateral oxide contact constraint is
 // convex for a fixed attachment field.
 // Weighted Jacobi uses a global Hessian row-sum bound; residual tolerance, not
 // a hidden iteration cap, determines completion. Bond failure is irreversible.
 let failed;
 do{
  let change;
  do{
   for(let i=0;i<count;i++){let v=0;if(!s.opening[i])for(let k=0;k<4;k++){const j=neighbors[i*4+k];if(!s.opening[j])v+=h[i]-h[j];}lap[i]=v;}
   change=0;
   const denom=64*D+8*T+c.attachmentStiffness;
   for(let i=0;i<count;i++){
    if(s.opening[i]){next[i]=base[i];continue;}
    let ll=0;for(let k=0;k<4;k++){const j=neighbors[i*4+k];if(!s.opening[j])ll+=lap[i]-lap[j];}
    const gradient=D*ll+T*lap[i]+c.attachmentStiffness*s.bond[i]*(h[i]-base[i]);
    next[i]=Math.max(obstacle[i],h[i]-.85*gradient/denom);change=Math.max(change,Math.abs(next[i]-h[i]));
    if(!Number.isFinite(next[i]))throw Error('Nonfinite plate relaxation');
   }
   h.set(next);
  }while(change>c.mechanicalTolerance);
  failed=0;for(let i=0;i<count;i++)if(s.bond[i]&&.5*c.attachmentStiffness*(h[i]-base[i])**2>s.toughness[i]){s.bond[i]=0;failed++;}
 }while(failed);
 s.mechanicalSolves++;
}
export function advanceCorrosion(s,duration){
 if(!Number.isFinite(duration)||duration<0)throw Error('Corrosion time must be finite and nonnegative');
 if(!duration)return s;
 const c=s.config,n=c.resolution,neighbors=neighborTable(n),end=s.time+duration;
 const dmax=Math.max(c.moistureDiffusion,c.oxygenDiffusion,c.ironDiffusion)*Math.max(1,c.bondedMobility),stable=dmax?.24/(n*n*dmax):Infinity;
 let untilMechanical=Math.min(end,s.time+c.mechanicalInterval);
 while(s.time<end){
  const phase=(s.time%c.wetPeriod)/c.wetPeriod,wet=phase<c.wetFraction?1:0;
  const switchAt=s.time+(wet?c.wetFraction-phase:1-phase)*c.wetPeriod;
  const dt=Math.min(stable,untilMechanical-s.time,end-s.time,switchAt-s.time>1e-12?switchAt-s.time:stable);
  if(!(dt>0)||s.time+dt===s.time)throw Error('Corrosion timestep cannot advance');
  const interfaceMobility=c.transportRegime==='defect-fed'?Float64Array.from(s.bond,(b,i)=>s.opening[i]||!b?1:c.bondedMobility):null;
  const wetMobility=Float64Array.from(s.moisture,(w,i)=>w*(interfaceMobility?.[i]??1));
  diffuse(s.moisture,c.moistureDiffusion,dt,n,neighbors,interfaceMobility);diffuse(s.oxygen,c.oxygenDiffusion,dt,n,neighbors,interfaceMobility);diffuse(s.dissolvedIron,c.ironDiffusion,dt,n,neighbors,wetMobility);
  for(let i=0;i<n*n;i++){
   // In the defect-fed regime a bonded interface has no under-film cavity
   // for normal ingress; lateral transport can still wet its thin interface.
   // Detachment opens that cavity. Distributed permeation remains a separate
   // retained regime rather than being silently reinterpreted.
   const permeability=s.opening[i]?c.openingPermeability:c.paintPermeability*(c.transportRegime==='defect-fed'?1-s.bond[i]:1);
   s.moisture[i]=wet+(s.moisture[i]-wet)*Math.exp(-permeability*dt);
   s.oxygen[i]=c.oxygenSupply+(s.oxygen[i]-c.oxygenSupply)*Math.exp(-permeability*dt);
   const consumed=Math.min(c.corrosionRate*s.reactivity[i]*s.moisture[i]*s.oxygen[i]*dt,s.oxygen[i]*c.oxygenCapacity);
   s.metalLoss[i]+=consumed;s.dissolvedIron[i]+=consumed;s.oxygen[i]=Math.max(0,s.oxygen[i]-consumed/c.oxygenCapacity);
   const deposited=s.dissolvedIron[i]*(1-Math.exp(-c.precipitationRate*s.nucleation[i]*s.moisture[i]*dt));
   s.dissolvedIron[i]-=deposited;s.rustIron[i]+=deposited;
  }
  s.time+=dt;s.chemicalSteps++;
  if(s.time>=untilMechanical-1e-12){relaxFilm(s,neighbors);untilMechanical=Math.min(end,s.time+c.mechanicalInterval);}
 }
 return s;
}
export function corrosionSummary(s){
 const consumedIron=total(s.metalLoss),dissolvedIron=total(s.dissolvedIron),depositedIron=total(s.rustIron),count=s.bond.length;
 return {time:s.time,formationResolution:s.config.resolution,transportRegime:s.config.transportRegime,consumedIron,dissolvedIron,depositedIron,ironBalanceError:consumedIron-dissolvedIron-depositedIron,
  debondedFraction:s.bond.reduce((v,b,i)=>v+Number(!b&&!s.opening[i]),0)/count,openingFraction:total(s.opening)/count,
  oxideSolidVolumeEquivalent:depositedIron*s.config.oxideExpansion,
  chemicalSteps:s.chemicalSteps,mechanicalSolves:s.mechanicalSolves,
  model:'Nondimensional oxygen-coupled interface corrosion/precipitation and small-slope plate contact; no calibrated service age, osmotic fluid pressure or film fracture'};
}
export function serializeCorrosion(s){return {...Object.fromEntries(['schema','time','chemicalSteps','mechanicalSolves'].map(k=>[k,s[k]])),config:structuredClone(s.config),...Object.fromEntries(names.map(k=>[k,Array.from(s[k])]))};}
export function restoreCorrosion(value){
 if(value?.schema!=='kaminos.coating-corrosion.v1')throw Error('Unknown corrosion state');
 const config=configuration({transportRegime:'distributed',...value.config}),count=config.resolution**2,s={schema:value.schema,config};
 for(const k of ['time','chemicalSteps','mechanicalSolves'])if(!Number.isFinite(value[k])||value[k]<0)throw Error(`Invalid retained ${k}`);else s[k]=value[k];
 for(const k of names){if(!Array.isArray(value[k])||value[k].length!==count||!value[k].every(Number.isFinite))throw Error(`Invalid retained ${k}`);s[k]=Float64Array.from(value[k]);}
 for(const k of ['moisture','oxygen','bond','opening'])if(!s[k].every(v=>v>=0&&v<=1))throw Error(`Invalid retained ${k}`);
 for(const k of ['dissolvedIron','rustIron','metalLoss','reactivity','nucleation','toughness'])if(!s[k].every(v=>v>=0))throw Error(`Invalid retained ${k}`);
 return s;
}
