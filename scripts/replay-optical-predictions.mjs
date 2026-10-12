import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {validateTraceRows} from '../volume-optical-trace.mjs';
import {buildOpticalHierarchy,refineOpticalHierarchy} from '../volume-optical-refinement.mjs';

export function compareRayPolicies(tree,predictError,calibration,thresholds) {
  const nodes=new Map(),pending=[...tree.roots];
  while(pending.length){const n=pending.pop();nodes.set(`${n.start}:${n.end}`,n);pending.push(...n.children);}
  const results=[];
  for(const tolerance of thresholds) {
    if(!Number.isFinite(tolerance)||tolerance<=0)throw new Error('positive finite tolerance required');
    for(const policy of ['numerical','predicted','teacher-informed']) {
      let predictionQueries=0;
      const result=refineOpticalHierarchy(tree,{policy,tolerances:Array(4).fill(tolerance),calibration,
        predictError:observed=>{predictionQueries++;return predictError(observed);}});
      let brightSegments=0,missedBrightSegments=0,missedOtherSegments=0;
      for(const accepted of result.accepted) {
        const node=nodes.get(`${accepted.start}:${accepted.end}`);
        const bright=node.teacher.slice(0,3).some(v=>Math.abs(v)>.001);
        const missed=!accepted.needsRefinement&&node.teacherError.some(v=>accepted.incoming*v>tolerance);
        brightSegments+=Number(bright);
        missedBrightSegments+=Number(bright&&missed);missedOtherSegments+=Number(!bright&&missed);
      }
      results.push({...result,tolerance,predictionQueries,brightSegments,missedBrightSegments,missedOtherSegments});
    }
  }
  return results;
}

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileHash(file) {
  const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');
}

async function main() {
  const [trainingPath,out,thresholdText='0.0001,0.0003,0.001,0.003,0.01,0.03']=process.argv.slice(2);
  await fs.mkdir(out,{recursive:true});
  const thresholds=thresholdText.split(',').map(Number);
  const report={identity:'optical-prediction-controller-pilot-v0',status:'running',phase:'training',thresholds,
    claim:'offline same-observation controller replay; finite reference, three scanlines, not image quality or GPU speed',
    effectiveRoute:'cpu-shared-optical-controller-with-saved-mlx-predictions',summaries:{},arms:[]};
  const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  let output;
  await save();
  try {
    report.source=execFileSync('git',['rev-parse','HEAD'],{cwd:import.meta.dirname,encoding:'utf8'}).trim();
    report.diff=execFileSync('git',['diff','HEAD'],{cwd:import.meta.dirname,encoding:'utf8'});
    const bytes=await fs.readFile(trainingPath),training=JSON.parse(bytes);
    report.training={path:trainingPath,sha256:sha(bytes)};
    assert.ok(training.identity==='optical-quantile-pilot-v0'&&training.status==='trained'&&training.phase==='complete','complete trained pilot required');
    assert.equal(training.backend.name,'mlx');assert.match(training.backend.device,/gpu/i);
    assert.deepEqual(training.models.map(m=>m.probeCount).sort(),[3,5]);
    assert.ok(thresholds.length>0&&thresholds.every(v=>Number.isFinite(v)&&v>0),'positive finite tolerances required');
    report.phase='dataset';await save();
    const raw=await fs.readFile(training.dataset.path);assert.equal(sha(raw),training.dataset.sha256,'dataset report hash mismatch');
    const dataset=JSON.parse(raw);report.dataset=training.dataset;
    assert.ok(dataset.identity==='optical-probe-dataset-v0'&&dataset.status==='observed'&&dataset.phase==='complete','complete dataset required');
    assert.ok(Array.isArray(dataset.sources)&&dataset.sources.length>0&&
      dataset.sources.every(s=>Number.isSafeInteger(s.rays)&&s.rays>=0)&&
      dataset.sources.reduce((sum,s)=>sum+s.rays,0)>0,'nonempty source population required');
    report.phase='outputs';await save();output=await fs.open(path.join(out,'rays.jsonl'),'w');
    const groups=new Map();
    for(const model of training.models) {
      const n=model.probeCount,source=dataset.files.find(f=>f.probeCount===n);
      report.phase=`predictions-${n}`;await save();
      const factors=model.numericalCalibration?.factors;
      assert.ok(Array.isArray(factors)&&factors.length===4&&
        [0,1,2,3].every(c=>Number.isFinite(factors[c])&&factors[c]>=0),'explicit numerical calibration requires four finite nonnegative factors');
      assert.ok(Number.isSafeInteger(model.predictions.rows)&&model.predictions.rows>0,'positive prediction row count required');
      assert.ok(source&&source.sha256===model.dataset.sha256,'prediction dataset identity mismatch');
      assert.equal(await fileHash(source.path),source.sha256,'dataset bytes changed');
      const binary=await fs.readFile(model.predictions.path);
      assert.equal(sha(binary),model.predictions.sha256,'prediction hash mismatch');
      assert.equal(binary.length,model.predictions.rows*16,'prediction row count mismatch');
      const arm={probeCount:n,predictions:model.predictions,dataset:source,rays:0,rows:0};report.arms.push(arm);
      const seen=new Set();let batch=[],lastKey=null,cachedChunk=null;
      const replay=async()=>{
        if(!batch.length)return;
        const first=batch[0],key=JSON.stringify([first.case,first.chunk,first.ray]);
        assert.ok(!seen.has(key),'noncontiguous or duplicate ray');seen.add(key);
        const chunkKey=JSON.stringify([first.case,first.chunk]);
        if(cachedChunk?.key!==chunkKey) {
          const source=dataset.sources.find(s=>`${s.step}:${s.yaw}`===first.case);assert.ok(source,'unknown capture case');
          const raw=await fs.readFile(source.path);assert.equal(sha(raw),source.sha256,'capture report changed');
          const capture=JSON.parse(raw),chunk=capture.chunks.find(c=>c.path===first.chunk);assert.ok(chunk,'unknown trace chunk');
          const rawTrace=await fs.readFile(path.join(path.dirname(source.path),chunk.path));
          assert.equal(sha(rawTrace),chunk.sha256,'trace hash mismatch');
          const values=new Float32Array(rawTrace.buffer,rawTrace.byteOffset,rawTrace.byteLength/4);validateTraceRows(values,chunk.plan);
          cachedChunk={key:chunkKey,source,chunk,values};
        }
        const {source:origin,chunk,values}=cachedChunk,ray=first.ray-chunk.plan.firstRay;
        assert.equal(first.split,origin.split,'split mismatch');
        assert.ok(Number.isInteger(ray)&&ray>=0&&ray<chunk.plan.rayCount,'ray outside trace');
        const count=chunk.plan.sampleCount,base=ray*count*32,length=values[base+6]-values[base+5];
        assert.equal(values[base+2],1);assert.ok(length>0,'nonpositive ray length');
        const probes=Array.from({length:count},(_,s)=>{
          const at=base+s*32;return {sigma:values[at+16],emission:Array.from(values.slice(at+17,at+20)),
            scattered:Array.from(values.slice(at+20,at+23)),flags:[values[at+23],values[at+24]]};
        });
        const tree=buildOpticalHierarchy(probes,{length,rootSpan:dataset.rootSpan,probeCount:n});
        const predictions=new Map();
        for(const row of batch) {
          const nodeKey=`${row.start}:${row.end}`;assert.ok(!predictions.has(nodeKey),'duplicate segment prediction');
          assert.equal(row.split,first.split);predictions.set(nodeKey,row.prediction);
        }
        const pending=[...tree.roots];let nodeCount=0;
        while(pending.length){const node=pending.pop();assert.ok(predictions.has(`${node.start}:${node.end}`),'missing segment prediction');nodeCount++;pending.push(...node.children);}
        assert.equal(predictions.size,nodeCount,'unexpected segment prediction');
        const prediction=({start,h})=>predictions.get(`${start}:${start+Math.round(h/tree.spacing)}`);
        const records=compareRayPolicies(tree,prediction,model.numericalCalibration.factors,thresholds).map(result=>{
          const entry={case:first.case,split:first.split,chunk:first.chunk,ray:first.ray,probeCount:n,...result};
          const groupKey=`${n}:${first.split}:${result.policy}:${result.tolerance}`;
          const group=groups.get(groupKey)??{rays:0,probes:0,queries:0,rgb:[],transmission:[],brightSegments:0,missedBrightSegments:0,missedOtherSegments:0,unresolvedLeafCount:0,unresolvedReferenceCount:0};
          group.rays++;group.probes+=result.uniqueProbeCount;group.queries+=result.predictionQueries;
          group.rgb.push(Math.max(...result.error.slice(0,3)));group.transmission.push(result.error[3]);
          for(const key of ['brightSegments','missedBrightSegments','missedOtherSegments','unresolvedLeafCount','unresolvedReferenceCount'])group[key]+=result[key];
          groups.set(groupKey,group);return JSON.stringify(entry)+'\n';
        });
        await output.writeFile(records.join(''));arm.rays++;batch=[];
      };
      const lines=createInterface({input:createReadStream(source.path),crlfDelay:Infinity});
      for await(const line of lines) {
        const row=JSON.parse(line),key=JSON.stringify([row.case,row.chunk,row.ray]);
        if(lastKey!==null&&key!==lastKey)await replay();
        assert.ok(arm.rows<model.predictions.rows,'more dataset rows than predictions');
        row.prediction=Array.from({length:4},(_,c)=>binary.readFloatLE(arm.rows*16+c*4));
        assert.ok(row.prediction.every(v=>Number.isFinite(v)&&v>=0),'invalid saved prediction');
        batch.push(row);lastKey=key;arm.rows++;
      }
      await replay();assert.equal(arm.rows,model.predictions.rows,'fewer dataset rows than predictions');
      assert.ok(arm.rows>0&&arm.rays>0,'nonempty replay required');
      assert.equal(arm.rays,dataset.sources.reduce((sum,s)=>sum+s.rays,0),'incomplete ray coverage');
    }
    for(const [key,g] of groups) {
      const stats=values=>{values.sort((a,b)=>a-b);return {mean:values.reduce((a,b)=>a+b,0)/values.length,p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)};};
      const {rgb,transmission,...counts}=g;
      report.summaries[key]={...counts,meanProbes:g.probes/g.rays,meanQueries:g.queries/g.rays,rgb:stats(rgb),transmission:stats(transmission)};
    }
    await output.close();output=null;
    report.output={path:path.join(out,'rays.jsonl'),sha256:await fileHash(path.join(out,'rays.jsonl'))};
    report.phase='complete';report.status='observed';
  }catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
  finally {
    if(output)try{await output.close();}catch(error){report.status='failed';report.error??=String(error.stack||error);process.exitCode=1;}
    await save();
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
