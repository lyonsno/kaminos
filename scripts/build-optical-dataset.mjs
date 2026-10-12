import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {validateTraceRows,opticalProbeFeatures} from '../volume-optical-trace.mjs';
import {buildOpticalHierarchy} from '../volume-optical-refinement.mjs';

const [input,out]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={identity:'optical-probe-dataset-v0',status:'running',phase:'manifest',input,
  spatialScope:'three native scanlines per state/view',rootSpan:256,labelResolutionTolerance:1e-4,
  labelAuthority:'finite nested576-vs288 disagreement; unresolved records retained, not admitted to training',
  sources:[],counts:{},files:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
const sha=b=>createHash('sha256').update(b).digest('hex');
await save();let streams=[];
try {
  const raw=await fs.readFile(input),pilot=JSON.parse(raw);report.inputSha256=sha(raw);
  assert.ok(pilot.identity==='optical-state-view-pilot-v0'&&pilot.status==='observed'&&pilot.phase==='complete','complete pilot required');
  assert.equal(pilot.cases.length,12,'12 state/view cases required');
  const seen=new Set();
  for(const c of pilot.cases) {
    const key=`${c.step}:${c.yaw}`;assert.ok(!seen.has(key),'duplicate state/view');seen.add(key);
    assert.ok([151,173,197,229].includes(c.step)&&[0,-15,15].includes(c.yaw));
    const split=c.step===229?'test':c.step===197?'validation':c.yaw===15?'view-test':'train';
    assert.equal(c.split,split,'state/view split violation');assert.equal(c.status,'observed');
  }
  streams=[3,5].map(n=>createWriteStream(out+`/probes${n}.jsonl`));
  for(const entry of pilot.cases) {
    report.phase=`capture-${entry.step}-${entry.yaw}`;await save();
    const reportPath=path.join(entry.path,'report.json'),raw=await fs.readFile(reportPath),capture=JSON.parse(raw);
    assert.equal(capture.status,'observed');assert.equal(capture.phase,'complete');
    assert.equal(capture.source,pilot.source);assert.equal(capture.diff,'');
    assert.deepEqual(capture.requested,{heldStep:entry.step,yaw:entry.yaw,subdivisions:576});
    assert.equal(capture.state.simStepCount,entry.step);assert.equal(capture.chunks.length,6);
    assert.equal(capture.comparisons.length,3);assert.ok(capture.comparisons.every(c=>c.ok));
    for(const key of ['position','target','up'])assert.ok(capture.requestedCamera[key].every((v,i)=>Math.abs(v-capture.effectiveCamera[key][i])<1e-5),'camera mismatch');
    const source={path:reportPath,sha256:sha(raw),step:entry.step,yaw:entry.yaw,split:entry.split,rays:0,missRays:0,zeroLengthRays:0};
    report.sources.push(source);
    const auto=capture.chunks.filter(c=>c.path.endsWith('-auto.f32'));
    assert.equal(new Set(auto.map(c=>c.path)).size,3,'three distinct scanlines required');
    for(const chunk of auto) {
      assert.equal(chunk.effective.route,'native-3d-compute-fluid-raymarch-v0');
      assert.equal(chunk.effective.backend,'WebGPU:apple');assert.equal(chunk.effective.simStepCount,entry.step);
      assert.equal(chunk.effective.specialization.effective,'lean-emissive-raymarch-v0');
      assert.equal(chunk.plan.sampleCount,577);assert.equal(chunk.plan.subdivisions,576);
      const bytes=await fs.readFile(path.join(entry.path,chunk.path));assert.equal(sha(bytes),chunk.sha256,'trace hash mismatch');
      const values=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);validateTraceRows(values,chunk.plan);
      for(let ray=0;ray<chunk.plan.rayCount;ray++) {
        const base=ray*577*32,length=values[base+6]-values[base+5];
        if(!values[base+2]){source.missRays++;continue;}
        if(length===0){source.zeroLengthRays++;continue;}
        source.rays++;
        const probes=Array.from({length:577},(_,s)=>{
          const at=base+s*32;return {sigma:values[at+16],emission:Array.from(values.slice(at+17,at+20)),
            scattered:Array.from(values.slice(at+20,at+23)),flags:[values[at+23],values[at+24]]};
        });
        for(const [arm,probeCount] of [3,5].entries()) {
          const tree=buildOpticalHierarchy(probes,{length,rootSpan:256,probeCount});
          const pending=[...tree.roots];
          while(pending.length) {
            const node=pending.pop(),at=base+node.start*32;
            const features=opticalProbeFeatures(node.probes,{h:node.h,gridPitch:values[at+15],
              direction:Array.from(values.slice(at+12,at+15)),cellFraction:Array.from(values.slice(at+28,at+31))});
            const resolved=node.teacherDisagreement.every(v=>v<=report.labelResolutionTolerance);
            const record={case:`${entry.step}:${entry.yaw}`,split:entry.split,chunk:chunk.path,ray:chunk.plan.firstRay+ray,
              start:node.start,end:node.end,features,label:node.teacherError,numerical:node.numericalError,
              uncertainty:node.teacherDisagreement,resolved,bright:node.teacher.slice(0,3).some(v=>Math.abs(v)>.001)};
            if(!streams[arm].write(JSON.stringify(record)+'\n'))await once(streams[arm],'drain');
            const key=`${probeCount}:${entry.split}`,count=report.counts[key]??={total:0,resolved:0,bright:0};
            count.total++;count.resolved+=Number(resolved);count.bright+=Number(record.bright);
            pending.push(...node.children);
          }
        }
      }
    }
    await save();
  }
  for(const stream of streams){stream.end();await once(stream,'finish');}streams=[];
  for(const probeCount of [3,5]) {
    for(const split of ['train','validation','test','view-test'])assert.ok(report.counts[`${probeCount}:${split}`]?.resolved>0,'empty resolved split');
    const file=out+`/probes${probeCount}.jsonl`,bytes=await fs.readFile(file);
    report.files.push({probeCount,path:file,bytes:bytes.length,sha256:sha(bytes)});
  }
  report.status='observed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{for(const stream of streams)stream.destroy();await save();}
