// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const source=new URL('../experiments/hill-terrain/formation.mjs',import.meta.url);
assert.ok(existsSync(source),'Geological formation must own drainage, bedrock weathering and a cached state');
const {formationConfig,seedGeology,drainage,formTerrain,rockResistance,encodeFormation,decodeFormation}=await import(source);
const sum=s=>{let n=0;for(let i=0;i<s.length;i+=4)n+=s[i]+s[i+1];return n;};
test('drainage routes a depression to the chosen open edge without cycles',()=>{
 const c=formationConfig({resolution:9,iterations:0}),s=new Float32Array(9*9*4);
 for(let z=0;z<9;z++)for(let x=0;x<9;x++)s[(z*9+x)*4]=2-z/8;
 s[(4*9+4)*4]=.2;const d=drainage(s,c);
 for(let i=0;i<81;i++){const seen=new Set();let j=i;while(d.receiver[j]>=0){assert.ok(!seen.has(j));seen.add(j);j=d.receiver[j];}assert.equal(Math.floor(j/9),8);}
 assert.ok(d.filled[40]>.2);assert.ok(Math.abs(d.outletArea-c.width*c.length*81/64)<1e-8);
});
test('formation changes bedrock and cover, conserves accounted material and writes no actor history',()=>{
 const c=formationConfig({resolution:25,iterations:70}),initial=seedGeology(c),f=formTerrain(c);
 assert.deepEqual(f.state,formTerrain(c).state);assert.notDeepEqual(f.state,formTerrain({...c,seed:c.seed+1}).state);
 assert.ok(f.metrics.rockEroded>0);assert.ok(f.metrics.weathered>0);assert.ok(f.metrics.deposited>0);
 assert.ok(f.metrics.erodedVolume>0);assert.ok(f.metrics.exportedVolume>0);
 assert.ok(Math.abs(sum(initial)*f.metrics.cellArea-sum(f.state)*f.metrics.cellArea-f.metrics.exportedVolume)<1e-4);
 for(let i=0;i<f.state.length;i+=4){assert.ok(Number.isFinite(f.state[i]));assert.ok(f.state[i+1]>=0);assert.equal(f.state[i+2],0);assert.equal(f.state[i+3],0);}
 assert.ok(f.state.some((v,i)=>i%4===0&&Math.abs(v-initial[i])>.03));
});
test('stratigraphy changes resistance with excavation and formation controls matter',()=>{
 const c=formationConfig({resolution:17,iterations:20});assert.notEqual(rockResistance(.4,1,.3,c),rockResistance(.4,.75,.3,c));
 assert.notDeepEqual(formTerrain(c).state,formTerrain({...c,incision:0}).state);
 assert.notDeepEqual(formTerrain(c).state,formTerrain({...c,tilt:-c.tilt}).state);
});
test('cache round trips all fields and refuses corruption, partial state and stale recipes',()=>{
 const f=formTerrain({resolution:9,iterations:3}),b=encodeFormation(f),r=decodeFormation(b,f.config);
 assert.ok(b.byteLength < f.state.byteLength + 1024);assert.deepEqual(r.state,f.state);assert.deepEqual(r.config,f.config);assert.deepEqual(r.metrics,f.metrics);
 assert.throws(()=>decodeFormation(b.slice(0,-4)),/cache|length/i);
 const corrupt=b.slice(0);new Uint8Array(corrupt)[corrupt.byteLength-5]^=1;assert.throws(()=>decodeFormation(corrupt),/checksum/i);
 assert.throws(()=>decodeFormation(b,{...f.config,seed:99}),/recipe/i);
 assert.throws(()=>encodeFormation({...f,state:f.state.slice(4)}),/state/i);
 for(const p of [{resolution:2},{iterations:2.5},{seed:-1},{incision:-1},{width:0},{tilt:NaN}])assert.throws(()=>formationConfig(p));
});
test('a uniform slope under uniform rain does not develop grid-scale depositional spikes',async()=>{
 const {formationStep}=await import(source),c=formationConfig({resolution:17,weathering:0,creep:0,hardness:0});let s=new Float32Array(17*17*4);
 for(let z=0;z<17;z++)for(let x=0;x<17;x++){s[(z*17+x)*4]=3-z/8;s[(z*17+x)*4+1]=.1;}
 const metrics={weathered:0,exportedVolume:0,deposited:0,erodedVolume:0,rockEroded:0};
 for(let k=0;k<20;k++)s=formationStep(s,c,metrics);
 for(let z=1;z<16;z++)for(let x=1;x<16;x++){const i=(z*17+x)*4;assert.ok(s[i]+s[i+1]>=s[i+17*4]+s[i+17*4+1]-1e-6,'uniform downhill slope must stay downhill');}
});
test('channel initiation leaves sub-threshold hillslopes to weathering and slope transport',()=>{
 const f=formTerrain({resolution:17,iterations:10,channelArea:1000});assert.equal(f.metrics.rockEroded,0);assert.equal(f.metrics.erodedVolume,0);assert.ok(f.metrics.weathered>0);
});
test('exposed rock banks fail into conserved loose talus while stable rock remains intact',async()=>{
 const {formationStep}=await import(source),c=formationConfig({resolution:9,width:8,length:8,incision:0,weathering:0,creep:0,hardness:0});const s=new Float32Array(9*9*4);
 for(let z=0;z<9;z++)for(let x=0;x<9;x++)s[(z*9+x)*4]=x<4?4:0;
 const metrics={weathered:0,exportedVolume:0,deposited:0,erodedVolume:0,rockEroded:0};const next=formationStep(s,c,metrics);
 assert.ok(next[(4*9+3)*4]<4,'an exposed over-steep rock bank must supply material');
 assert.equal(next[(4*9+1)*4],4,'stable interior rock stays intact');
 assert.ok(next.some((v,i)=>i%4===1&&v>0),'failed rock becomes loose talus');assert.ok(Math.abs(sum(s)-sum(next))<1e-5);assert.ok(metrics.bankCollapsed>0);
});
test('inherited upland grades into a lower-gradient apron before the outlet',()=>{
 const c=formationConfig({resolution:33}),s=seedGeology(c),height=z=>s[(z*33+16)*4];
 assert.ok(Math.abs(height(28)-height(31))<Math.abs(height(14)-height(17))*.1,'the receiving apron must lose slope before sediment exits');
});
test('multi-receiver drainage and apron spreading retain fan deposits on finer grids',()=>{
 const c=formationConfig({resolution:49,iterations:120}),initial=seedGeology(c),f=formTerrain(c),d=drainage(f.state,c);
 assert.ok(d.targets instanceof Int32Array&&d.weights instanceof Float64Array,'drainage must expose multi-receiver targets and weights');
 assert.ok(f.metrics.deposited/f.metrics.erodedVolume>.32,'apron fan spreading must retain a substantial share of eroded sediment');
 let fanCols=0;for(let x=0;x<49;x++){let gain=0;for(let z=36;z<49;z++){const i=(z*49+x)*4;gain+=Math.max(0,f.state[i+1]-initial[i+1]);}if(gain>.02)fanCols++;}
 assert.ok(fanCols>=14,'apron deposition must spread laterally across multiple columns rather than a single slot');
});
test('extended formation preserves exposed upland rock instead of burying the mountain in soil',()=>{
 const f=formTerrain({resolution:33,iterations:600});let upland=0,exposed=0;
 for(let z=0;z<24;z++)for(let x=0;x<33;x++){upland++;if(Math.exp(-f.state[(z*33+x)*4+1]/.045)>.5)exposed++;}
 assert.ok(exposed/upland>.55,'extended formation must keep upland rock ridges and scarps visibly exposed');
 assert.ok(f.metrics.weathered<f.metrics.rockEroded+f.metrics.bankCollapsed,'regolith cover must insulate bedrock so uniform weathering does not outpace channel and bank sculpture');
});
test('incremental formation exposes partial snapshots and resumes identically to a full run',async()=>{
 const {createFormation}=await import(source),c=formationConfig({resolution:17,iterations:30}),early=createFormation({...c,iterations:12});
 early.step();const snap=early.snapshot();assert.equal(snap.partial,true);assert.equal(snap.steps,1);assert.equal(snap.state.length,17*17*4);
 while(!early.done)early.step();const mid=early.result(),resumed=createFormation(c,mid);
 while(!resumed.done)resumed.step();const finalResumed=resumed.result(),full=formTerrain(c);
 assert.deepEqual(finalResumed.state,full.state);assert.deepEqual(finalResumed.metrics,full.metrics);
});
test('multi-tile stitched formation partitions into ~1000 seam-locked tiles across a high-resolution territory with continuous cross-tile drainage',async()=>{
 const mod=await import(source),def=formationConfig({});
 assert.ok(def.tilesX*def.tilesZ>=900&&def.tilesX*def.tilesZ<=1600,'default territory must span ~1,000 stitched tiles (e.g. 32x32 = 1,024)');
 assert.ok(def.resolution===193&&def.valleys<=3,'default territory must pair 1,024-tile partitioning with a fast 193x193 (73.7k tri) base grid and grounded local landform scale (valleys <= 3)');
 assert.equal(typeof mod.partitionTiles,'function','formation must export tile partitioning');
 assert.equal(typeof mod.buildTiledIndices,'function','formation must export tile-ordered index construction');
 const t1024=mod.partitionTiles(def);assert.equal(t1024.length,def.tilesX*def.tilesZ);
 const c=formationConfig({resolution:25,tilesX:4,tilesZ:5,iterations:15}),tiles=mod.partitionTiles(c),indices=mod.buildTiledIndices(c);
 assert.equal(tiles.length,20);assert.equal(indices.length,24*24*6);
 let totalIndices=0;
 for(const t of tiles){
  totalIndices+=t.indexCount;
  if(t.tx+1<c.tilesX){const right=tiles.find(o=>o.tx===t.tx+1&&o.tz===t.tz);assert.equal(t.x1,right.x0,'adjacent X tiles must share seam vertices');}
  if(t.tz+1<c.tilesZ){const down=tiles.find(o=>o.tx===t.tx&&o.tz===t.tz+1);assert.equal(t.z1,down.z0,'adjacent Z tiles must share seam vertices');}
 }
 assert.equal(totalIndices,indices.length);
 const f=formTerrain(c),d=drainage(f.state,c);
 let crossSeam=0;
 for(const t of tiles)if(t.tz+1<c.tilesZ)for(let x=t.x0;x<=t.x1;x++){const i=t.z1*c.resolution+x,r=d.receiver[i];if(r>=0&&Math.floor(r/c.resolution)>t.z1)crossSeam++;}
 assert.ok(crossSeam>0,'drainage must route water and sediment continuously across internal tile seams');
 const denseCfg=formationConfig({resolution:97,tilesX:6,tilesZ:5,iterations:60}),initialState=seedGeology(denseCfg),formedDense=formTerrain(denseCfg);
 let initPeak=0,formedPeak=0,maxSoil=0;
 for(let i=0;i<denseCfg.resolution**2;i++){
  initPeak=Math.max(initPeak,initialState[i*4]+initialState[i*4+1]);
  formedPeak=Math.max(formedPeak,formedDense.state[i*4]+formedDense.state[i*4+1]);
  maxSoil=Math.max(maxSoil,formedDense.state[i*4+1]);
 }
 assert.ok(formedPeak<=initPeak+1e-4&&maxSoil<.65,`scarp stripping must never push soil uphill into spikes (formedPeak=${formedPeak.toFixed(3)}, initPeak=${initPeak.toFixed(3)}, maxSoil=${maxSoil.toFixed(3)})`);
});
test('strike-rotated stratigraphy and macro-authoring metadata expose bounded ranges, tooltips and presets',async()=>{
 const mod=await import(source),c=formationConfig({resolution:17,iterations:10,tilt:.8,hardness:6});
 assert.notEqual(rockResistance(.6,1.1,.4,{...c,strike:0}),rockResistance(.6,1.1,.4,{...c,strike:45}),'strike angle must rotate 3D bedding orientation');
 assert.notDeepEqual(seedGeology({...c,valleys:2}),seedGeology({...c,valleys:5}),'valley count must reshape the underlying macro-topography');
 assert.ok(Array.isArray(mod.FORMATION_FIELDS)&&mod.FORMATION_FIELDS.length>=14,'authoring field metadata must include mesa and terrace controls');
 for(const field of mod.FORMATION_FIELDS){
  assert.ok(typeof field.key==='string'&&typeof field.title==='string'&&typeof field.tooltip==='string'&&field.tooltip.length>20,'each field needs a descriptive tooltip');
  assert.ok(Number.isFinite(field.min)&&Number.isFinite(field.max)&&field.max>field.min&&Number.isFinite(field.step)&&field.step>0,'each field needs a sane [min, max] range and step');
  assert.equal(field.default,formationConfig({})[field.key],'field default must match formationConfig default');
 }
 assert.ok(Array.isArray(mod.FORMATION_PRESETS)&&mod.FORMATION_PRESETS.some(p=>p.id==='cuesta-hogbacks'&&p.patch.hardness>=10),'presets must include cuesta hogbacks');
 assert.ok(mod.FORMATION_PRESETS.some(p=>p.id==='canyon-mesas'&&p.patch.mesa>=.65),'presets must include flat-topped canyon mesas');
 assert.ok(mod.FORMATION_PRESETS.some(p=>p.id==='stepped-terraces'&&p.patch.terrace>=.75),'presets must include stepped structural terraces');
});
test('mesa and structural terrace controls form flat-topped benches bounded by cliff scarps while seed variation reorganizes macro-topography',()=>{
 const mesaCfg=formationConfig({resolution:65,iterations:50,mesa:.85,terrace:.82,tilt:.08,hardness:12,valleys:5});
 const ridgeCfg=formationConfig({resolution:65,iterations:50,mesa:0,terrace:0,tilt:.45,hardness:4,valleys:5});
 const mesaState=formTerrain(mesaCfg).state,ridgeState=formTerrain(ridgeCfg).state;
 const countBenchAndCliff=(state,cfg)=>{
  const n=cfg.resolution,dx=cfg.width/(n-1),dz=cfg.length/(n-1);
  let bench=0,cliff=0,elevated=0;
  for(let z=2;z<Math.floor(n*.72);z++)for(let x=2;x<n-2;x++){
   const i=(z*n+x)*4,b=state[i];if(b<.32*cfg.relief)continue;
   elevated++;
   const gx=(state[i+4]-state[i-4])/(2*dx),gz=(state[i+n*4]-state[i-n*4])/(2*dz),grad=Math.hypot(gx,gz);
   if(grad<.24)bench++;
   if(grad>.85)cliff++;
  }
  return{bench,cliff,elevated,benchShare:bench/Math.max(1,elevated)};
 };
 const mStats=countBenchAndCliff(mesaState,mesaCfg),rStats=countBenchAndCliff(ridgeState,ridgeCfg);
 assert.ok(mStats.benchShare>rStats.benchShare*2&&mStats.benchShare>.22,`mesa/terrace recipe must produce substantially more elevated flat bench/caprock tread area than peaked ridges (mesa=${mStats.benchShare.toFixed(3)}, ridge=${rStats.benchShare.toFixed(3)})`);
 assert.ok(mStats.cliff>=40,`mesa/terrace topography must retain steep bounding cliff scarps (cliff=${mStats.cliff})`);
 const s47=seedGeology(formationConfig({resolution:49,seed:47})),s344=seedGeology(formationConfig({resolution:49,seed:344})),s862=seedGeology(formationConfig({resolution:49,seed:862}));
 const uplandRms=(a,b)=>{let sq=0,k=0;for(let z=2;z<34;z++)for(let x=0;x<49;x++){const d=a[(z*49+x)*4]-b[(z*49+x)*4];sq+=d*d;k++;}return Math.sqrt(sq/k);};
 const rms1=uplandRms(s47,s344),rms2=uplandRms(s47,s862),rms3=uplandRms(s344,s862);
 assert.ok(rms1>.45&&rms2>.45&&rms3>.45,`different seeds must reorganize macro-topography rather than nudging fixed ridges (rms=${rms1.toFixed(3)}, ${rms2.toFixed(3)}, ${rms3.toFixed(3)})`);
});
test('hybrid dendritic spur dissection and meso cliff/scree/rill detail articulate mesa flanks, treads and aprons while preserving flat caps',async()=>{
 const mod=await import(source),def=formationConfig({});
 assert.ok(Number.isFinite(def.spurs)&&def.spurs>0&&Number.isFinite(def.meso)&&def.meso>0,'formationConfig must expose spurs and meso detail defaults');
 assert.ok(mod.FORMATION_FIELDS.some(f=>f.key==='spurs')&&mod.FORMATION_FIELDS.some(f=>f.key==='meso'),'FORMATION_FIELDS must include spurs and meso sliders');
 assert.ok(mod.FORMATION_PRESETS.some(p=>p.id==='dissected-mesa-spurs'&&p.patch.mesa>=.5&&p.patch.spurs>=.65),'FORMATION_PRESETS must include a hybrid dissected mesa-and-spur preset');
 const n=97,baseCfg={resolution:n,iterations:30,mesa:.72,terrace:.64,valleys:6};
 const smoothSeed=seedGeology(formationConfig({...baseCfg,spurs:0,meso:0}));
 const spurredSeed=seedGeology(formationConfig({...baseCfg,spurs:.85,meso:0}));
 const flankCurvature=state=>{
  let sum=0,cnt=0;
  for(let z=4;z<Math.floor(n*.72);z++)for(let x=4;x<n-4;x++){
   const i=(z*n+x)*4,b=state[i];if(b<.22*def.relief||b>.82*def.relief)continue;
   const lap=Math.abs(state[i-4]+state[i+4]+state[i-n*4]+state[i+n*4]-4*b);
   sum+=lap;cnt++;
  }
  return sum/Math.max(1,cnt);
 };
 const cSmooth=flankCurvature(smoothSeed),cSpur=flankCurvature(spurredSeed);
 assert.ok(cSpur>cSmooth*1.18,`dendritic spur dissection must articulate intermediate mesa flanks and canyon walls (spur=${cSpur.toFixed(4)}, smooth=${cSmooth.toFixed(4)})`);
 const noMeso=formTerrain(formationConfig({...baseCfg,spurs:.58,meso:0})).state;
 const withMeso=formTerrain(formationConfig({...baseCfg,spurs:.58,meso:.85})).state;
 const microEnergy=(state,z0,z1,maxH=Infinity)=>{
  let sum=0,cnt=0;
  for(let z=z0;z<z1;z++)for(let x=2;x<n-2;x++){
   const i=(z*n+x)*4,h=state[i]+state[i+1];if(h>maxH)continue;
   const hL=state[i-4]+state[i-3],hR=state[i+4]+state[i+5],hU=state[i-n*4]+state[i-n*4+1],hD=state[i+n*4]+state[i+n*4+1];
   sum+=Math.abs(hL+hR+hU+hD-4*h);cnt++;
  }
  return sum/Math.max(1,cnt);
 };
 const up0=microEnergy(noMeso,4,Math.floor(n*.70),.82*def.relief),up1=microEnergy(withMeso,4,Math.floor(n*.70),.82*def.relief);
 const ap0=microEnergy(noMeso,Math.floor(n*.74),n-3),ap1=microEnergy(withMeso,Math.floor(n*.74),n-3);
 assert.ok(up1>up0*1.12&&ap1>ap0*1.15,`meso detail must increase structural sub-ledge/chute and apron rill articulation without cone spikes (upland: ${up0.toFixed(4)} -> ${up1.toFixed(4)}, apron: ${ap0.toFixed(4)} -> ${ap1.toFixed(4)})`);
 const capLap=state=>{
  let sum=0,cnt=0;
  for(let z=4;z<Math.floor(n*.45);z++)for(let x=4;x<n-4;x++){
   const i=(z*n+x)*4,h=state[i]+state[i+1];if(h<.82*def.relief)continue;
   const hL=state[i-4]+state[i-3],hR=state[i+4]+state[i+5],hU=state[i-n*4]+state[i-n*4+1],hD=state[i+n*4]+state[i+n*4+1];
   if(Math.hypot(hR-hL,hD-hU)>.08*def.relief)continue;
   sum+=Math.abs(hL+hR+hU+hD-4*h);cnt++;
  }
  return{cnt,lap:sum/Math.max(1,cnt)};
 };
 const c0=capLap(noMeso),c1=capLap(withMeso);
 assert.ok(c1.cnt>20&&c1.lap<c0.lap*1.12&&c1.lap<.022*def.relief,`upper plateau caprock interior must remain free of cone spikes (capCnt=${c1.cnt}, capLap=${c0.lap.toFixed(4)} -> ${c1.lap.toFixed(4)})`);
 const t0=performance.now(),defaultRun=formTerrain(def),elapsedMs=performance.now()-t0;
 assert.ok(elapsedMs<450,`default grounded formation must complete in <450ms (took ${elapsedMs.toFixed(1)}ms)`);
 const dn=def.resolution,ddx=def.width/(dn-1);
 let maxApronSpike=0;
 for(let z=Math.floor(dn*.78);z<dn-2;z++)for(let x=2;x<dn-2;x++){
  const i=(z*dn+x)*4,h=defaultRun.state[i]+defaultRun.state[i+1],hL=defaultRun.state[i-4]+defaultRun.state[i-3],hR=defaultRun.state[i+4]+defaultRun.state[i+5];
  maxApronSpike=Math.max(maxApronSpike,Math.abs(hL+hR-2*h)/ddx);
 }
 assert.ok(maxApronSpike<.35,`receiving apron must remain smooth and free of sawtooth floor spikes (maxApronSpike=${maxApronSpike.toFixed(3)})`);
});
