// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
function body(text,needle){const start=text.indexOf(needle);assert.ok(start>=0,needle);const open=text.indexOf('{',start);let depth=1,end=open+1;for(;depth;end++){if(text[end]==='{')depth++;if(text[end]==='}')depth--;}return text.slice(open+1,end-1);}
const predictor=body(source,'fn csTransportPredict('),shred=body(predictor,'if (SHRED_ONLY)');
const js=shred.replaceAll('vec4<f32>','vec4').replaceAll(/(\d+)u\b/g,'$1');
const vector=(...v)=>{const a=v.flat();return {xyz:a.slice(0,3),w:a[3],y:a[1]};};
const run=new Function('MATERIAL_ONLY','VELOCITY_ONLY','fluidPredict','base','backCell','sampleFluidSlotInflow','sampleReactantOxidizer','reactantLawOn','u','advectVelocity','select','vec4',js);
const corrector = body(source, 'fn transportReactantOxidizer(').replaceAll(/(\d+)u\b/g, '$1');
const correct = new Function('VELOCITY_ONLY', 'u', 'sampleReactantOxidizer', 'fluidPredict', 'slotIndex',
  'cellI', 'backCell', 'forwardCell', 'macCormackScalars', 'select', 'openWorldBoundary',
  'ghostOutsideAmount', 'max', 'inflowGhostBlend', 'sampleReactantPredicted',
  'readReactantOxidizer', 'reactantOxidizerExtrema', corrector);
const coarse=[.4,-.2,.3],cell=[4.5,4.5,4.5],dt=.5,scalar=p=>p[0]+2*p[1]+3*p[2];
for(const initial of [[0,0,0,0],[91,92,93,94]])for(const scheme of [2,3]){
 const predicted=[vector(initial),null,null,null];
 run(true,false,predicted,0,cell,()=>vector(.1,.2,.3,0),()=>1,()=>true,{transport_controls:{x:scheme}},coarse,(a,b,c)=>c?b:a,vector);
 assert.deepEqual(predicted[0].xyz,coarse,'fresh or reused Shred material predictor caches the current nonzero coarse characteristic');
 const departure=predicted[0].xyz.map((v,a)=>cell[a]-v*dt),expected=coarse.map((v,a)=>cell[a]-v*dt);
 assert.equal(scalar(departure),scalar(expected),'a nonuniform scalar follows the current characteristic after entering Shred');
 assert.equal(predicted[0].w,scheme===3?1:0,'only scalar MacCormack consumes the current predicted oxidizer');
}
for(const materialOnly of [false,true])for(const initial of [[0,0,0,0],[91,92,93,94]]){
 const predicted=[vector(initial),null,null,null];
 run(materialOnly,false,predicted,0,cell,()=>vector(0,0,0,0),()=>1,()=>true,{transport_controls:{x:3}},[0,0,0],(a,b,c)=>c?b:a,vector);
 // Execute the production corrector too: a uniform interior field remains
 // ambient under its actual neighbor-extrema revert limiter.
 const value = correct(false, {reactant_combustion_c:{z:1}}, () => 1, predicted, () => 0,
   cell, cell, cell, true, (a,b,c) => c ? b : a, () => false, () => 0, Math.max,
   () => 0, () => predicted[0].w, () => 1, () => ({x:1,y:1}));
 assert.equal(value,1,'combined and independent Shred MacCormack preserve uniform ambient oxidizer');
}
assert.match(body(source,'fn cs(@builtin'),/fluidPredict\[base\]\.xyz, MATERIAL_ONLY && u\.transport_controls\.x > 1\.5/);
assert.match(body(source,'fn transportReactantOxidizer('),/fluidPredict\[slotIndex\(cellI, 0u\)\]\.w, macCormackScalars/);
console.log('PASS production Shred predictor cache on fresh and reused buffers, nonuniform scalar backtrace and uniform oxidizer');
