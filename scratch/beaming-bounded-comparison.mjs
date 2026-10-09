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

export function replayMaterial(primary,dimensions,kind){
  const [nx,ny,nz]=dimensions,source=new Float32Array(primary.length);
  const offsets=kind==='displaced'?[[6,8,-4,1]]:kind==='split'?[[-6,8,0,.5],[6,8,0,.5]]:[[0,0,0,1]];
  let sum=0,center=[0,0,0],variance=[0,0,0];
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const i=(x+nx*(y+ny*z))*4;source[i+3]=primary[i+3];
    for(const [dx,dy,dz,weight]of offsets){const from=(((x-dx+nx)%nx)+nx*(((y-dy+ny)%ny)+ny*((z-dz+nz)%nz)))*4;for(let c=0;c<3;c++)source[i+c]+=weight*primary[from+c];}
    const w=source[i]+source[i+1]+source[i+2],p=[x,y,z].map(v=>-1+(v+.5)*2/nx);sum+=w;for(let a=0;a<3;a++)center[a]+=w*p[a];
  }
  assert(sum>0,'material replay requires nonblank emission');center=center.map(v=>v/sum);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const i=(x+nx*(y+ny*z))*4,w=source[i]+source[i+1]+source[i+2];for(let a=0;a<3;a++)variance[a]+=w*(-1+([x,y,z][a]+.5)*2/nx-center[a])**2/sum;}
  const radius=variance.map(v=>Math.max(2/nx,2*Math.sqrt(v)));
  const guide={lo:center.map((v,a)=>Math.max(-1,v-radius[a])),hi:center.map((v,a)=>Math.min(a===1?3:1,v+radius[a])),effective:'offline-emission-moments',reason:'replay-only; not a live GPU proposal builder'};
  return {source,guide,metadata:{kind,offsets,emissionSum:sum,center,variance,extinction:'held original',boundary:'periodic RGB translation',proposal:'all-cell CPU emission moments, full-volume mixture retained'}};
}

export async function runVisibilityComparison({page,out,report,save,iterations,capture,broken,candidate='source-volume'}){
  const occupancy=candidate==='occupancy';
  report.claim=occupancy?'paired full-scene occupancy visibility experiment; fixed burner, offline displaced/split emission replay; visible flame held; no production source discovery or whole-frame claim':'paired source-volume-exit visibility cost and lighting parity; held material, prescribed guide; no live emission-discovery or whole-frame claim';
  report.phase='paired-visibility';report.pairs=[];report.timing={valid:0,invalid:0};await save();
  let preparations=capture.lighting.frame.angularCache.visibilityPreparations;
  const replays=occupancy?['original','displaced','split'].map(kind=>replayMaterial(capture.primary,capture.sourceMetadata.dimensions,kind)):[];
  report.replays=replays.map(r=>({guide:r.guide,...r.metadata}));
  for(const r of replays)await fs.writeFile(`${out}/replay-${r.metadata.kind}-source.f32`,Buffer.from(r.source.buffer));
  await page.evaluate(()=>{window.__beamingOriginalCapture=window.__beamingCurrentGather;});
  // Begin opposite the first measured mode; every measured arm must refresh.
  await page.evaluate(()=>window.__beamingCurrentGather.api.setVisibilityBounds('source-volume'));
  for(let i=0;i<iterations;i++){
    const replay=occupancy?replays[i%replays.length]:null;
    const guide=replay?.guide??{lo:[-.7+.04*(i%8),-1,-.7],hi:[.65+.04*(i%8),1.44,.7]};
    const generation=occupancy?capture.sourceGeneration+1+i%replays.length:capture.sourceGeneration;
    if(occupancy)await page.evaluate(({source,generation})=>{
      const {field}=window.__beamingOriginalCapture,device=window.__beamingGatherDevice;
      if(!window.__beamingReplayTexture)window.__beamingReplayTexture=device.createTexture({size:field.dimensions,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.TEXTURE_BINDING});
      device.queue.writeTexture({texture:window.__beamingReplayTexture},new Float32Array(source),{bytesPerRow:field.dimensions[0]*16,rowsPerImage:field.dimensions[1]},field.dimensions);
      window.__beamingReplayField={...field,texture:window.__beamingReplayTexture,generation,scatteringGeneration:generation};
    },{source:Array.from(replay.source),generation});
    if(occupancy&&i===0){
      // A new source texture rebinds the existing scattering-source consumer.
      // Pay and receipt that one-time replay installation before recurring work;
      // the same replay texture remains bound throughout all measured pairs.
      report.replaySetup=await page.evaluate(async()=>{
        const {api,options}=window.__beamingOriginalCapture,device=window.__beamingGatherDevice;
        const before=window.__beamingAllocations.pipelines.length,start=performance.now();
        const metadata=api.encode(window.__beamingReplayField,options);
        await device.queue.onSubmittedWorkDone();
        return {metadata,submitAndCompleteMs:performance.now()-start,newPipelines:window.__beamingAllocations.pipelines.slice(before),reason:'one-time replacement of live source texture with stable replay texture'};
      });
      preparations=report.replaySetup.metadata.angularCache.visibilityPreparations;await save();
    }
    const pair={index:i,guide,material:replay?.metadata.kind??'held',generation,arms:[],parity:null};report.pairs.push(pair);await save();
    const fields=[];
    for(const mode of ['unbounded',candidate]){
      const sample=await Promise.race([page.evaluate(async({mode,guide,readFields})=>{
        const {api,options}=window.__beamingOriginalCapture,field=window.__beamingReplayField??window.__beamingOriginalCapture.field,device=window.__beamingGatherDevice;
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
      // Preserve observed bytes even if route/resource/timing admission rejects
      // this arm. The report retains the effective identity and failure phase.
      if(fields.at(-1))for(const [name,field] of Object.entries(fields.at(-1)))await fs.writeFile(`${out}/pair-${i}-${mode}-${name}.f32`,Buffer.from(new Float32Array(field.data).buffer));
      const valid=validateVisibilitySample(sample,{mode,generation,preparations:++preparations});
      report.timing[valid?'valid':'invalid']++;
      if(occupancy&&i<3){await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});await page.screenshot({path:`${out}/lighting-only-${pair.material}-${mode}.png`});}
    }
    // Eight distinct guide states, each full surface-front/back and smoke field.
    if(i<8){
      pair.parity={};
      for(const name of ['surface','surfaceBack','smoke']){
        assert.deepEqual(fields[0][name].dimensions,fields[1][name].dimensions);
        const a=fields[0][name].data,b=fields[1][name].data;assert.equal(a.length,b.length);assert(a.length>0);
        let maxError=0,scale=0,nonzero=0,squaredError=0,squaredReference=0,referenceSum=0,candidateSum=0;
        for(let j=0;j<a.length;j++){assert(Number.isFinite(a[j])&&Number.isFinite(b[j]));if(j%4!==3){maxError=Math.max(maxError,Math.abs(a[j]-b[j]));scale=Math.max(scale,Math.abs(a[j]));if(a[j]!==0)nonzero++;squaredError+=(a[j]-b[j])**2;squaredReference+=a[j]**2;referenceSum+=a[j];candidateSum+=b[j];}}
        pair.parity[name]={maxError,scale,nonzero,values:a.length,relativeL2:Math.sqrt(squaredError/Math.max(squaredReference,1e-30)),energyRatio:candidateSum/Math.max(referenceSum,1e-30)};await save();
        if(!occupancy)assert(maxError<=2e-5*Math.max(1,scale),'bounded/unbounded field mismatch '+name);
        if(name!=='surfaceBack')assert(nonzero>0,'blank primary field '+name);
      }
    }
    await save();
  }
  report.phase='restore-accepted-guide';await save();
  await page.evaluate(async guide=>{const {api,field,options}=window.__beamingOriginalCapture;api.setVisibilityBounds('unbounded');api.setSourceGuide(guide);api.encode(field,options);await window.__beamingGatherDevice.queue.onSubmittedWorkDone();window.__beamingReplayTexture?.destroy();},capture.lighting.frame.sourceGuide);
  report.timing.status=report.timing.invalid?'partial-invalid-timestamps-preserved':'complete';
}
