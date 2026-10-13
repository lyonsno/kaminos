import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {frozenOpticalPredictor} from '../volume-optical-refinement.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
async function fileHash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}

export async function checkFrozenPredictions(trainingPath,out) {
  await fs.mkdir(out,{recursive:true});
  const report={identity:'optical-frozen-prediction-conformance-v1',status:'running',phase:'training',
    effectiveRoute:'node-cpu-float32-boundaries-double-dot-products',models:[],
    claim:'numeric differences from retained MLX GPU predictions; not bitwise equivalence, controller equivalence or held-out generalization',
    thresholds:[.0001,.0003,.001,.003,.01,.03]};
  const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await save();
  try {
    report.source=execFileSync('git',['rev-parse','HEAD'],{cwd:import.meta.dirname,encoding:'utf8'}).trim();
    report.diff=execFileSync('git',['diff','HEAD'],{cwd:import.meta.dirname,encoding:'utf8'});
    const raw=await fs.readFile(trainingPath),training=JSON.parse(raw);
    report.training={path:trainingPath,sha256:sha(raw)};
    assert.ok(training.identity==='optical-quantile-pilot-v0'&&training.status==='trained'&&training.phase==='complete','complete training required');
    assert.ok(training.backend?.name==='mlx'&&/gpu/i.test(training.backend.device),'original MLX GPU predictions required');
    assert.ok(Array.isArray(training.models)&&training.models.length>0,'nonempty models required');
    assert.equal(new Set(training.models.map(m=>m.probeCount)).size,training.models.length,'duplicate model');
    for(const model of training.models) {
      report.phase=`inputs-${model.probeCount}`;await save();
      const rawModel=await fs.readFile(model.artifact.path);assert.equal(sha(rawModel),model.artifact.sha256,'model hash mismatch');
      const artifact=JSON.parse(rawModel);assert.equal(artifact.probeCount,model.probeCount);
      const predict=frozenOpticalPredictor(artifact);
      assert.equal(await fileHash(model.dataset.path),model.dataset.sha256,'dataset hash mismatch');
      const reference=await fs.readFile(model.predictions.path);
      assert.equal(sha(reference),model.predictions.sha256,'prediction hash mismatch');
      assert.ok(Number.isSafeInteger(model.predictions.rows)&&model.predictions.rows>0,'nonempty predictions required');
      assert.equal(reference.length,model.predictions.rows*16,'prediction byte count mismatch');
      const result={probeCount:model.probeCount,artifact:model.artifact,dataset:model.dataset,predictions:model.predictions,
        rows:0,maxAbsolute:0,maxRelative:0,absoluteSum:0,nonidentical:0,thresholdDisagreements:0,worst:null};
      report.models.push(result);report.phase=`compare-${model.probeCount}`;await save();
      const lines=createInterface({input:createReadStream(model.dataset.path),crlfDelay:Infinity});
      for await(const line of lines) {
        assert.ok(result.rows<model.predictions.rows,'more dataset rows than predictions');
        const row=JSON.parse(line),actual=predict(row.features);
        actual.forEach((value,c)=>{
          const expected=reference.readFloatLE(result.rows*16+c*4);
          assert.ok(Number.isFinite(expected)&&expected>=0,'invalid original prediction');
          const delta=Math.abs(value-expected),relative=delta/Math.max(Math.abs(expected),Math.abs(value),Number.MIN_VALUE);
          result.nonidentical+=Number(delta!==0);result.absoluteSum+=delta;
          if(delta>result.maxAbsolute){result.maxAbsolute=delta;result.worst={row:result.rows,channel:c,expected,actual:value,case:row.case,chunk:row.chunk,ray:row.ray,start:row.start,end:row.end};}
          result.maxRelative=Math.max(result.maxRelative,relative);
          result.thresholdDisagreements+=report.thresholds.reduce((sum,t)=>sum+Number((value>t)!==(expected>t)),0);
        });
        result.rows++;
      }
      assert.equal(result.rows,model.predictions.rows,'fewer dataset rows than predictions');
      result.meanAbsolute=result.absoluteSum/(result.rows*4);await save();
    }
    report.phase='complete';report.status='observed';
  }catch(error){report.status='failed';report.error=String(error.stack||error);}
  finally{await save();}
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [training,out]=process.argv.slice(2);
  if(!training||!out)throw new Error('usage: check-optical-frozen-predictor.mjs TRAINING_REPORT OUTPUT_DIRECTORY');
  const report=await checkFrozenPredictions(training,out);
  console.log(JSON.stringify({status:report.status,phase:report.phase,models:report.models}));
  if(report.status==='failed')process.exitCode=1;
}
