import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {validateTraceRows,opticalProbeFeatures} from '../volume-optical-trace.mjs';
import {buildOpticalHierarchy,frozenOpticalPredictor} from '../volume-optical-refinement.mjs';
import {compareRayPolicies} from './replay-optical-predictions.mjs';

const variants=['baseline','radius-half','radius-double','fuel-half','fuel-double','temperature-half','temperature-double','all-half','all-double'];
const thresholds=[.0001,.0003,.001,.003,.01,.03];
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fileHash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
const finiteFour=v=>Array.isArray(v)&&v.length===4&&Array.from(v).every(x=>Number.isFinite(x)&&x>=0);

export function validateHeldoutManifest(manifest) {
  assert.ok(manifest.identity==='smokey-heldout-capture-v1'&&manifest.status==='observed'&&manifest.phase==='complete'&&manifest.mode==='sweep','complete held-out sweep required');
  assert.equal(manifest.cases?.length,36,'36 physical state/view cases required');
  const expected=new Set(variants.flatMap(v=>[197,229].flatMap(s=>[0,-15].map(y=>`${v}:${s}:${y}`))));
  for(const c of manifest.cases){assert.equal(c.status,'observed');assert.ok(expected.delete(`${c.variant}:${c.step}:${c.yaw}`),'duplicate or unexpected held-out case');}
  assert.equal(expected.size,0,'missing held-out case');
}

export function replayHeldoutRay(values,base,count,{probeCount,predict,calibration,thresholds,amplitude,trainingRange}) {
  assert.ok(finiteFour(calibration),'explicit frozen numerical calibration required');
  assert.ok(Number.isFinite(amplitude)&&amplitude>0,'positive amplitude required');
  const length=values[base+6]-values[base+5];
  const probes=Array.from({length:count},(_,s)=>{
    const at=base+s*32;
    return {sigma:values[at+16],emission:Array.from(values.slice(at+17,at+20),v=>v*amplitude),
      scattered:Array.from(values.slice(at+20,at+23),v=>v*amplitude),flags:[values[at+23],values[at+24]]};
  });
  const tree=buildOpticalHierarchy(probes,{length,rootSpan:256,probeCount});
  const cache=new Map(),extrapolation={nodes:0,outside:0,byFeature:Array(9*probeCount+8).fill(0)};
  const prediction=({probes,h,start})=>{
    const key=`${start}:${h}`;
    if(!cache.has(key)) {
      const at=base+start*32;
      const features=opticalProbeFeatures(probes,{h,gridPitch:values[at+15],direction:Array.from(values.slice(at+12,at+15)),cellFraction:Array.from(values.slice(at+28,at+31))});
      extrapolation.nodes++;
      if(trainingRange){let outside=false;features.forEach((v,i)=>{
        const x=Math.fround(v);if(x<trainingRange.min[i]||x>trainingRange.max[i]){outside=true;extrapolation.byFeature[i]++;}
      });extrapolation.outside+=Number(outside);}
      cache.set(key,predict(features));
    }
    return cache.get(key);
  };
  return {teacher:tree.teacher,extrapolation,results:compareRayPolicies(tree,prediction,calibration,thresholds)};
}

export async function replayHeldout(manifestPath,trainingPath,out) {
  await fs.mkdir(out,{recursive:true});
  const report={identity:'smokey-frozen-controller-replay-v1',status:'running',phase:'manifest',thresholds,
    effectiveRoute:'node-cpu-frozen-mlp-shared-optical-controller',rootSpan:256,
    claim:'held-out optical transfer error versus unique probes, not learned rendered images, motion or GPU speed',
    extrapolationScope:'union of predictor-visited segments across the tolerance ladder; resolved training rows only',
    sources:[],models:[],summaries:{}};
  const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  let output;await save();
  try {
    report.source=execFileSync('git',['rev-parse','HEAD'],{cwd:import.meta.dirname,encoding:'utf8'}).trim();
    report.diff=execFileSync('git',['diff','HEAD'],{cwd:import.meta.dirname,encoding:'utf8'});
    const rawManifest=await fs.readFile(manifestPath),manifest=JSON.parse(rawManifest);validateHeldoutManifest(manifest);
    report.manifest={path:manifestPath,sha256:sha(rawManifest),captureSource:manifest.source};
    report.phase='training';await save();
    const rawTraining=await fs.readFile(trainingPath),training=JSON.parse(rawTraining);
    report.training={path:trainingPath,sha256:sha(rawTraining)};
    assert.ok(training.identity==='optical-quantile-pilot-v0'&&training.status==='trained'&&training.phase==='complete','complete saved training required');
    assert.deepEqual(training.models.map(m=>m.probeCount).sort(),[3,5],'both frozen arms required');
    const models=[];
    for(const saved of training.models) {
      report.phase=`model-${saved.probeCount}`;await save();
      const bytes=await fs.readFile(saved.artifact.path);assert.equal(sha(bytes),saved.artifact.sha256,'model hash mismatch');
      const model=JSON.parse(bytes);assert.equal(model.probeCount,saved.probeCount);
      assert.equal(model.dataset.sha256,saved.dataset.sha256,'model training dataset mismatch');
      const calibration=saved.numericalCalibration?.factors;assert.ok(finiteFour(calibration),'explicit frozen numerical calibration required');
      assert.equal(await fileHash(saved.dataset.path),saved.dataset.sha256,'training dataset hash mismatch');
      const width=model.mean.length,range={min:Array(width).fill(Infinity),max:Array(width).fill(-Infinity),rows:0};
      const lines=createInterface({input:createReadStream(saved.dataset.path),crlfDelay:Infinity});
      for await(const line of lines){const row=JSON.parse(line);if(row.split!=='train'||row.resolved!==true)continue;
        assert.ok(row.features.length===width&&row.features.every(Number.isFinite),'invalid training feature');
        row.features.forEach((v,i)=>{const x=Math.fround(v);range.min[i]=Math.min(range.min[i],x);range.max[i]=Math.max(range.max[i],x);});range.rows++;
      }
      assert.ok(range.rows>0,'nonempty resolved training range required');
      models.push({probeCount:saved.probeCount,predict:frozenOpticalPredictor(model),calibration,trainingRange:range});
      report.models.push({probeCount:saved.probeCount,artifact:saved.artifact,dataset:saved.dataset,calibration,trainingRange:range});
    }
    report.phase='outputs';await save();output=await fs.open(path.join(out,'rays.jsonl'),'w');
    const groups=new Map();
    for(const entry of manifest.cases) {
      const key=`${entry.variant}:${entry.step}:${entry.yaw}`;report.phase=key;await save();
      const capturePath=path.join(entry.path,'report.json'),raw=await fs.readFile(capturePath),capture=JSON.parse(raw);
      assert.ok(capture.identity==='ordered-optical-capture-conformance-v0'&&capture.status==='observed'&&capture.phase==='complete','complete native capture required');
      assert.equal(capture.source,manifest.source);assert.equal(capture.diff,'');
      const basinBytes=await fs.readFile(path.join(entry.path,'source-basin.json')),basin=JSON.parse(basinBytes);
      assert.ok(typeof entry.presetId==='string'&&entry.presetId.length>0,'preset identity required');
      assert.equal(basin.presetId,entry.presetId,'captured preset differs from declared variant');
      assert.deepEqual(capture.requested,{heldStep:entry.step,yaw:entry.yaw,subdivisions:576});
      assert.equal(capture.state.simStepCount,entry.step);assert.equal(capture.state.backend,'WebGPU:apple');
      assert.equal(capture.state.effectiveRoute,'native-3d-compute-fluid-raymarch-v0');
      assert.equal(capture.state.immersedSource?.effective.admitted,true,'immersed source not admitted');
      for(const field of ['position','target','up'])assert.ok(capture.requestedCamera[field].every((v,i)=>Math.abs(v-capture.effectiveCamera[field][i])<1e-5),'camera mismatch');
      assert.equal(capture.chunks.length,9,'nine scanlines required');
      const expected=new Set([.1,.2,.3,.4,.5,.6,.7,.8,.9].map(y=>`trace-${y}-force-full.f32`));
      const source={case:key,path:capturePath,sha256:sha(raw),basinSha256:sha(basinBytes),presetId:entry.presetId,rays:0,misses:0,zeroLength:0,emitting:capture.emitting};report.sources.push(source);
      for(const chunk of capture.chunks) {
        assert.ok(expected.delete(chunk.path),'duplicate or unexpected scanline');assert.equal(chunk.ok,true);
        assert.equal(chunk.effective.route,capture.state.effectiveRoute);assert.equal(chunk.effective.backend,capture.state.backend);
        assert.equal(chunk.effective.simStepCount,entry.step);assert.equal(chunk.effective.specialization.effective,'full-authored-raymarch-v0');
        assert.equal(chunk.plan.sampleCount,577);assert.equal(chunk.plan.sampleOffset,0);assert.equal(chunk.plan.subdivisions,576);
        const bytes=await fs.readFile(path.join(entry.path,chunk.path));assert.equal(sha(bytes),chunk.sha256,'trace hash mismatch');
        const values=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);validateTraceRows(values,chunk.plan);
        for(let ray=0;ray<chunk.plan.rayCount;ray++) {
          const base=ray*577*32;if(!values[base+2]){source.misses++;continue;}
          if(values[base+6]===values[base+5]){source.zeroLength++;continue;}source.rays++;
          for(const amplitude of entry.variant==='baseline'?[1,.5,2]:[1])for(const model of models) {
            const replay=replayHeldoutRay(values,base,577,{...model,thresholds,amplitude});
            const caseKey=`${key}:amplitude${amplitude}`,population=amplitude===1?'physical':'synthetic-amplitude';
            const records=replay.results.map(result=>{
              const row={case:caseKey,population,chunk:chunk.path,ray:chunk.plan.firstRay+ray,probeCount:model.probeCount,
                amplitude,teacher:replay.teacher,extrapolation:replay.extrapolation,...result};
              for(const scope of [caseKey,population]) {
                const groupKey=`${scope}:${model.probeCount}:${result.policy}:${result.tolerance}`;
                const g=groups.get(groupKey)??{rays:0,probes:0,queries:0,rgb:[],transmission:[],unresolvedLeafCount:0,unresolvedReferenceCount:0,
                  missedBrightSegments:0,missedOtherSegments:0,worst:null};
                const rgb=Math.max(...result.error.slice(0,3));g.rays++;g.probes+=result.uniqueProbeCount;g.queries+=result.predictionQueries;
                g.rgb.push(rgb);g.transmission.push(result.error[3]);
                if(!g.worst||rgb>g.worst.rgb)g.worst={case:caseKey,chunk:chunk.path,ray:row.ray,rgb};
                for(const k of ['unresolvedLeafCount','unresolvedReferenceCount','missedBrightSegments','missedOtherSegments'])g[k]+=result[k];
                groups.set(groupKey,g);
              }
              return JSON.stringify(row)+'\n';
            });
            await output.writeFile(records.join(''));
          }
        }
      }
      assert.ok(source.rays>0,'nonempty ray coverage required');await save();
    }
    const stats=a=>{a.sort((x,y)=>x-y);return {mean:a.reduce((x,y)=>x+y,0)/a.length,p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};};
    for(const [key,g] of groups){const {rgb,transmission,...counts}=g;report.summaries[key]={...counts,meanProbes:g.probes/g.rays,meanQueries:g.queries/g.rays,rgb:stats(rgb),transmission:stats(transmission)};}
    await output.close();output=null;
    report.output={path:path.join(out,'rays.jsonl'),sha256:await fileHash(path.join(out,'rays.jsonl'))};
    report.phase='complete';report.status='observed';
  }catch(error){report.status='failed';report.error=String(error.stack||error);}
  finally{
    if(output)try{await output.close();}catch(error){report.status='failed';report.error??=String(error.stack||error);}
    await save();
  }
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [manifest,training,out]=process.argv.slice(2);
  if(!manifest||!training||!out)throw new Error('usage: replay-smokey-heldout.mjs CAPTURE_REPORT TRAINING_REPORT OUTPUT_DIRECTORY');
  const result=await replayHeldout(manifest,training,out);
  console.log(JSON.stringify({status:result.status,phase:result.phase,error:result.error}));
  if(result.status==='failed')process.exitCode=1;
}
