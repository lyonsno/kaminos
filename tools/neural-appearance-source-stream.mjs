// kaminos-test: manual — Greenroom geometric source service for fresh optimizer batches.
import fs from 'node:fs/promises';import path from 'node:path';import readline from 'node:readline';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [configPath,out,resumePath]=process.argv.slice(2);if(!out)throw Error('Caller-owned source output required');await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'admission',job:process.env.GREENROOM_JOB_ID,requests:[]},save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await save();const hash=b=>createHash('sha256').update(b).digest('hex'),send=value=>process.stdout.write(JSON.stringify(value)+'\n');console.log=(...values)=>console.error(...values);
try{
 if(!report.job)throw Error('Greenroom admission required');report.sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(report.sourceCommit!==process.env.EXPECTED_COMMIT||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Pinned clean source required');
 const bytes=await fs.readFile(configPath),config=JSON.parse(bytes),c=config.capture,fit=config.fit;report.configHash=hash(bytes);report.config=config;report.nodeRuntime={executable:process.execPath,version:process.version};
 if(c.directionalSampling!=='UniformRusinkiewicz')throw Error('This stream requires the explicit supported UniformRusinkiewicz alternative');
 report.teacherCommit=execFileSync('git',['-C',c.teacherRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();if(report.teacherCommit!==c.teacherCommit||execFileSync('git',['-C',c.teacherRoot,'status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Pinned clean teacher required');
 const sourceBytes=await fs.readFile(c.sourcePath);report.sourceHash=hash(sourceBytes);if(report.sourceHash!==c.sourceSha256)throw Error('Source digest mismatch');const source=JSON.parse(sourceBytes);if(source.config.width!==source.config.depth)throw Error('Square material chart required');await fs.writeFile(path.join(out,'source.json'),sourceBytes);
 const {withKaminosGpu,withGpuErrorScopes}=await import('./shader-herder.mjs'),{publishedQueryBatch}=await import('../neural-appearance-training-recipe.mjs'),{createAppearanceDirectionCapture}=await import('../neural-appearance-direction-capture.mjs'),{SurfaceMaterialTeacher}=await import(pathToFileURL(path.join(c.teacherRoot,'surface-material-teacher.mjs'))),{SURFACE_TEACHER_COMMON_WGSL}=await import(pathToFileURL(path.join(c.teacherRoot,'surface-teacher-wgsl.mjs')));
 const resumed=resumePath?JSON.parse(await fs.readFile(resumePath,'utf8')):null;
 if(resumed&&(resumed.sourceCommit!==report.sourceCommit||resumed.configHash!==report.configHash||resumed.sourceHash!==report.sourceHash))throw Error('Resume source/config identity changed');
 const randomStates=resumed?{...resumed.sourceStates}:{training:(c.seed??41)>>>0,heldout:(c.heldoutSeed??((c.seed??41)+1))>>>0},seen=new Set();
 if(!['training','heldout'].every(k=>Number.isSafeInteger(randomStates[k])&&randomStates[k]>=0&&randomStates[k]<=0xffffffff))throw Error('Complete uint32 source RNG state required');
 report.initialStates={...randomStates};
 await withKaminosGpu(async({device,adapterInfo})=>{
  report.adapter=adapterInfo;if(adapterInfo.isFallbackAdapter)throw Error('Hardware reference required');const teacher=new SurfaceMaterialTeacher(device,{...source,lights:[],environment:0,bounces:c.bounces??3}),capture=createAppearanceDirectionCapture(teacher,SURFACE_TEACHER_COMMON_WGSL);
  const identity={sourceCommit:report.sourceCommit,sourceHash:report.sourceHash,route:'hardware',isFallbackAdapter:false};
  try{
   report.phase='waiting-request';await save();send({schema:'kaminos.appearance-source-ready.v1',...identity,adapter:adapterInfo,configHash:report.configHash,teacherCommit:report.teacherCommit,queryLayout:'UV/viewXYZ/lightXYZ',response:'projected-bsdf',sourceStates:{...randomStates}});
   for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
    let request;try{
     request=JSON.parse(line);if(!Number.isSafeInteger(request.id)||request.id<0||seen.has(request.id)||!['training','heldout'].includes(request.kind)||!Number.isSafeInteger(request.batchSize)||request.batchSize<1||!Number.isSafeInteger(request.batches)||request.batches<1||!Number.isSafeInteger(request.batchSize*request.batches))throw Error('Unique ID and valid complete source batches required');seen.add(request.id);
     const count=request.batchSize*request.batches,seedBefore=randomStates[request.kind],random=()=>{randomStates[request.kind]=(Math.imul(randomStates[request.kind],1664525)+1013904223)>>>0;return(randomStates[request.kind]+.5)/4294967296;};
     report.phase='generating';report.active=request;await save();const queries=publishedQueryBatch(count,random,{batchSize:request.batchSize,resolution:fit.resolution,snapToTexelCenter:true}),seedAfter=randomStates[request.kind],samples=request.kind==='heldout'?(c.heldoutSamples??32):(c.samples??8);
     const sampleSeed=((c.seed??41)+request.id)>>>0;const labels=await withGpuErrorScopes(device,'fresh-'+request.id,()=>capture.evaluate(queries,{tileSize:source.config.width,referenceHeight:source.referenceHeight,resolution:fit.resolution,samples,seed:sampleSeed}));
     const dir=path.join(out,'blocks',String(request.id));await fs.mkdir(dir,{recursive:true});const store=async(name,array)=>{const payload=Buffer.from(array.buffer,array.byteOffset,array.byteLength),file=path.join(dir,name+'.f32');await fs.writeFile(file,payload);return {path:file,sha256:hash(payload),bytes:payload.length};};
     const result={schema:'kaminos.appearance-source-batch.v1',id:request.id,kind:request.kind,rows:count,batchSize:request.batchSize,batches:request.batches,...identity,seedBefore,seedAfter,sampleSeed,samples,queries:await store('queries',queries),labels:await store('labels',labels)};
     report.requests.push(result);report.active=null;report.phase='waiting-request';await save();send(result);
    }catch(error){report.phase='request-failed';report.error=error.stack;report.failedRequest=request??line;await save();send({schema:'kaminos.appearance-source-error.v1',id:request?.id,error:error.message,...identity});throw error;}
   }
  }finally{teacher.dispose();}
 },{onEvidence:e=>{report.evidence=e;}});report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error.stack);}finally{await save();}
