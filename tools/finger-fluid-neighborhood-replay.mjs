import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {auditNeighborhood} from './finger-fluid-neighborhood-audit.mjs';
const [output,...reports]=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/finger-fluid-neighborhood-replay.mjs output.json observed-report.json [...]');
const sha=b=>createHash('sha256').update(b).digest('hex');
const result={schema:'soggy.offline-neighborhood-geometry.v1',status:'failed',phase:'inputs',route:'CPU replay of retained native particle readbacks; no GPU timing',snapshots:[]};
try {
  if(!reports.length)throw Error('at least one observed report required');
  result.auditSource={repoRoot:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),moduleSha256:sha(readFileSync(new URL('./finger-fluid-neighborhood-audit.mjs',import.meta.url))),runnerSha256:sha(readFileSync(new URL(import.meta.url)))};
  const config={boundsMin:[-3.4,-1.2,-3.4],boundsMax:[3.4,3,3.4],radius:.185};
  result.geometryConfig={...config,provenance:'finger-fluid-webgpu-core.js unit-volume playground constants; source snapshots below; CPU f64 replay, not WGSL f32 parity'};
  for(const reportPath of reports){
    const bytes=readFileSync(reportPath),source=JSON.parse(bytes);
    if(source.ok!==true||source.expectedParticleCount!==36864||!source.samples?.length)throw Error('unsupported or incomplete observed capture');
    if(source.runtimeConfig?.source?.commit!==source.expectedCommit||source.runtimeConfig?.source?.dirty!==false||Object.values(source.sourceIdentity??{}).length===0||Object.values(source.sourceIdentity).some(x=>x.exactMatch!==true||x.localSha256!==x.servedSha256))throw Error('unverified observed source identity');
    const url=new URL(source.effectiveUrl);
    for(const [k,v] of Object.entries({finger_fluid_truth_scene:'multi_regime_playground',finger_fluid_particle_count:'36864',finger_fluid_fixed_volume_reference_count:'36864',finger_fluid_density_iterations:'3',finger_fluid_adaptive_density:'0'}))
      if(url.searchParams.get(k)!==v)throw Error(`unsupported observed configuration ${k}`);
    for(const sample of source.samples){
      result.phase='validate-readback';
      if(!Number.isSafeInteger(sample.stepCount)||sample.stepCount<1||sample.diagnosticsReceipt?.diagnosticsStepCount!==sample.stepCount)throw Error('unmatched readback step receipt');
      const receipt=sample.readbacks?.['kaminos-finger-fluid-diagnostics-readback'];
      if(!receipt)throw Error('missing particle readback');
      const data=readFileSync(receipt.path);
      if(data.length!==36864*64||data.length!==receipt.byteLength||sha(data)!==receipt.sha256)throw Error('particle readback size/hash mismatch');
      const points=[];let inactive=0,positionPredictionMismatches=0,interfaceParticles=0;
      for(let i=0;i<36864;i++){
        if(data.readFloatLE(i*64+28)<0){inactive++;continue;}
        points.push([0,1,2].map(a=>data.readFloatLE(i*64+a*4)));
        if([0,1,2].some(a=>data.readFloatLE(i*64+a*4)!==data.readFloatLE(i*64+32+a*4)))positionPredictionMismatches++;
        if(data.readFloatLE(i*64+44)>=.32)interfaceParticles++;
      }
      const row={report:resolve(reportPath),reportSha256:sha(bytes),sourceCommit:source.expectedCommit,sourceIdentity:source.sourceIdentity,recordedStep:sample.stepCount,readback:receipt,activeParticles:points.length,inactiveParticles:inactive,positionPredictionMismatches,interfaceParticlesAtThreshold032:interfaceParticles,arms:[]};
      result.snapshots.push(row);result.phase='enumerate';
      for(const gridDimensions of [[32,20,32],[36,22,36],[73,45,73]])row.arms.push(auditNeighborhood(points,{...config,gridDimensions}));
      if(new Set(row.arms.map(a=>a.acceptedPairs)).size!==1)throw Error('grid change changed contributing-pair count');
    }
  }
  result.phase='complete';result.status='passed';
} catch(e){result.error=String(e);process.exitCode=1;}
mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,phase:result.phase,snapshots:result.snapshots.length,error:result.error,output:resolve(output)}));
