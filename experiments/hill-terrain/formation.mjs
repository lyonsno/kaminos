// Geological preparation only. Neither this solver nor its cache runs in playback.
export const FORMATION_VERSION='hill-geology-7';
const defaults={seed:47,tilesX:6,tilesZ:5,resolution:193,width:8,length:9,iterations:260,relief:3.8,valleys:4,apron:.25,tilt:.35,strike:16,fold:.22,bedThickness:.26,hardness:4.5,incision:.065,channelArea:.18,weathering:.0008,transport:.12,creep:.018,repose:34,bankFailure:1,bankRepose:52};
export const FORMATION_FIELDS=[
 {key:'seed',group:'Epoch & Seed',title:'Landscape seed',min:1,max:999,step:1,unit:'id',default:defaults.seed,tooltip:'Deterministic random seed for noise warping and valley asymmetry (default 47, range 1–999).'},
 {key:'iterations',group:'Epoch & Seed',title:'Formation age · steps',min:0,max:3000,step:20,unit:'steps',default:defaults.iterations,tooltip:'Geological erosion epoch along a non-convergent transient trajectory: 30–80 = youthful rills, 200–500 = mature canyons & fans, 1000–3000 = old-age hogback fins (default 260).'},
 {key:'relief',group:'Macro Landform',title:'Initial relief',min:.5,max:7,step:.1,unit:'m',default:defaults.relief,tooltip:'Peak elevation of the inherited upland massif above the valley floor before erosion begins (default 3.8, range 0.5–7.0).'},
 {key:'valleys',group:'Macro Landform',title:'Major valleys',min:1,max:7,step:.5,unit:'basins',default:defaults.valleys,tooltip:'Number of primary canyon embayments and dividing mountain buttress ridges across the stitched tile range (default 4, range 1–7).'},
 {key:'apron',group:'Macro Landform',title:'Receiving apron',min:.10,max:.55,step:.02,unit:'ratio',default:defaults.apron,tooltip:'Fraction of the front domain graded into a low-slope piedmont floor where coalescing alluvial fans deposit (default 0.25, range 0.10–0.55).'},
 {key:'tilt',group:'Rock Bedding',title:'Rock-bed tilt',min:-1.5,max:1.5,step:.05,unit:'slope',default:defaults.tilt,tooltip:'Dip slope (rise/run) of the 3D rock strata. High values (0.7–1.2) with high resistance contrast carve dramatic cuesta hogbacks (default 0.35, range -1.5–1.5).'},
 {key:'strike',group:'Rock Bedding',title:'Bed strike angle',min:-90,max:90,step:2,unit:'deg',default:defaults.strike,tooltip:'Horizontal compass rotation of tilted rock strata across the tiles in degrees (default 16°, range -90° to 90°).'},
 {key:'fold',group:'Rock Bedding',title:'Rock-bed folding',min:0,max:.8,step:.02,unit:'m',default:defaults.fold,tooltip:'Amplitude of synclinal/anticlinal wave folding in the rock strata (default 0.22, range 0.0–0.8).'},
 {key:'bedThickness',group:'Rock Bedding',title:'Rock-bed thickness',min:.10,max:1.0,step:.02,unit:'m',default:defaults.bedThickness,tooltip:'Vertical wavelength of alternating hard and soft sedimentary rock beds (default 0.26, range 0.10–1.0).'},
 {key:'hardness',group:'Rock Bedding',title:'Bed resistance contrast',min:0,max:15,step:.2,unit:'×',default:defaults.hardness,tooltip:'Strength multiplier of hard strata vs. soft interbeds. Values 8–14 leave prominent hogback fins and ledges (default 4.5, range 0–15).'},
 {key:'channelArea',group:'Erosion & Weathering',title:'Channel source area',min:.02,max:1.0,step:.02,unit:'m²',default:defaults.channelArea,tooltip:'Minimum upstream catchment area before surface runoff incises bedrock channels; lower values branch finer rills (default 0.18, range 0.02–1.0).'},
 {key:'incision',group:'Erosion & Weathering',title:'Stream incision',min:0,max:.20,step:.005,unit:'rate',default:defaults.incision,tooltip:'Fluvial bedrock cutting power per formation step in active stream channels (default 0.065, range 0.0–0.20).'},
 {key:'weathering',group:'Erosion & Weathering',title:'Weathering rate',min:0,max:.004,step:.0001,unit:'m/step',default:defaults.weathering,tooltip:'Peak conversion rate of shallow-covered bedrock into loose soil before regolith insulation shuts it off (default 0.0008, range 0.0–0.004).'}
];
export const FORMATION_PRESETS=[
 {id:'range-bajada',title:'Range & Bajada (Default · 30 tiles)',description:'Four major canyon catchments with oblique branching spurs, tilted beds, and a coalescing piedmont fan apron.',patch:{iterations:260,relief:3.8,valleys:4,apron:.25,tilt:.35,strike:16,fold:.22,bedThickness:.26,hardness:4.5,channelArea:.18,incision:.065,weathering:.0008}},
 {id:'cuesta-hogbacks',title:'Cuesta Hogbacks (Tilted Strata · 300 steps)',description:'Steeply tilted high-contrast strata (tilt 1.0, hardness 10.7) carved by transverse water gaps and dip-slope ribs.',patch:{iterations:300,relief:2.2,valleys:3.5,apron:.24,tilt:1.0,strike:12,fold:.16,bedThickness:.42,hardness:10.7,channelArea:.18,incision:.065,weathering:.0008}},
 {id:'skeletal-fins',title:'Skeletal Hogback Fins (Old Age · 1200 steps)',description:'Extended erosion strips soft interbeds to base level, leaving resistant rock fins protruding through broad valley fills.',patch:{iterations:1200,relief:2.4,valleys:3.5,apron:.26,tilt:.95,strike:18,fold:.14,bedThickness:.40,hardness:11.2,channelArea:.16,incision:.068,weathering:.0007}},
 {id:'folded-domes',title:'Folded Anticlinal Ridges (340 steps)',description:'Strongly folded strata breached by branching drainage into curved ring ledges and interior valleys.',patch:{iterations:340,relief:3.9,valleys:3,apron:.25,tilt:.22,strike:-24,fold:.58,bedThickness:.26,hardness:7.5,channelArea:.16,incision:.065,weathering:.0008}},
 {id:'youthful-scarp',title:'Youthful Escarpment (Early · 60 steps)',description:'High-relief newly uplifted range front with nascent gullies and steep exposed rock scarps.',patch:{iterations:60,relief:4.5,valleys:4.5,apron:.20,tilt:.30,strike:10,fold:.20,bedThickness:.28,hardness:5.0,channelArea:.14,incision:.070,weathering:.0006}}
];
export function formationConfig(input={}){
 const c=Object.fromEntries(Object.keys(defaults).map(k=>[k,input[k]??defaults[k]]));
 if(!Number.isSafeInteger(c.seed)||c.seed<0||c.seed>0xffffffff)throw Error('Formation seed must be uint32');
 if(!Number.isSafeInteger(c.resolution)||c.resolution<3)throw Error('Formation resolution must be a whole grid >=3');
 if(!Number.isSafeInteger(c.tilesX)||c.tilesX<1||c.tilesX>16||!Number.isSafeInteger(c.tilesZ)||c.tilesZ<1||c.tilesZ>16)throw Error('Formation tile counts must be whole numbers in 1..16');
 if(!Number.isSafeInteger(c.iterations)||c.iterations<0)throw Error('Formation iterations must be nonnegative whole steps');
 if(!Number.isFinite(c.valleys)||c.valleys<1||c.valleys>12)throw Error('Formation valleys must be in 1..12');
 for(const k of ['width','length','bedThickness','relief'])if(!Number.isFinite(c[k])||c[k]<=0)throw Error('Positive formation '+k+' required');
 for(const k of ['hardness','incision','channelArea','weathering','transport','creep','fold','bankFailure'])if(!Number.isFinite(c[k])||c[k]<0)throw Error('Nonnegative formation '+k+' required');
 if(!Number.isFinite(c.tilt)||!Number.isFinite(c.strike)||!Number.isFinite(c.repose)||c.repose<0||c.repose>=90)throw Error('Invalid formation slope');
 if(!Number.isFinite(c.bankRepose)||c.bankRepose<=0||c.bankRepose>=90||!Number.isFinite(c.apron)||c.apron<0||c.apron>=1)throw Error('Invalid rock-bank or apron geometry');
 return c;
}
export const formationKey=input=>JSON.stringify([FORMATION_VERSION,formationConfig(input)]);
export const formationRecipeKey=input=>JSON.stringify([FORMATION_VERSION,{...formationConfig(input),iterations:0}]);
export function partitionTiles(input={}){
 const c=formationConfig(input),n=c.resolution,span=n-1,nx=Math.min(c.tilesX,span),nz=Math.min(c.tilesZ,span),tiles=[];
 let indexOffset=0;
 for(let tz=0;tz<nz;tz++){
  const z0=Math.floor(tz*span/nz),z1=Math.floor((tz+1)*span/nz);
  for(let tx=0;tx<nx;tx++){
   const x0=Math.floor(tx*span/nx),x1=Math.floor((tx+1)*span/nx),quads=(x1-x0)*(z1-z0),indexCount=quads*6;
   tiles.push({id:`tile-${tx}-${tz}`,tx,tz,index:tiles.length,x0,x1,z0,z1,quads,indexOffset,indexCount,bounds:{minX:(x0/span-.5)*c.width,maxX:(x1/span-.5)*c.width,minZ:(z0/span-.5)*c.length,maxZ:(z1/span-.5)*c.length}});
   indexOffset+=indexCount;
  }
 }
 return tiles;
}
export function buildTiledIndices(input={}){
 const c=formationConfig(input),n=c.resolution,tiles=partitionTiles(c),indices=new Uint32Array((n-1)**2*6);
 let k=0;
 for(const t of tiles)for(let z=t.z0;z<t.z1;z++)for(let x=t.x0;x<t.x1;x++){const a=z*n+x;indices[k]=a;indices[k+1]=a+n;indices[k+2]=a+1;indices[k+3]=a+1;indices[k+4]=a+n;indices[k+5]=a+n+1;k+=6;}
 return indices;
}
function hash(x,z,seed){let h=Math.imul(x^seed,374761393)^Math.imul(z,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function noise(x,z,seed){const a=Math.floor(x),b=Math.floor(z),u=x-a,v=z-b,s=u*u*(3-2*u),t=v*v*(3-2*v);return (hash(a,b,seed)*(1-s)+hash(a+1,b,seed)*s)*(1-t)+(hash(a,b+1,seed)*(1-s)+hash(a+1,b+1,seed)*(s))*t;}
function fbm(u,v,seed,octaves=5){
 let val=0,w=1,sum=0;
 for(let o=0;o<octaves;o++){val+=w*(noise(u*2**o,v*2**o,seed+o*71)-.5);sum+=w;w*=.52;}
 return val/sum;
}
export function rockResistance(x,y,z,c){
 const rad=(c.strike??0)*Math.PI/180,ca=Math.cos(rad),sa=Math.sin(rad),rx=x*ca+z*sa,rz=-x*sa+z*ca;
 const warp=.3*Math.sin(rx*.55+rz*.35+c.seed*.03)+.18*Math.cos(rz*.85-rx*.45);
 const phase=(y-c.tilt*rx-c.fold*(Math.sin(rz*.7+rx*.2)+warp)+c.seed*.017)/c.bedThickness;
 // Persistent strike-rotated warped beds in world space: excavation exposes different resistance.
 const band=Math.max(0,.5+.5*Math.sin(phase*Math.PI*2));
 return 1+c.hardness*band**5;
}
export function seedGeology(input){
 const c=formationConfig(input),n=c.resolution,s=new Float32Array(n*n*4),asym=(hash(3,7,c.seed)-.5)*.22;
 const spanX=Math.max(1,Math.sqrt(c.tilesX)*c.width/8),spanZ=Math.max(1,Math.sqrt(c.tilesZ)*c.length/9);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const u=x/(n-1),v=z/(n-1);
  const wx=u*spanX+.22*fbm(u*spanX*1.8,v*spanZ*1.8,c.seed+19,3),wz=v*spanZ+.22*fbm(u*spanX*1.8,v*spanZ*1.8,c.seed+43,3);
  const texture=fbm(wx*2.6,wz*2.6,c.seed,5),shift=asym*(1-v)+(wx/spanX-u)*.45;
  const wavePhase=(u+shift*.45-.5)*c.valleys*Math.PI*2+v*.85*Math.sin((u-.5)*Math.PI*2+c.seed*.11);
  // Scalloped mountain-front boundary that embays into valleys while keeping the lower apron flat.
  const frontShift=c.apron>0?Math.min(c.apron*.28,.038)*(Math.cos(wavePhase)+.5*(wx/spanX-u)):0;
  const localApron=Math.max(0,Math.min(.92,c.apron+frontShift));
  const upland=Math.max(0,(1-v-localApron)/(1-localApron));
  const subPhase=(u*c.valleys*2.1-(1-upland)*1.3+wx*.35)*Math.PI*2;
  const ridgeComb=(.5+.5*Math.cos(wavePhase))**1.35;
  const secondarySpurs=(.5+.5*Math.cos(subPhase))**1.8*(1-.35*upland);
  const tier=.12*Math.sin(upland*Math.PI*2.2+.5*Math.cos(wavePhase))*Math.sin(Math.PI*upland);
  const env=Math.sin(Math.PI*upland)**2;
  const spurs=(.28*ridgeComb+.16*secondarySpurs+Math.max(0,tier))*env;
  const amphitheater=.16*(2*(u-.5-shift*.5))**2;
  const broad=.10+(.54+amphitheater)*upland**2+spurs;
  const apronGrade=.006*(1-v);
  s[(z*n+x)*4]=.10+apronGrade+c.relief*(broad+.44*texture*Math.max(0,Math.sin(Math.PI*upland))**1.6);
  s[(z*n+x)*4+1]=.022;
 }
 return s;
}
const ox=[-1,1,0,0,-1,1,-1,1],oz=[0,0,-1,1,-1,-1,1,1];
// Priority-flood gives depressions a spill route without changing bedrock. The
// strict flood rank makes the multi-receiver graph acyclic across all stitched tiles.
export function drainage(state,input,scratch=null){
 const c=formationConfig(input),n=c.resolution,N=n*n;
 const filled=scratch?.filled??new Float64Array(N),receiver=scratch?.receiver??new Int32Array(N),rank=scratch?.rank??new Int32Array(N),seen=scratch?.seen??new Uint8Array(N),order=scratch?.order??new Int32Array(N),heap=scratch?.heap??new Int32Array(N);
 const distance=scratch?.distance??new Float64Array(N),area=scratch?.area??new Float64Array(N),targets=scratch?.targets??new Int32Array(N*4),weights=scratch?.weights??new Float64Array(N*4),dists=scratch?.dists??new Float64Array(N*4);
 receiver.fill(-1);seen.fill(0);targets.fill(-1);weights.fill(0);dists.fill(0);
 let hLen=0,count=0;
 const before=(a,b)=>filled[a]<filled[b]||(filled[a]===filled[b]&&a<b);
 const push=i=>{let k=hLen++;heap[k]=i;while(k>0){const p=(k-1)>>1,hk=heap[k],hp=heap[p];if(!before(hk,hp))break;heap[k]=hp;heap[p]=hk;k=p;}};
 const pop=()=>{const a=heap[0],tail=heap[--hLen];if(hLen>0){heap[0]=tail;let k=0;while((k<<1)+1<hLen){let j=(k<<1)+1;if(j+1<hLen&&before(heap[j+1],heap[j]))j++;if(!before(heap[j],tail))break;heap[k]=heap[j];k=j;}heap[k]=tail;}return a;};
 const outletSpan=c.tilesX>1?.42:.24;
 for(let x=0;x<n;x++){if(Math.abs(x/(n-1)-.5)>outletSpan)continue;const i=(n-1)*n+x;seen[i]=1;filled[i]=state[i*4]+state[i*4+1];push(i);}
 while(hLen>0){const i=pop(),x=i%n,z=(i/n)|0;rank[i]=count;order[count++]=i;
  for(let k=0;k<8;k++){const xx=x+ox[k],zz=z+oz[k];if(xx<0||xx>=n||zz<0||zz>=n)continue;const j=zz*n+xx;if(seen[j])continue;seen[j]=1;const hj=state[j*4]+state[j*4+1];filled[j]=hj>filled[i]?hj:filled[i];receiver[j]=i;push(j);}
 }
 const dx=c.width/(n-1),dz=c.length/(n-1),diag=Math.hypot(dx,dz),stepDist=[dx,dx,dz,dz,diag,diag,diag,diag];
 area.fill(dx*dz);
 for(let i=0;i<N;i++){if(receiver[i]<0)continue;let best=-Infinity;const x=i%n,z=(i/n)|0;
  let t0=-1,t1=-1,t2=-1,t3=-1,s0=0,s1=0,s2=0,s3=0,d0=0,d1=0,d2=0,d3=0;
  for(let k=0;k<8;k++){const xx=x+ox[k],zz=z+oz[k];if(xx<0||xx>=n||zz<0||zz>=n)continue;const j=zz*n+xx;if(rank[j]>=rank[i])continue;
   const d=stepDist[k],slope=(filled[i]-filled[j])/d;
   if(slope>best){best=slope;receiver[i]=j;distance[i]=d;}
   if(slope>s0){s3=s2;t3=t2;d3=d2;s2=s1;t2=t1;d2=d1;s1=s0;t1=t0;d1=d0;s0=slope;t0=j;d0=d;}
   else if(slope>s1){s3=s2;t3=t2;d3=d2;s2=s1;t2=t1;d2=d1;s1=slope;t1=j;d1=d;}
   else if(slope>s2){s3=s2;t3=t2;d3=d2;s2=slope;t2=j;d2=d;}
   else if(slope>s3){s3=slope;t3=j;d3=d;}
  }
  const v=z/(n-1),onApron=v>=1-c.apron*1.15;
  if(t0<0){targets[i*4]=receiver[i];weights[i*4]=1;dists[i*4]=distance[i];}
  else if(!onApron){
   const w0=s0**2.1,w1=t1>=0?s1**2.1:0,sum=w0+w1;
   targets[i*4]=t0;weights[i*4]=w0/sum;dists[i*4]=d0;
   if(t1>=0){targets[i*4+1]=t1;weights[i*4+1]=w1/sum;dists[i*4+1]=d1;}
  }else{
   const sum=s0+s1+s2+s3;
   targets[i*4]=t0;weights[i*4]=s0/sum;dists[i*4]=d0;
   if(t1>=0){targets[i*4+1]=t1;weights[i*4+1]=s1/sum;dists[i*4+1]=d1;}
   if(t2>=0){targets[i*4+2]=t2;weights[i*4+2]=s2/sum;dists[i*4+2]=d2;}
   if(t3>=0){targets[i*4+3]=t3;weights[i*4+3]=s3/sum;dists[i*4+3]=d3;}
  }
 }
 for(let k=N-1;k>=0;k--){const i=order[k];if(receiver[i]<0)continue;
  for(let m=0;m<4;m++){const t=targets[i*4+m];if(t>=0)area[t]+=area[i]*weights[i*4+m];}
 }
 let outletArea=0;for(let i=0;i<N;i++)if(receiver[i]<0)outletArea+=area[i];
 return{receiver,order,area,distance,filled,outletArea,targets,weights,dists};
}
export function formationStep(state,input,metrics,scratch=null){
 const c=formationConfig(input),n=c.resolution,N=n*n,dx=c.width/(n-1),dz=c.length/(n-1),cell=dx*dz;
 const domainScale=Math.max(1,Math.hypot(c.width,c.length)/Math.hypot(8,9)),effDx=dx/domainScale,effDz=dz/domainScale,effCell=effDx*effDz,areaScale=1/(domainScale*domainScale);
 const out=scratch?.out??new Float64Array(N*4);for(let i=0;i<N*4;i++)out[i]=state[i];
 const load=scratch?.load??new Float64Array(N);load.fill(0);
 const d=drainage(state,c,scratch);
 // Humped regolith weathering: bare rock cliffs weather slowly, moist thin cover
 // peaks around 0.018, and regolith cover >= 0.062 insulates underlying bedrock.
 for(let i=0;i<N;i++){
  const soil=out[i*4+1],insul=Math.max(0,1-soil/.062);
  if(insul<=0)continue;
  const x=(i%n/(n-1)-.5)*c.width,z=(((i/n)|0)/(n-1)-.5)*c.length,strength=rockResistance(x,out[i*4],z,c);
  const hump=(.18+.82*Math.min(1,soil/.018))*(insul*insul),w=c.weathering*hump/strength;
  out[i*4]-=w;out[i*4+1]+=w;metrics.weathered+=w*cell;
 }
 for(let k=N-1;k>=0;k--){const i=d.order[k],j=i*4,r=d.receiver[i];if(r<0){metrics.exportedVolume+=load[i];continue;}
  const distEff=d.distance[i]/domainScale,h=out[j]+out[j+1],down=out[r*4]+out[r*4+1],slope=Math.max(0,(h-down)/distEff),stream=Math.sqrt(Math.max(0,d.area[i]*areaScale-c.channelArea));
  const capacity=c.transport*stream*slope*(domainScale*domainScale);let sediment=load[i];
  if(sediment>capacity){// Deposition steepens the reach and bifurcates across lower apron neighbors.
   const z=(i/n)|0,v=z/(n-1),apronWeight=Math.max(0,Math.min(1,(v-(1-c.apron*1.25))/(c.apron*1.25)));
   const fanReach=distEff*(1+apronWeight*(.32/Math.max(1e-4,effCell)));
   const deposit=Math.min((sediment-capacity)/cell,(sediment-capacity)/(cell*(1+c.transport*stream/(effCell*fanReach))));
   out[j+1]+=deposit;metrics.deposited+=deposit*cell;sediment-=deposit*cell;
   let wSum=0,f0=0,f1=0,f2=0,f3=0;
   const t0=d.targets[j],t1=d.targets[j+1],t2=d.targets[j+2],t3=d.targets[j+3];
   if(t0>=0){f0=Math.max(1e-5,(out[j]+out[j+1]-out[t0*4]-out[t0*4+1])/d.dists[j]);wSum+=f0;}
   if(t1>=0){f1=Math.max(1e-5,(out[j]+out[j+1]-out[t1*4]-out[t1*4+1])/d.dists[j+1]);wSum+=f1;}
   if(t2>=0){f2=Math.max(1e-5,(out[j]+out[j+1]-out[t2*4]-out[t2*4+1])/d.dists[j+2]);wSum+=f2;}
   if(t3>=0){f3=Math.max(1e-5,(out[j]+out[j+1]-out[t3*4]-out[t3*4+1])/d.dists[j+3]);wSum+=f3;}
   if(wSum>0){
    if(t0>=0)load[t0]+=sediment*(f0/wSum);if(t1>=0)load[t1]+=sediment*(f1/wSum);
    if(t2>=0)load[t2]+=sediment*(f2/wSum);if(t3>=0)load[t3]+=sediment*(f3/wSum);
    continue;
   }
  }else if(stream>0){
   // Stream-power incision is limited by available relief, base level and carrying capacity.
   const x=(i%n/(n-1)-.5)*c.width,z=(((i/n)|0)/(n-1)-.5)*c.length,K=c.incision*stream/distEff;
   const incision=Math.max(0,h-down)*K/(1+K);
   let need=Math.min(incision,(capacity-sediment)/(cell*(1+c.transport*stream/(effCell*distEff)))),soil=Math.min(out[j+1],need);out[j+1]-=soil;need-=soil;
   const baseGuard=Math.min(1,Math.max(0,(out[j]-.14)/.65));
   const rock=(need*baseGuard)/rockResistance(x,out[j],z,c);out[j]-=rock;sediment+=(soil+rock)*cell;metrics.erodedVolume+=(soil+rock)*cell;metrics.rockEroded+=rock*cell;
  }
  for(let m=0;m<4;m++){const t=d.targets[j+m];if(t>=0)load[t]+=sediment*d.weights[j+m];}
 }
 // Exposed over-steep rock banks fail locally into loose talus. Transfer from
 // rock to neighboring loose cover conserves volume; buried banks are supported
 // by that cover. The implicit four-neighbor factor bounds each shared transfer.
 const bankFlow=scratch?.bankFlow??new Float64Array(N*4),bankLimit=Math.tan(c.bankRepose*Math.PI/180);bankFlow.fill(0);
 for(let i=0;i<N;i++){const x=i%n,z=(i/n)|0,bed=out[i*4],strength=rockResistance((x/(n-1)-.5)*c.width,bed,(z/(n-1)-.5)*c.length,c),rate=c.bankFailure/(1+4*c.bankFailure)/strength;
  for(let k=0;k<4;k++){const xx=x+ox[k],zz=z+oz[k];if(xx<0||xx>=n||zz<0||zz>=n)continue;const j=zz*n+xx;
   bankFlow[i*4+k]=Math.max(0,bed-out[j*4]-out[j*4+1]-bankLimit*(k<2?effDx:effDz))*rate;}
 }
 for(let i=0;i<N;i++){const x=i%n,z=(i/n)|0,j=i*4,loss=bankFlow[j]+bankFlow[j+1]+bankFlow[j+2]+bankFlow[j+3];out[j]-=loss;
  out[j+1]+=(x?bankFlow[j-3]:0)+(x+1<n?bankFlow[j+4]:0)+(z?bankFlow[j-n*4+3]:0)+(z+1<n?bankFlow[j+n*4+2]:0);metrics.bankCollapsed=(metrics.bankCollapsed??0)+loss*cell;
 }
 // Conservative downslope creep, steep-scarp soil stripping and talus relaxation.
 const flow=scratch?.flow??new Float64Array(N*4),talus=Math.tan(c.repose*Math.PI/180),stripSlope=talus*.52;
 for(let i=0;i<N;i++){const x=i%n,z=(i/n)|0,j=i*4,h=out[j]+out[j+1],bed=out[j],soil=out[j+1];let e0=0,e1=0,e2=0,e3=0;
  for(let k=0;k<4;k++){const xx=x+ox[k],zz=z+oz[k];if(xx<0||xx>=n||zz<0||zz>=n)continue;
   const nb=(zz*n+xx)*4,dist=k<2?effDx:effDz,diff=Math.max(0,h-out[nb]-out[nb+1]),bedDiff=Math.max(0,bed-out[nb]);
   const scarpStrip=Math.min(diff*.24,Math.max(0,bedDiff/dist-stripSlope)*soil*.42);
   const amt=Math.min(diff*.24,diff*c.creep+scarpStrip+Math.max(0,diff-talus*dist)*.20);
   if(k===0)e0=amt;else if(k===1)e1=amt;else if(k===2)e2=amt;else e3=amt;
  }
  const total=e0+e1+e2+e3,factor=total>0?Math.min(1,soil/total):0;
  flow[j]=e0*factor;flow[j+1]=e1*factor;flow[j+2]=e2*factor;flow[j+3]=e3*factor;
 }
 const res=new Float32Array(N*4);
 for(let i=0;i<N;i++){const x=i%n,z=(i/n)|0,j=i*4;
  res[j]=out[j];
  res[j+1]=Math.max(0,out[j+1]+(x?flow[j-3]:0)+(x+1<n?flow[j+4]:0)+(z?flow[j-n*4+3]:0)+(z+1<n?flow[j+n*4+2]:0)-flow[j]-flow[j+1]-flow[j+2]-flow[j+3]);
  res[j+2]=0;res[j+3]=0;
 }
 return res;
}
export function createFormation(input,initial=null){
 const config=formationConfig(input),N=config.resolution**2,cellArea=config.width*config.length/(config.resolution-1)**2;
 const scratch={filled:new Float64Array(N),receiver:new Int32Array(N),rank:new Int32Array(N),seen:new Uint8Array(N),order:new Int32Array(N),heap:new Int32Array(N),distance:new Float64Array(N),area:new Float64Array(N),targets:new Int32Array(N*4),weights:new Float64Array(N*4),dists:new Float64Array(N*4),out:new Float64Array(N*4),load:new Float64Array(N),bankFlow:new Float64Array(N*4),flow:new Float64Array(N*4)};
 let state,steps=0,metrics={cellArea,weathered:0,rockEroded:0,bankCollapsed:0,erodedVolume:0,deposited:0,exportedVolume:0};
 if(initial){
  if(initial.version!==FORMATION_VERSION||formationRecipeKey(initial.config)!==formationRecipeKey(config)||!Number.isSafeInteger(initial.steps)||initial.steps<0||initial.steps>config.iterations)throw Error('Incompatible initial formation state');
  validate({...initial,config:{...config,iterations:initial.steps}});
  state=Float32Array.from(initial.state);steps=initial.steps;
  if(initial.metrics)for(const k of ['weathered','rockEroded','bankCollapsed','erodedVolume','deposited','exportedVolume']){if(!Number.isFinite(initial.metrics[k])||initial.metrics[k]<0)throw Error('Invalid initial formation metrics');metrics[k]=initial.metrics[k];}
 }else state=seedGeology(config);
 return{
  step(){if(steps<config.iterations){state=formationStep(state,config,metrics,scratch);steps++;}return steps;},
  get done(){return steps===config.iterations;},
  snapshot(){return{version:FORMATION_VERSION,config:{...config,iterations:steps},targetIterations:config.iterations,state:Float32Array.from(state),metrics:{...metrics},steps,partial:steps<config.iterations};},
  result(){if(steps!==config.iterations)throw Error('Formation is incomplete');return{version:FORMATION_VERSION,config,state,metrics:{...metrics},steps};}
 };
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
