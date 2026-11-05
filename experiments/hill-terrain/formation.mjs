// Geological preparation only. Neither this solver nor its cache runs in playback.
export const FORMATION_VERSION='hill-geology-11';
const defaults={seed:47,tilesX:32,tilesZ:32,resolution:193,width:8,length:9,iterations:120,relief:3.4,mesa:.68,terrace:.66,spurs:.56,meso:.78,valleys:2.5,apron:.24,tilt:.14,strike:16,fold:.14,bedThickness:.34,hardness:9.2,incision:.068,channelArea:.14,weathering:.00065,transport:.12,creep:.014,repose:34,bankFailure:1,bankRepose:54};
export const FORMATION_FIELDS=[
 {key:'seed',group:'Epoch & Seed',title:'Territory seed',min:1,max:999,step:1,unit:'id',default:defaults.seed,tooltip:'Reorganizes the local landform: rotates rock bedding strike azimuths, relocates caprock benches and gorge breaches, and shifts structural domes (default 47, range 1–999).'},
 {key:'iterations',group:'Epoch & Seed',title:'Formation age · steps',min:0,max:3000,step:20,unit:'steps',default:defaults.iterations,tooltip:'Geological erosion epoch along a non-convergent transient trajectory: 40–80 = youthful canyon rim incision, 100–260 = mature mesas, terraced benches & fans, 600–3000 = skeletal buttes & badlands (default 120).'},
 {key:'relief',group:'Macro Landform',title:'Initial relief',min:.5,max:7,step:.1,unit:'m',default:defaults.relief,tooltip:'Peak elevation of the inherited plateau headland and benches above the receiving basin floor before erosion begins (default 3.4, range 0.5–7.0).'},
 {key:'mesa',group:'Macro Landform',title:'Plateau & mesa cap',min:0,max:1,step:.02,unit:'ratio',default:defaults.mesa,tooltip:'Blends between peaked ridge combs (0.0) and flat-topped caprock tablelands, outlier benches, and steep-walled box gorges (0.6–1.0, default 0.68).'},
 {key:'terrace',group:'Macro Landform',title:'Structural terracing',min:0,max:1,step:.02,unit:'ratio',default:defaults.terrace,tooltip:'Carves stair-stepped structural rock benches and cliff risers across gorge walls and headland flanks at bed-thickness intervals (default 0.66, range 0.0–1.0).'},
 {key:'spurs',group:'Macro Landform',title:'Dendritic spur dissection',min:0,max:1,step:.02,unit:'ratio',default:defaults.spurs,tooltip:'Bridges smooth box-canyon mesa blocks (0.0) and deeply ribbed buttress spurs, scalloped rim alcoves, and branching side-couloir chutes along cliff walls (default 0.56, range 0.0–1.0).'},
 {key:'valleys',group:'Macro Landform',title:'Major canyon systems',min:1,max:12,step:.5,unit:'basins',default:defaults.valleys,tooltip:'Number of primary gorge breaches and dividing headland blocks across the grounded play stage (default 2.5 for intimate local scale, range 1–12).'},
 {key:'apron',group:'Macro Landform',title:'Receiving apron',min:.10,max:.55,step:.02,unit:'ratio',default:defaults.apron,tooltip:'Fraction of the foreland domain graded into a low-slope piedmont apron where coalescing alluvial fans deposit (default 0.24, range 0.10–0.55).'},
 {key:'tilt',group:'Rock Bedding',title:'Rock-bed tilt',min:-1.5,max:1.5,step:.05,unit:'slope',default:defaults.tilt,tooltip:'Dip slope (rise/run) of 3D rock strata. Near-zero values (0.0–0.2) form horizontal mesa caps and level terrace benches; high values (0.7–1.2) carve tilted cuesta hogbacks (default 0.14).'},
 {key:'strike',group:'Rock Bedding',title:'Bed strike angle',min:-90,max:90,step:2,unit:'deg',default:defaults.strike,tooltip:'Horizontal compass rotation of rock strata and hogback strike ridges across the stage in degrees (default 16°, range -90° to 90°).'},
 {key:'fold',group:'Rock Bedding',title:'Rock-bed folding',min:0,max:.8,step:.02,unit:'m',default:defaults.fold,tooltip:'Amplitude of synclinal/anticlinal wave folding in the 3D rock strata (default 0.14, range 0.0–0.8).'},
 {key:'bedThickness',group:'Rock Bedding',title:'Rock-bed thickness',min:.10,max:1.0,step:.02,unit:'m',default:defaults.bedThickness,tooltip:'Vertical height of each alternating hard caprock cliff unit and recessive shale interbed step (default 0.34, range 0.10–1.0).'},
 {key:'hardness',group:'Rock Bedding',title:'Bed resistance contrast',min:0,max:15,step:.2,unit:'×',default:defaults.hardness,tooltip:'Strength multiplier of hard caprock ledges vs. soft interbeds. High values (8–14) hold sharp overhanging mesa rims, stepped terrace treads, and hogback fins (default 9.2, range 0–15).'},
 {key:'meso',group:'Erosion & Weathering',title:'Meso 3D ledge, scree & wash detail',min:0,max:1,step:.02,unit:'ratio',default:defaults.meso,tooltip:'Controls 3D overhanging rock-ledge displacement, blocky sandstone joint steps, discrete talus cobbles at cliff toes, and shallow braided washes at arbitrary zoom (default 0.78, range 0.0–1.0).'},
 {key:'channelArea',group:'Erosion & Weathering',title:'Channel source area',min:.02,max:1.0,step:.02,unit:'m²',default:defaults.channelArea,tooltip:'Minimum upstream catchment area before surface runoff incises bedrock channels; lower values branch finer tributary couloirs (default 0.14, range 0.02–1.0).'},
 {key:'incision',group:'Erosion & Weathering',title:'Stream incision',min:0,max:.20,step:.005,unit:'rate',default:defaults.incision,tooltip:'Fluvial bedrock cutting power per formation step in active gorge and stream channels (default 0.068, range 0.0–0.20).'},
 {key:'weathering',group:'Erosion & Weathering',title:'Weathering rate',min:0,max:.004,step:.0001,unit:'m/step',default:defaults.weathering,tooltip:'Peak conversion rate of recessive bedrock into loose soil before regolith insulation shuts it off (default 0.00065, range 0.0–0.004).'}
];
const mesoDefaults={meso:defaults.meso,ledge:1,crag:1,cobble:1,rill:1};
export const MESO_AUTHORING_FIELDS=[
 {key:'meso',group:'Meso & Micro (Live GPU)',title:'Meso/micro master scale',min:0,max:1.6,step:.02,unit:'×',default:mesoDefaults.meso,tooltip:'Live GPU master gain (<0.3ms, zero worker rebuild) for all sub-cell 3D overhanging rock shelves, craggy fracture blocks, talus cobbles, and erosional gullies (default 0.78).'},
 {key:'ledge',group:'Meso & Micro (Live GPU)',title:'3D shelf & undercut relief',min:0,max:2,step:.05,unit:'×',default:mesoDefaults.ledge,tooltip:'Live GPU geometric scale for discontinuous 3D rock shelves, overhanging rims, and recessed undercuts where bedrock is exposed (default 1.0, range 0.0–2.0).'},
 {key:'crag',group:'Meso & Micro (Live GPU)',title:'3D buttress & fracture clefts',min:0,max:2,step:.05,unit:'×',default:mesoDefaults.crag,tooltip:'Live GPU geometric scale for anisotropic 3D rock buttress ribs, tor blocks, and conjugate vertical fracture clefts on scarps and outcrops (default 1.0, range 0.0–2.0).'},
 {key:'cobble',group:'Meso & Micro (Live GPU)',title:'3D talus boulders & scree',min:0,max:2,step:.05,unit:'×',default:mesoDefaults.cobble,tooltip:'Live GPU scale for 3D paraboloid-domed Voronoi talus boulders, scree cobbles, and gravel clasts resting on toe slopes and benches (default 1.0, range 0.0–2.0).'},
 {key:'rill',group:'Meso & Micro (Live GPU)',title:'Outcrop & gully rill carving',min:0,max:2,step:.05,unit:'×',default:mesoDefaults.rill,tooltip:'Live GPU morphological control: 0.0 = smooth intact turf hillslopes; 1.0–2.0 = carves branched downslope erosion rills, stony washes, and emergent rock tors while keeping constitutive micro-grain crisp at all settings.'}
];
export const VIEW_MODES=[
 {id:'authored',index:0,title:'Full authored terrain (Sim + 3D Lithology + Meso)',description:'Full 3-layer stack: 193×193 simulated [bedrock, soil] dynamics + 3D laterally-pinching lithology + live GPU sub-centimeter 3D ledges, crags, tors, and talus cobbles.'},
 {id:'simulated',index:1,title:'Pure simulated dynamics (193×193 [bedrock, soil] only)',description:'Zero 3D noise, zero strata shelves, and zero procedural meso/micro displacement. Shows only the raw simulated fluvial incision, hillslope creep, bank collapse, and regolith transport state.'},
 {id:'structural',index:2,title:'Simulated + 3D structural ledges (no crags/cobbles)',description:'Shows the simulated [bedrock, soil] surface plus clean 3D dipping/folded and laterally-pinching rock shelves, isolating structural geology from crag/cobble synthesis.'},
 {id:'provenance',index:3,title:'Provenance attribution map (R=Sim Rock, G=Sim Soil, B=Live 3D GPU)',description:'Color-codes feature provenance: Red/Amber = simulated bedrock incision & cliff scarps, Green = simulated regolith/hillslope soil depth, Cyan/Blue = live GPU 3D meso/micro displacement.'}
];
export function mesoAuthoringConfig(input={}){
 const c=Object.fromEntries(Object.keys(mesoDefaults).map(k=>[k,input[k]??mesoDefaults[k]]));
 for(const f of MESO_AUTHORING_FIELDS){
  const v=c[f.key];
  if(!Number.isFinite(v)||v<f.min||v>f.max)throw Error(`Meso authoring ${f.key} must be in ${f.min}..${f.max}`);
 }
 return c;
}
export const FORMATION_PRESETS=[
 {id:'canyon-mesas',title:'Grounded Mesa Headland & Box Gorge (Default)',description:'Intimate play-scale caprock mesa headland and stepped rock benches cut by a primary gorge breach, discontinuous 3D sandstone ledges, talus cobbles, and a green valley apron.',patch:{seed:47,iterations:120,relief:3.4,mesa:.68,terrace:.66,spurs:.56,meso:.78,valleys:2.5,apron:.24,tilt:.14,strike:16,fold:.14,bedThickness:.34,hardness:9.2,channelArea:.14,incision:.068,weathering:.00065,creep:.014}},
 {id:'rolling-crag-hills',title:'Verdant Crag Hills & Stream Hollows (120 steps)',description:'Soil-mantled rolling green hills with convex grassy crowns, saddle divides, winding dendritic stream hollows, and emergent rocky summit tors and boulder scree.',patch:{seed:19,iterations:120,relief:2.7,mesa:0,terrace:.08,spurs:.28,meso:.82,valleys:3.5,apron:.22,tilt:.18,strike:-28,fold:.26,bedThickness:.42,hardness:5.4,channelArea:1.10,incision:.052,weathering:.0022,creep:.012}},
 {id:'cuesta-hogbacks',title:'Tilted Cuesta Hogbacks & Water Gap (160 steps)',description:'Steeply dipping monocline strata (tilt 0.95, strike 34°) carved into asymmetric strike hogback fins, dip slopes, and a diagonal water gap.',patch:{seed:344,iterations:160,relief:3.5,mesa:.08,terrace:.22,spurs:.62,meso:.78,valleys:2.5,apron:.24,tilt:.95,strike:34,fold:.18,bedThickness:.38,hardness:11.5,channelArea:.14,incision:.068,weathering:.00075,creep:.014}},
 {id:'range-bajada',title:'Craggy Mountain Amphitheater & Bajada (160 steps)',description:'High sculpted mountain ridge and alpine cirque couloirs without flat caprock, shedding boulder talus fans into a green valley basin.',patch:{seed:862,iterations:160,relief:3.8,mesa:0,terrace:0,spurs:.82,meso:.76,valleys:3,apron:.28,tilt:.36,strike:-20,fold:.24,bedThickness:.34,hardness:4.8,channelArea:.14,incision:.066,weathering:.00080,creep:.014}},
 {id:'pastoral-hill-tors',title:'Weathered Hillslopes, Outcrop Tors & Dell (140 steps)',description:'Softly rounded soil-mantled hillslopes and a central winding stream dell punctuated by weathered granite/limestone tor outcrops and mossy scree.',patch:{seed:512,iterations:140,relief:2.3,mesa:.04,terrace:.10,spurs:.20,meso:.76,valleys:2.5,apron:.26,tilt:-.20,strike:22,fold:.30,bedThickness:.46,hardness:6.0,channelArea:1.20,incision:.048,weathering:.0024,creep:.014}},
 {id:'stepped-terraces',title:'Grand Staircase Rock Benches (160 steps)',description:'Broad multi-tiered structural sandstone benches and outlier buttes separated by overhanging cliff risers stepping down to the valley floor.',patch:{seed:184,iterations:160,relief:3.4,mesa:.64,terrace:.88,spurs:.40,meso:.80,valleys:2,apron:.22,tilt:.08,strike:12,fold:.10,bedThickness:.38,hardness:12.0,channelArea:.16,incision:.062,weathering:.00060,creep:.014}},
 {id:'dissected-mesa-spurs',title:'Fluted Buttress Spurs & Couloir Chutes (160 steps)',description:'Caprock headland carved into deeply fluted buttress spurs, branching couloir chutes, 3D jointed rock steps, and coalescing talus aprons.',patch:{seed:312,iterations:160,relief:3.6,mesa:.56,terrace:.58,spurs:.86,meso:.86,valleys:3,apron:.25,tilt:.20,strike:14,fold:.18,bedThickness:.32,hardness:9.6,channelArea:.10,incision:.074,weathering:.00068,creep:.014}}
];
export function formationConfig(input={}){
 const c=Object.fromEntries(Object.keys(defaults).map(k=>[k,input[k]??defaults[k]]));
 if(!Number.isSafeInteger(c.seed)||c.seed<0||c.seed>0xffffffff)throw Error('Formation seed must be uint32');
 if(!Number.isSafeInteger(c.resolution)||c.resolution<3)throw Error('Formation resolution must be a whole grid >=3');
 if(!Number.isSafeInteger(c.tilesX)||c.tilesX<1||c.tilesX>48||!Number.isSafeInteger(c.tilesZ)||c.tilesZ<1||c.tilesZ>48)throw Error('Formation tile counts must be whole numbers in 1..48');
 if(!Number.isSafeInteger(c.iterations)||c.iterations<0)throw Error('Formation iterations must be nonnegative whole steps');
 if(!Number.isFinite(c.valleys)||c.valleys<1||c.valleys>16)throw Error('Formation valleys must be in 1..16');
 if(!Number.isFinite(c.mesa)||c.mesa<0||c.mesa>1||!Number.isFinite(c.terrace)||c.terrace<0||c.terrace>1)throw Error('Formation mesa and terrace ratios must be in 0..1');
 if(!Number.isFinite(c.spurs)||c.spurs<0||c.spurs>1||!Number.isFinite(c.meso)||c.meso<0||c.meso>1)throw Error('Formation spurs and meso ratios must be in 0..1');
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
function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v;}
function smoothstep(e0,e1,x){const t=clamp((x-e0)/Math.max(1e-6,e1-e0),0,1);return t*t*(3-2*t);}
export function rockResistance(x,y,z,c){
 const rad=(c.strike??0)*Math.PI/180,ca=Math.cos(rad),sa=Math.sin(rad),rx=x*ca+z*sa,rz=-x*sa+z*ca;
 const dipScale=1-.78*clamp(c.mesa??0,0,1)*clamp(c.terrace??0,0,1);
 const warp=.28*Math.sin(rx*.55+rz*.35+c.seed*.03)+.16*Math.cos(rz*.85-rx*.45);
 const phase=(y-dipScale*c.tilt*rx-dipScale*c.fold*(Math.sin(rz*.7+rx*.2)+warp)+c.seed*.017)/c.bedThickness;
 const frac=phase-Math.floor(phase),sineBand=Math.max(0,.5+.5*Math.sin(phase*Math.PI*2)+.22*Math.sin(phase*Math.PI*1.236+.9));
 const subLedge=.5+.5*Math.sin(phase*Math.PI*6);
 const benchCap=smoothstep(.22,.42,frac)*(1-.35*smoothstep(.92,1,frac));
 const lens=.62+.38*Math.sin(rx*1.15-rz*.65+c.seed*.11)*Math.cos(rz*1.05+rx*.45-c.seed*.07);
 const tMix=.65*clamp(c.terrace??0,0,1),mesoMix=clamp(c.meso??0,0,1);
 const band=clamp(((1-tMix)*sineBand*lens+tMix*benchCap)+.18*mesoMix*(subLedge-.5),0,1),b2=band*band;
 return 1+c.hardness*(b2*b2);
}
export function seedGeology(input){
 const c=formationConfig(input),n=c.resolution,s=new Float32Array(n*n*4);
 const mesaMix=clamp(c.mesa,0,1),terraceMix=clamp(c.terrace,0,1),spurMix=clamp(c.spurs??.58,0,1),mesoMix=clamp(c.meso??.72,0,1);
 const stepStyle=clamp(.65*mesaMix+.65*terraceMix,0,1);
 const hillMix=clamp((1-stepStyle*1.4)*(1-smoothstep(.32,.68,spurMix))*(1-smoothstep(.45,.85,Math.abs(c.tilt))),0,1);
 const strikeRad=(c.strike??0)*Math.PI/180,sca=Math.cos(strikeRad),ssa=Math.sin(strikeRad);
 const dipScale=1-.88*stepStyle;
 // Seeded winding trunk canyons and oblique tributary branches (eliminates parallel sine-grating stripes).
 const numCanyons=Math.max(2,Math.min(9,Math.round(c.valleys*.75)));
 const canyons=[];
 for(let m=0;m<numCanyons;m++){
  const slot=(m+.18+.64*hash(m*11+3,7,c.seed))/numCanyons;
  const x0=clamp(.08+.84*((slot+hash(3,17,c.seed))%1),.08,.92);
  const x1=clamp(x0+(hash(m*13+5,19,c.seed)-.5)*.62,.10,.90);
  const amp=.07+.09*hash(m*17+7,29,c.seed),freq=1.5+1.3*hash(m*23+9,37,c.seed),phase=hash(m*31+13,41,c.seed)*Math.PI*2;
  const width=(.048+.028*hash(m*43+17,53,c.seed))*(4.8/Math.max(2.5,c.valleys));
  const b1v=.18+.22*hash(m*53+19,61,c.seed),b1dir=hash(m*59+23,67,c.seed)>.5?1:-1,b1len=.16+.14*hash(m*67+29,71,c.seed),b1slope=(hash(m*71+31,73,c.seed)-.35)*.8;
  const b2v=.42+.22*hash(m*79+37,79,c.seed),b2dir=-b1dir,b2len=.14+.14*hash(m*83+41,83,c.seed),b2slope=(hash(m*89+43,89,c.seed)-.35)*.8;
  canyons.push({x0,x1,amp,freq,phase,width,b1v,b1dir,b1len,b1slope,b2v,b2dir,b2len,b2slope});
 }
 // Seeded tectonic mesa plates and isolated outlier buttes across the territory.
 // Discrete cap elevations (tIdx + 0.65) / tierCount place every plateau and bench top
 // at frac = 0.65 (center of the flat tread) so plateau tops never cross tier boundaries.
 const topTier=2+Math.round(1.2*terraceMix),tierCount=topTier+.65;
 const plates=[];
 for(let p=0;p<6;p++){
  const px=.10+.80*hash(p*19+3,101,c.seed),pz=.10+.56*hash(p*29+7,107,c.seed);
  const rx=.16+.20*hash(p*37+11,113,c.seed),rz=.14+.18*hash(p*47+13,127,c.seed);
  const ang=(hash(p*53+17,131,c.seed)-.5)*Math.PI,ca=Math.cos(ang),sa=Math.sin(ang);
  const rawH=(.52+.46*Math.max(0,1-pz*1.05))*(.78+.22*hash(p*61+19,137,c.seed));
  const tIdx=Math.min(topTier,Math.max(1,Math.round(rawH*topTier)));
  const h=(tIdx+.65)/tierCount;
  plates.push({px,pz,rx,rz,ca,sa,h});
 }
 const segDist=(px,pz,ax,az,bx,bz)=>{
  const dx=bx-ax,dz=bz-az,t=clamp(((px-ax)*dx+(pz-az)*dz)/Math.max(1e-6,dx*dx+dz*dz),0,1);
  return Math.hypot(px-ax-t*dx,pz-az-t*dz);
 };
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const u=x/(n-1),v=z/(n-1);
  const wx=u+.15*fbm(u*2.6+1.3,v*2.6+.7,c.seed+19,4),wz=v+.15*fbm(u*2.6-.9,v*2.6+2.1,c.seed+43,4);
  const texture=fbm(wx*3.8,wz*3.8,c.seed+5,5),smoothTex=fbm(u*2.1+3.1,v*2.1+1.7,c.seed+33,3);
  const su=u+.06*smoothTex,sv=v+.06*fbm(u*2.1+.9,v*2.1+2.3,c.seed+59,2);
  let dMin=99,nearestFloor=.05;
  for(let m=0;m<numCanyons;m++){
   const cy=canyons[m],tv=clamp(wz/.78,0,1),cx=cy.x0+(cy.x1-cy.x0)*tv+cy.amp*Math.sin(wz*Math.PI*cy.freq+cy.phase);
   const dTrunk=Math.abs(wx-cx)/cy.width;
   const b1x=cy.x0+(cy.x1-cy.x0)*cy.b1v+cy.amp*Math.sin(cy.b1v*Math.PI*cy.freq+cy.phase);
   const dB1=segDist(wx,wz,b1x,cy.b1v,b1x+cy.b1dir*cy.b1len,cy.b1v+cy.b1slope*cy.b1len)/(cy.width*.78);
   const b2x=cy.x0+(cy.x1-cy.x0)*cy.b2v+cy.amp*Math.sin(cy.b2v*Math.PI*cy.freq+cy.phase);
   const dB2=segDist(wx,wz,b2x,cy.b2v,b2x+cy.b2dir*cy.b2len,cy.b2v+cy.b2slope*cy.b2len)/(cy.width*.78);
   const d=Math.min(dTrunk,dB1,dB2);
   if(d<dMin){dMin=d;nearestFloor=.05+.09*Math.max(0,1-tv);}
  }
  const frontShift=c.apron>0?Math.min(c.apron*.26,.042)*(smoothstep(.8,2.2,dMin)-.5+.4*smoothTex):0;
  const localApron=clamp(c.apron+frontShift,0,.90);
  const upland=clamp((1-v-localApron)/Math.max(1e-4,1-localApron),0,1);
  // Tectonic plateau & isolated outlier butte envelope: monotonically additive (Math.max)
  // with flat interior caps so lower plates never gouge rings into the upper caprock tableland.
  let plateEnv=smoothstep(.10,.46,upland),hillDom=0,torBoss=0;
  for(let p=0;p<6;p++){
   const pl=plates[p],dx=su-pl.px,dz=sv-pl.pz,rx=(dx*pl.ca+dz*pl.sa)/pl.rx,rz=(-dx*pl.sa+dz*pl.ca)/pl.rz;
   const r2=rx*rx+rz*rz,w=smoothstep(1.28,.48,r2);
   plateEnv=Math.max(plateEnv,w*pl.h);
   if(hillMix>0){
    const hr2=r2*.46,hd=Math.exp(-.86*hr2)*pl.h;
    hillDom=Math.max(hillDom,hd+.28*Math.min(hillDom,hd));
    const tr2=r2*3.1;
    if(tr2<1.25&&p%2===0)torBoss=Math.max(torBoss,smoothstep(1.15,.12,tr2)*(.55+.45*hash(p*41+9,149,c.seed)));
   }
  }
  const xw=(u-.5)*c.width,zw=(v-.5)*c.length,rx=xw*sca+zw*ssa,rz=-xw*ssa+zw*sca;
  // Hybrid dendritic spur-and-chute dissection along canyon walls & mesa flanks:
  // Ribs vary along the canyon wall (sAlong) and run continuously downslope (dMin),
  // bifurcating on lower slopes without creating 2D egg-carton cone spikes.
  const wallZone=smoothstep(.08,.40,dMin)*(1-smoothstep(.68,1.12,dMin))*smoothstep(.04,.18,upland);
  const sAlong=(wz*1.15+.38*wx)*Math.max(4.2,c.valleys*.95)*Math.PI+1.8*smoothTex+c.seed*.31;
  const primarySpur=1-2*Math.abs(Math.sin(sAlong+dMin*1.25));
  const branchSpur=(1-2*Math.abs(Math.sin(sAlong*2-dMin*1.9+.9)))*smoothstep(1.05,.20,dMin);
  const fineSpur=(1-2*Math.abs(Math.sin(sAlong*3.4+dMin*2.8+1.7)))*smoothstep(.95,.18,dMin);
  const spurProfile=.52*primarySpur+.30*branchSpur+.18*fineSpur;
  const dDissected=Math.max(0,dMin+spurMix*wallZone*.62*spurProfile);
  const spurRibs=spurMix*wallZone*.34*spurProfile;
  // 1) Peaked ridge, anticlinal fold, cuesta hogback & rolling hill morphology (when mesa/terrace low)
  const strikeWave=.5+.5*Math.cos((rx*1.35+.25*Math.sin(rz*.8))*Math.PI*Math.max(1.5,c.valleys*.5)+c.seed*.13);
  const canyonRidge=smoothstep(.15,2.1,dDissected)**1.25;
  const env=Math.sin(Math.PI*upland)**1.15;
  const baseRidge=.08+(.56*(upland**1.28)*(.55+.45*plateEnv)+.34*strikeWave*env)*canyonRidge+.36*texture*env+spurRibs;
  const dHill=dMin/(1+1.35*hillMix);
  const hollowCarve=.42+.58*smoothstep(.06,1.15,dHill);
  const hillSide=.28+.72*smoothstep(0,.16,u)*smoothstep(0,.16,1-u)*smoothstep(0,.14,v);
  const broadSwell=.22*(.5+.5*Math.cos((su-.5)*Math.PI*2.1+sv*1.3))*(.5+.5*Math.sin(sv*Math.PI*1.7-su*.9));
  const torOutcrop=hillMix>0?clamp(torBoss+.54*smoothstep(.12,.30,dMin)*(1-smoothstep(.32,.58,dMin))*smoothstep(.30,.64,hillDom),0,1):0;
  const hillNorm=hillMix>0?clamp((.08+(.74*hillDom+broadSwell)*hillSide*hollowCarve+.12*strikeWave*env+.10*smoothTex*env+.09*torOutcrop)*smoothstep(0,.20,upland),0,1.02):0;
  const ridgeNorm=(1-hillMix)*baseRidge+hillMix*hillNorm;
  // 2) Flat-topped caprock mesas, isolated outlier buttes & stair-stepped structural terraces
  const frontEscarp=smoothstep(.02,.20,upland);
  const canyonCarve=smoothstep(.38,1.52,dDissected);
  const wallActive=(1-smoothstep(.88,1,canyonCarve)*smoothstep(.22,.42,upland));
  const blockField=clamp(frontEscarp*plateEnv*(.12+.88*canyonCarve)+wallActive*(.05*smoothTex*(1-.65*mesaMix)+.26*spurRibs*(1-.65*mesaMix)),0,1);
  const scaled=blockField*tierCount,tierIdx=Math.floor(scaled),frac=scaled-tierIdx;
  const riserW=.24-.08*mesaMix;
  const tierStep=frac<riserW?.97*smoothstep(0,riserW,frac):.97+.03*(frac-riserW)/(1-riserW);
  const treadFlat=smoothstep(riserW+.01,riserW+.08,frac)*(1-smoothstep(.93,1,frac))*stepStyle;
  const dipShift=dipScale*c.tilt*rx*.04;
  const treadGrade=.028*upland+.042*smoothstep(.40,.52,upland);
  // 3) Coherent sub-meter meso-relief: stepped horizontal sub-ledges on active cliff walls,
  // secondary side-gully chutes on flanks, and flow-aligned braided fan rills on the apron.
  const riserMask=1-smoothstep(riserW*.95,riserW*1.65,frac);
  const subLedgeStep=riserMask*.26*Math.sin(frac/Math.max(.08,riserW)*Math.PI*6);
  const chuteZone=smoothstep(.04,.32,dMin)*(1-smoothstep(.88,1.52,dMin))*smoothstep(.04,.18,upland);
  const sideChute=chuteZone*(.28*branchSpur+.22*fineSpur);
  const uFan=(wx-.5)/(.65+.55*v)+.14*Math.sin(wz*2.6*Math.PI+c.seed*.17)+.10*smoothTex;
  const rillBraid=.62*Math.sin(uFan*14*Math.PI)+.38*Math.cos(uFan*26*Math.PI-wz*3.0*Math.PI);
  const apronMask=.32*(1-smoothstep(.06,.26,upland))+.42*(1-canyonCarve)*smoothstep(.04,.22,upland);
  const apronRill=apronMask*.034*rillBraid;
  const topCapFlat=(tierIdx>=topTier?1:0)*smoothstep(.76,.94,canyonCarve)*smoothstep(.22,.40,upland);
  const mesoDelta=mesoMix*(1-topCapFlat)*((1-treadFlat)*subLedgeStep+sideChute)+mesoMix*apronRill;
  const mesaNorm=clamp(nearestFloor*(1-canyonCarve)+(tierIdx+tierStep)/tierCount*.86+treadGrade+dipShift+.68*spurRibs*(1-treadFlat)*wallActive,0,1.05);
  const y0=Math.max(0,c.relief*((1-stepStyle)*ridgeNorm+stepStyle*mesaNorm+mesoDelta*(1-.55*hillMix)));
  const apronGrade=.002*(1-v)+Math.max(0,mesoMix*(1-upland)*.004*rillBraid);
  s[(z*n+x)*4]=.10+apronGrade+y0*smoothstep(0,.04,upland);
  const screeSeed=mesoMix*wallZone*.006*Math.max(0,branchSpur);
  const baseSoil=(upland>.15?.016*(1-.35*stepStyle):.022+.032*(1-stepStyle)*(1-smoothstep(0,.12,upland)))+screeSeed;
  const hillMantle=upland>.12?(.092*(1-smoothstep(.38,.64,torOutcrop))+.006*smoothstep(.38,.64,torOutcrop)):.058;
  s[(z*n+x)*4+1]=(1-hillMix)*baseSoil+hillMix*hillMantle;
 }
 return s;
}
const ox=[-1,1,0,0,-1,1,-1,1],oz=[0,0,-1,1,-1,-1,1,1];
// Priority-flood gives depressions a spill route without changing bedrock. The
// strict flood rank makes the multi-receiver graph acyclic across all stitched tiles.
export function drainage(state,input,scratch=null){
 const c=formationConfig(input),n=c.resolution,N=n*n;
 const filled=scratch?.filled??new Float64Array(N),receiver=scratch?.receiver??new Int32Array(N),floodParent=scratch?.floodParent??new Int32Array(N),rank=scratch?.rank??new Int32Array(N),seen=scratch?.seen??new Uint8Array(N),order=scratch?.order??new Int32Array(N),heap=scratch?.heap??new Int32Array(N);
 const distance=scratch?.distance??new Float64Array(N),area=scratch?.area??new Float64Array(N),targets=scratch?.targets??new Int32Array(N*4),weights=scratch?.weights??new Float64Array(N*4),dists=scratch?.dists??new Float64Array(N*4);
 const stride=n>=97?20:1;
 if(scratch?.hasFlood&&scratch.stepCount%stride!==0){
  scratch.stepCount++;
  return{receiver,order,area,distance,filled,outletArea:scratch.outletArea,targets,weights,dists};
 }
 targets.fill(-1);weights.fill(0);dists.fill(0);
 receiver.fill(-1);floodParent.fill(-1);seen.fill(0);
 let hLen=0,count=0;
 const before=(a,b)=>filled[a]<filled[b]||(filled[a]===filled[b]&&a<b);
 const push=i=>{let k=hLen++;heap[k]=i;while(k>0){const p=(k-1)>>1,hk=heap[k],hp=heap[p];if(!before(hk,hp))break;heap[k]=hp;heap[p]=hk;k=p;}};
 const pop=()=>{const a=heap[0],tail=heap[--hLen];if(hLen>0){heap[0]=tail;let k=0;while((k<<1)+1<hLen){let j=(k<<1)+1;if(j+1<hLen&&before(heap[j+1],heap[j]))j++;if(!before(heap[j],tail))break;heap[k]=heap[j];k=j;}heap[k]=tail;}return a;};
 const outletSpan=c.tilesX>1?.42:.24;
 for(let x=0;x<n;x++){if(Math.abs(x/(n-1)-.5)>outletSpan)continue;const i=(n-1)*n+x;seen[i]=1;filled[i]=state[i*4]+state[i*4+1];push(i);}
 while(hLen>0){const i=pop(),x=i%n,z=(i/n)|0;rank[i]=count;order[count++]=i;
  for(let k=0;k<8;k++){const xx=x+ox[k],zz=z+oz[k];if(xx<0||xx>=n||zz<0||zz>=n)continue;const j=zz*n+xx;if(seen[j])continue;seen[j]=1;const hj=state[j*4]+state[j*4+1];filled[j]=hj>filled[i]?hj:filled[i];receiver[j]=i;floodParent[j]=i;push(j);}
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
   const w0=s0*s0,w1=t1>=0?s1*s1:0,sum=w0+w1;
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
 if(scratch){scratch.hasFlood=true;scratch.outletArea=outletArea;scratch.stepCount=(scratch.stepCount??0)+1;}
 return{receiver,order,area,distance,filled,outletArea,targets,weights,dists};
}
export function formationStep(state,input,metrics,scratch=null){
 const c=formationConfig(input),n=c.resolution,N=n*n,dx=c.width/(n-1),dz=c.length/(n-1),cell=dx*dz;
 const domainScale=Math.max(1,Math.hypot(c.width,c.length)/Math.hypot(8,9)),effDx=dx/domainScale,effDz=dz/domainScale,effCell=effDx*effDz,areaScale=1/(domainScale*domainScale);
 const out=scratch?.out??new Float64Array(N*4);for(let i=0;i<N*4;i+=4){out[i]=state[i];out[i+1]=state[i+1];}
 const load=scratch?.load??new Float64Array(N);load.fill(0);
 const d=drainage(state,c,scratch);
 const mesoMix=clamp(c.meso??.72,0,1);
 let bedShift=scratch?.bedShift,mesoMod=scratch?.mesoMod;
 if(!bedShift||!mesoMod){
  bedShift=new Float64Array(N);mesoMod=new Float64Array(N);
  if(scratch){scratch.bedShift=bedShift;scratch.mesoMod=mesoMod;}
  const rad=(c.strike??0)*Math.PI/180,ca=Math.cos(rad),sa=Math.sin(rad),dipScale=1-.78*clamp(c.mesa??0,0,1)*clamp(c.terrace??0,0,1),invT=1/c.bedThickness;
  for(let i=0;i<N;i++){
   const u=(i%n)/(n-1),v=((i/n)|0)/(n-1),x=(u-.5)*c.width,z=(v-.5)*c.length,rx=x*ca+z*sa,rz=-x*sa+z*ca;
   const warp=.28*Math.sin(rx*.55+rz*.35+c.seed*.03)+.16*Math.cos(rz*.85-rx*.45);
   bedShift[i]=(-dipScale*c.tilt*rx-dipScale*c.fold*(Math.sin(rz*.7+rx*.2)+warp)+c.seed*.017)*invT;
   // Flow-aligned meso-chute & braided rill modulation (continuous along slope, never a 2D cone grid)
   const uFan=(u-.5)/(.70+.50*v)+.14*Math.sin(v*2.1*Math.PI+c.seed*.17)+.08*Math.cos(v*3.7*Math.PI-u*2.4*Math.PI);
   const r1=.62*Math.sin(uFan*7.5*Math.PI)+.38*Math.cos(uFan*13.5*Math.PI+.45*Math.sin(v*2.8*Math.PI));
   const c1=.58*Math.sin((uFan*5.2+.28*v)*Math.PI+c.seed*.31)+.42*Math.cos((uFan*9.4-.22*v)*Math.PI);
   const upW=smoothstep(.82,.58,v);
   mesoMod[i]=(1-.45*upW)*r1+.45*upW*c1;
  }
 }
 const invBedT=1/c.bedThickness,tMix=.65*clamp(c.terrace??0,0,1);
 let stratLut=scratch?.stratLut;
 if(!stratLut){
  stratLut=new Float64Array(4096);
  for(let k=0;k<4096;k++){
   const frac=k/4096,sineBand=Math.max(0,.5+.5*Math.sin(frac*Math.PI*2)),subLedge=.5+.5*Math.sin(frac*Math.PI*6);
   const benchCap=smoothstep(.22,.42,frac)*(1-.35*smoothstep(.92,1,frac));
   stratLut[k]=(1-tMix)*sineBand+tMix*benchCap+.18*mesoMix*(subLedge-.5);
  }
  if(scratch)scratch.stratLut=stratLut;
 }
 const cellStrength=(i,y)=>{
  const phase=y*invBedT+bedShift[i],frac=phase-Math.floor(phase);
  const band=clamp(stratLut[(frac*4096)|0]+.22*mesoMix*mesoMod[i],0,1),b2=band*band;
  return Math.max(.35,1+c.hardness*(b2*b2));
 };
 const stepStyle=clamp(.65*clamp(c.mesa,0,1)+.65*clamp(c.terrace,0,1),0,1);
 const hillMix=clamp((1-stepStyle*1.4)*(1-smoothstep(.32,.68,clamp(c.spurs??.58,0,1)))*(1-smoothstep(.45,.85,Math.abs(c.tilt))),0,1);
 const insulDepth=.062+.045*hillMix;
 // Humped regolith weathering: bare rock cliffs weather slowly, moist thin cover
 // peaks around 0.018, and regolith cover >= insulDepth insulates underlying bedrock.
 for(let i=0;i<N;i++){
  const soil=out[i*4+1],insul=Math.max(0,1-soil/insulDepth);
  if(insul<=0)continue;
  const rawStr=cellStrength(i,out[i*4]);
  const strength=hillMix>0&&soil>.028?1+(rawStr-1)*(1-.75*hillMix):rawStr;
  const jointWeather=Math.max(.25,1-.48*mesoMix*mesoMod[i]*(1-.6*hillMix));
  const hump=(.18+.82*Math.min(1,soil/.018))*(insul*insul),w=c.weathering*hump*jointWeather/strength;
  out[i*4]-=w;out[i*4+1]+=w;metrics.weathered+=w*cell;
 }
 const capBoost=Math.max(c.mesa??0,c.terrace??0),capHard=capBoost*Math.min(1,c.hardness/4),resScale=Math.max(1,(n-1)/64),minChBase=c.channelArea*.45;
 for(let k=N-1;k>=0;k--){const i=d.order[k];let sediment=load[i];const r=d.receiver[i];if(r<0){metrics.exportedVolume+=sediment;continue;}
  const areaScaled=d.area[i]*areaScale;if(sediment===0&&areaScaled<=minChBase)continue;
  const j=i*4,distEff=d.distance[i]/domainScale,h=out[j]+out[j+1],down=out[r*4]+out[r*4+1],slope=Math.max(0,(h-down)/distEff);
  const sRamp=slope<=.18?0:slope>=.55?1:((slope-.18)/.37);
  const localChArea=c.channelArea*Math.max(.45,1-.28*mesoMix*(sRamp*sRamp*(3-2*sRamp))*mesoMod[i]);
  const rawArea=areaScaled-localChArea;if(sediment===0&&rawArea<=0)continue;
  const stream=rawArea>0?Math.sqrt(rawArea):0;
  const z=(i/n)|0,v=z/(n-1),apronWeight=Math.max(0,Math.min(1,(v-(1-c.apron*1.25))/(c.apron*1.25)));
  const rillCapMod=Math.max(.35,1-.36*mesoMix*apronWeight*mesoMod[i]);
  const capacity=c.transport*stream*slope*(domainScale*domainScale)*(1-.48*apronWeight)*rillCapMod;
  if(sediment>capacity){// Deposition steepens the reach and bifurcates across lower apron neighbors.
   const fanReach=distEff*(1+apronWeight*(.55/Math.max(1e-4,effCell)));
   const rawDep=Math.min((sediment-capacity)/cell,(sediment-capacity)/(cell*(1+c.transport*stream/(effCell*fanReach*resScale))));
   const stepCap=.45*(1-.72*apronWeight*smoothstep(49,193,n));
   const deposit=Math.min(rawDep,Math.max(0,.56-out[j+1])*stepCap);
   if(apronWeight>.05&&n>=65){
    const x=i%n,selfShare=.28,sideShare=(1-selfShare)*.25*deposit;
    let placed=deposit*selfShare;out[j+1]+=deposit*selfShare;
    for(let k=0;k<4;k++){const xx=x+ox[k],zz=z+oz[k];if(xx>=0&&xx<n&&zz>=0&&zz<n){out[(zz*n+xx)*4+1]+=sideShare;placed+=sideShare;}}
    metrics.deposited+=placed*cell;sediment-=placed*cell;
   }else{
    out[j+1]+=deposit;metrics.deposited+=deposit*cell;sediment-=deposit*cell;
   }
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
   const K=c.incision*stream/distEff;
   const treadArmor=1-.75*capHard*(1-smoothstep(.06,.24,slope));
   const incision=Math.max(0,h-down)*K/(1+K)*treadArmor;
   let need=Math.min(incision,(capacity-sediment)/(cell*(1+c.transport*stream/(effCell*distEff*resScale*resScale)))),soil=Math.min(out[j+1],need);out[j+1]-=soil;need-=soil;
   const baseGuard=Math.min(1,Math.max(0,(out[j]-.14)/.65));
   const rock=(need*baseGuard)/cellStrength(i,out[j]);out[j]-=rock;sediment+=(soil+rock)*cell;metrics.erodedVolume+=(soil+rock)*cell;metrics.rockEroded+=rock*cell;
  }
  if(sediment>0){const t0=d.targets[j],t1=d.targets[j+1],t2=d.targets[j+2],t3=d.targets[j+3];if(t0>=0)load[t0]+=sediment*d.weights[j];if(t1>=0)load[t1]+=sediment*d.weights[j+1];if(t2>=0)load[t2]+=sediment*d.weights[j+2];if(t3>=0)load[t3]+=sediment*d.weights[j+3];}
 }
 // Exposed over-steep rock banks fail locally into loose talus. Transfer from
 // rock to neighboring loose cover conserves volume; buried banks are supported
 // by that cover. The implicit four-neighbor factor bounds each shared transfer.
 const bankFlow=scratch?.bankFlow??new Float64Array(N*4),bankLimit=Math.tan(c.bankRepose*Math.PI/180)*(1+2.2*capHard),baseBankRate=c.bankFailure/(1+4*c.bankFailure)*(1-.68*capHard),limX=bankLimit*effDx,limZ=bankLimit*effDz;
 for(let z=0;z<n;z++){
  const row=z*n;
  for(let x=0;x<n;x++){
   const i=row+x,j=i*4,bed=out[j];let rate=0,b0=0,b1=0,b2=0,b3=0;
   if(x>0){const nb=j-4,ex=bed-out[nb]-out[nb+1]-limX;if(ex>0){rate=baseBankRate/cellStrength(i,bed);b0=Math.min(Math.max(0,.48-out[nb+1])*.22,ex*rate);}}
   if(x+1<n){const nb=j+4,ex=bed-out[nb]-out[nb+1]-limX;if(ex>0){if(rate===0)rate=baseBankRate/cellStrength(i,bed);b1=Math.min(Math.max(0,.48-out[nb+1])*.22,ex*rate);}}
   if(z>0){const nb=j-n*4,ex=bed-out[nb]-out[nb+1]-limZ;if(ex>0){if(rate===0)rate=baseBankRate/cellStrength(i,bed);b2=Math.min(Math.max(0,.48-out[nb+1])*.22,ex*rate);}}
   if(z+1<n){const nb=j+n*4,ex=bed-out[nb]-out[nb+1]-limZ;if(ex>0){if(rate===0)rate=baseBankRate/cellStrength(i,bed);b3=Math.min(Math.max(0,.48-out[nb+1])*.22,ex*rate);}}
   bankFlow[j]=b0;bankFlow[j+1]=b1;bankFlow[j+2]=b2;bankFlow[j+3]=b3;
  }
 }
 let bankLossSum=0;
 for(let z=0;z<n;z++){
  const row=z*n;
  for(let x=0;x<n;x++){
   const j=(row+x)*4,loss=bankFlow[j]+bankFlow[j+1]+bankFlow[j+2]+bankFlow[j+3];out[j]-=loss;bankLossSum+=loss;
   out[j+1]+=(x?bankFlow[j-3]:0)+(x+1<n?bankFlow[j+4]:0)+(z?bankFlow[j-n*4+3]:0)+(z+1<n?bankFlow[j+n*4+2]:0);
  }
 }
 metrics.bankCollapsed=(metrics.bankCollapsed??0)+bankLossSum*cell;
 // Conservative downslope creep, steep-scarp soil stripping and talus relaxation.
 const flow=scratch?.flow??new Float64Array(N*4),talus=Math.tan(c.repose*Math.PI/180),stripSlope=talus*(.52+.85*hillMix);
 const creepRate=c.creep*(1-.68*mesoMix*(1-.8*hillMix)),stripGain=.42*(1-.75*hillMix),talusModScale=.52*mesoMix*(1-hillMix);
 for(let z=0;z<n;z++){
  const v=z/(n-1),uplandTalus=smoothstep(.82,.58,v)*talusModScale,apronSpread=smoothstep(.68,.86,v);
  const baseTalus=talus*(1-.78*apronSpread),localCreep=creepRate+.15*apronSpread,row=z*n;
  for(let x=0;x<n;x++){
   const i=row+x,j=i*4,soil=out[j+1];
   if(soil<=1e-9){flow[j]=0;flow[j+1]=0;flow[j+2]=0;flow[j+3]=0;continue;}
   const h=out[j]+soil,bed=out[j],localTalus=baseTalus*Math.max(.50,1+uplandTalus*mesoMod[i]);
   let e0=0,e1=0,e2=0,e3=0;
   if(x>0){const nb=j-4,diff=h-out[nb]-out[nb+1];if(diff>0){const room=Math.max(0,.52-out[nb+1])*.22,scarpStrip=Math.min(diff*.24,Math.max(0,(bed-out[nb])/effDx-stripSlope)*soil*stripGain);e0=Math.min(room,diff*.24,diff*localCreep+scarpStrip+Math.max(0,diff-localTalus*effDx)*.22);}}
   if(x+1<n){const nb=j+4,diff=h-out[nb]-out[nb+1];if(diff>0){const room=Math.max(0,.52-out[nb+1])*.22,scarpStrip=Math.min(diff*.24,Math.max(0,(bed-out[nb])/effDx-stripSlope)*soil*stripGain);e1=Math.min(room,diff*.24,diff*localCreep+scarpStrip+Math.max(0,diff-localTalus*effDx)*.22);}}
   if(z>0){const nb=j-n*4,diff=h-out[nb]-out[nb+1];if(diff>0){const room=Math.max(0,.52-out[nb+1])*.22,scarpStrip=Math.min(diff*.24,Math.max(0,(bed-out[nb])/effDz-stripSlope)*soil*stripGain);e2=Math.min(room,diff*.24,diff*localCreep+scarpStrip+Math.max(0,diff-localTalus*effDz)*.22);}}
   if(z+1<n){const nb=j+n*4,diff=h-out[nb]-out[nb+1];if(diff>0){const room=Math.max(0,.52-out[nb+1])*.22,scarpStrip=Math.min(diff*.24,Math.max(0,(bed-out[nb])/effDz-stripSlope)*soil*stripGain);e3=Math.min(room,diff*.24,diff*localCreep+scarpStrip+Math.max(0,diff-localTalus*effDz)*.22);}}
   const total=e0+e1+e2+e3,factor=total>0?Math.min(1,soil/total):0;
   flow[j]=e0*factor;flow[j+1]=e1*factor;flow[j+2]=e2*factor;flow[j+3]=e3*factor;
  }
 }
 const res=scratch?state:new Float32Array(N*4);
 for(let i=0;i<N;i++){const x=i%n,z=(i/n)|0,j=i*4;
  res[j]=out[j];
  res[j+1]=Math.max(0,out[j+1]+(x?flow[j-3]:0)+(x+1<n?flow[j+4]:0)+(z?flow[j-n*4+3]:0)+(z+1<n?flow[j+n*4+2]:0)-flow[j]-flow[j+1]-flow[j+2]-flow[j+3]);
  res[j+2]=0;res[j+3]=0;
 }
 if(n>=129){
  const zStart=Math.floor(n*.74);
  for(let pass=0;pass<3;pass++){
   for(let z=zStart;z<n-1;z++)for(let x=1;x<n-1;x++){
    const i=(z*n+x)*4,r=i+4,d=i+n*4;
    const dxH=(res[i]+res[i+1])-(res[r]+res[r+1]);
    if(dxH>0){const m=Math.min(res[i+1]*.35,dxH*.32);res[i+1]-=m;res[r+1]+=m;}
    else if(dxH<0){const m=Math.min(res[r+1]*.35,-dxH*.32);res[r+1]-=m;res[i+1]+=m;}
    const dzH=(res[i]+res[i+1])-(res[d]+res[d+1]);
    if(dzH>0){const m=Math.min(res[i+1]*.25,dzH*.24);res[i+1]-=m;res[d+1]+=m;}
    else if(dzH<0){const m=Math.min(res[d+1]*.25,-dzH*.24);res[d+1]-=m;res[i+1]+=m;}
   }
  }
 }
 return res;
}
export function createFormation(input,initial=null){
 const config=formationConfig(input),N=config.resolution**2,cellArea=config.width*config.length/(config.resolution-1)**2;
 const scratch={filled:new Float64Array(N),receiver:new Int32Array(N),floodParent:new Int32Array(N),rank:new Int32Array(N),seen:new Uint8Array(N),order:new Int32Array(N),heap:new Int32Array(N),distance:new Float64Array(N),area:new Float64Array(N),targets:new Int32Array(N*4),weights:new Float64Array(N*4),dists:new Float64Array(N*4),out:new Float64Array(N*4),load:new Float64Array(N),bankFlow:new Float64Array(N*4),flow:new Float64Array(N*4),hasFlood:false,stepCount:0};
 let state,steps=0,metrics={cellArea,weathered:0,rockEroded:0,bankCollapsed:0,erodedVolume:0,deposited:0,exportedVolume:0};
 if(initial){
  if(initial.version!==FORMATION_VERSION||formationRecipeKey(initial.config)!==formationRecipeKey(config)||!Number.isSafeInteger(initial.steps)||initial.steps<0||initial.steps>config.iterations)throw Error('Incompatible initial formation state');
  validate({...initial,config:{...config,iterations:initial.steps}});
  state=Float32Array.from(initial.state);steps=initial.steps;scratch.stepCount=steps;
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
