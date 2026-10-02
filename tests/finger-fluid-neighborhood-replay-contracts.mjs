import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'soggy-neighborhood-negative-'));
const base={ok:true,expectedParticleCount:36864,expectedCommit:'synthetic',runtimeConfig:{source:{commit:'synthetic',dirty:false}},sourceIdentity:{core:{exactMatch:true,localSha256:'same',servedSha256:'same'}},effectiveUrl:'http://localhost/?finger_fluid_truth_scene=multi_regime_playground&finger_fluid_particle_count=36864&finger_fluid_fixed_volume_reference_count=36864&finger_fluid_density_iterations=3&finger_fluid_adaptive_density=0',samples:[{stepCount:250,diagnosticsReceipt:{diagnosticsStepCount:250},readbacks:{}}]};
const effective={effectiveTruthScene:'multi_regime_playground',effectiveParticleCount:36864,effectiveFixedVolumeReferenceParticleCount:36864,effectivePressureIterations:3,effectiveAdaptiveDensity:false,waterfallOracleConfig:null};
base.samples[0].debugState={config:effective};
const cases=[
 ['effective-mismatch',{...base,samples:[{...base.samples[0],debugState:{config:{...effective,effectivePressureIterations:1,effectiveAdaptiveDensity:true}}}]},/effective configuration/],
 ['effective-missing',{...base,samples:[{...base.samples[0],debugState:{}}]},/effective configuration/],
 ['wrong-source',{...base,runtimeConfig:{source:{commit:'other',dirty:false}}},/source identity/],
 ['missing-primary',base,/missing particle readback/],
 ['wrong-route',{...base,effectiveUrl:base.effectiveUrl.replace('iterations=3','iterations=1')},/configuration/],
 ['stale-step',{...base,samples:[{...base.samples[0],diagnosticsReceipt:{diagnosticsStepCount:1}}]},/step receipt/],
 ['partial-report',{...base,ok:false},/incomplete observed capture/],
];
const short=join(dir,'short.bin');writeFileSync(short,Buffer.alloc(64));
cases.push(['partial-buffer',{...base,samples:[{...base.samples[0],readbacks:{'kaminos-finger-fluid-diagnostics-readback':{path:short,byteLength:64,sha256:'wrong'}}}]},/size\/hash mismatch/]);
for(const [name,input,expected] of cases){
 const path=join(dir,name+'.json'),out=join(dir,name+'-result.json');writeFileSync(path,JSON.stringify(input));
 const p=spawnSync(process.execPath,['tools/finger-fluid-neighborhood-replay.mjs',out,path],{encoding:'utf8'});
 assert.equal(p.status,1,name);const result=JSON.parse(readFileSync(out));assert.equal(result.status,'failed');assert.match(result.error,expected);assert.notEqual(result.phase,'complete');
}
console.log(`replay negative contracts passed (${cases.length}); synthetic admission fixtures only`);
