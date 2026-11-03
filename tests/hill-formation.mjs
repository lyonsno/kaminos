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
