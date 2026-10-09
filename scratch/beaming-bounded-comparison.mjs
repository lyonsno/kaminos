// Paired extension of the existing registered-kiln witness, not a new host.
// Held material + prescribed moving guide; no actual-emission discovery claim.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

export function validateVisibilitySample(sample,{mode,generation,preparations}){
  assert.equal(sample.metadata.visibilityBounds,mode,'requested visibility route must be effective');
  assert.equal(sample.metadata.generation,generation,'held source generation changed');
  assert.equal(sample.metadata.directions,8);assert.equal(sample.metadata.angularPattern,'guided');
  assert.deepEqual(sample.metadata.angularCache.counts,[8],'hidden allocated capacity');
  assert.equal(sample.metadata.angularCache.visibilityPreparations,preparations,'stale visibility');
  assert.equal(sample.after.encodes,sample.before.encodes+1,'background gather interleaving');
  for(const key of ['pipelines','rayBuffers'])assert.equal(sample.after[key],sample.before[key],'resource recreation');
  assert.equal(sample.profile.records.length,1,'missing primary timing record');
  const record=sample.profile.records[0];
  assert.equal(record.passes.filter(p=>p.label==='static kiln visibility preparation').length,1);
  if(record.valid){assert.deepEqual(sample.profile.errors,[]);assert(Number.isFinite(record.totalMs)&&record.totalMs>0);}
  else {assert.equal(record.totalMs,null);assert(record.passes.every(p=>p.ms===null),'invalid timestamps became costs');}
  return record.valid;
}

export async function runVisibilityComparison({page,out,report,save,iterations,capture,broken}){
  report.claim='paired source-volume-exit visibility cost and lighting parity; held material, prescribed guide; no live emission-discovery or whole-frame claim';
  report.phase='paired-visibility';report.pairs=[];report.timing={valid:0,invalid:0};await save();
  let preparations=capture.lighting.frame.angularCache.visibilityPreparations;
  // Begin opposite the first measured mode; every measured arm must refresh.
  await page.evaluate(()=>window.__beamingCurrentGather.api.setVisibilityBounds('source-volume'));
  for(let i=0;i<iterations;i++){
    const guide={lo:[-.7+.04*(i%8),-1,-.7],hi:[.65+.04*(i%8),1.44,.7]};
    const pair={index:i,guide,arms:[],parity:null};report.pairs.push(pair);await save();
    const fields=[];
    for(const mode of ['unbounded','source-volume']){
      const sample=await Promise.race([page.evaluate(async({mode,guide,readFields})=>{
        const {api,field,options}=window.__beamingCurrentGather,device=window.__beamingGatherDevice;
        if(!device.features.has('timestamp-query'))throw Error('native timestamps unavailable');
        const counts=()=>({encodes:window.__beamingEncodeCount,pipelines:window.__beamingAllocations.pipelines.length,rayBuffers:window.__beamingAllocations.buffers.filter(b=>b.label==='cached first solid distance per receiver ray').length});
        const before=counts(),profile=window.__beamingGatherProfile={remaining:1,records:[],errors:[]},start=performance.now();
        api.setVisibilityBounds(mode);api.setSourceGuide(guide);const metadata=api.encode(field,options),encodeMs=performance.now()-start;
        await device.queue.onSubmittedWorkDone();const submitAndCompleteMs=performance.now()-start;
        while(!profile.records.length&&!profile.errors.length)await new Promise(r=>setTimeout(r,1));
        const result={metadata,profile,before,after:counts(),encodeMs,submitAndCompleteMs};
        if(readFields)result.fields=Object.fromEntries(Object.entries(await api.readback()).map(([k,v])=>[k,{dimensions:v.dimensions,data:Array.from(v.data)}]));
        return result;
      },{mode,guide,readFields:i<8}),broken]);
      fields.push(sample.fields);delete sample.fields;pair.arms.push({mode,...sample});await save();
      const valid=validateVisibilitySample(sample,{mode,generation:capture.sourceGeneration,preparations:++preparations});
      report.timing[valid?'valid':'invalid']++;
      if(fields.at(-1))for(const [name,field] of Object.entries(fields.at(-1)))await fs.writeFile(`${out}/pair-${i}-${mode}-${name}.f32`,Buffer.from(new Float32Array(field.data).buffer));
    }
    // Eight distinct guide states, each full surface-front/back and smoke field.
    if(i<8){
      pair.parity={};
      for(const name of ['surface','surfaceBack','smoke']){
        assert.deepEqual(fields[0][name].dimensions,fields[1][name].dimensions);
        const a=fields[0][name].data,b=fields[1][name].data;assert.equal(a.length,b.length);assert(a.length>0);
        let maxError=0,scale=0,nonzero=0;
        for(let j=0;j<a.length;j++){assert(Number.isFinite(a[j])&&Number.isFinite(b[j]));if(j%4!==3){maxError=Math.max(maxError,Math.abs(a[j]-b[j]));scale=Math.max(scale,Math.abs(a[j]));if(a[j]!==0)nonzero++;}}
        pair.parity[name]={maxError,scale,nonzero,values:a.length};await save();
        assert(maxError<=2e-5*Math.max(1,scale),'bounded/unbounded field mismatch '+name);
        if(name!=='surfaceBack')assert(nonzero>0,'blank primary field '+name);
      }
    }
    await save();
  }
  report.phase='restore-accepted-guide';await save();
  await page.evaluate(async guide=>{const {api,field,options}=window.__beamingCurrentGather;api.setVisibilityBounds('unbounded');api.setSourceGuide(guide);api.encode(field,options);await window.__beamingGatherDevice.queue.onSubmittedWorkDone();},capture.lighting.frame.sourceGuide);
  report.timing.status=report.timing.invalid?'partial-invalid-timestamps-preserved':'complete';
}
