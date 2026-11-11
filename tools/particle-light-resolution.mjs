// Offline held-population field-resolution comparison. No serving-path imports.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {runParticleLightWitness} from './particle-light-witness.mjs';
import {sampleLightPlane} from './particle-light-reference.mjs';
export function validateResolutionReports(records,widths){
 if(records.length!==widths.length||records.length<2)throw Error('Partial resolution comparison');
 const first=records[0];
 for(let i=0;i<records.length;i++){
  const r=records[i],n=widths[i];
  if(r.status!=='passed'||r.effectiveRoute!=='native-apple/particle-Gaussian-slab-deposit/opposite-interior-sweeps'||JSON.stringify(r.plan?.dims)!==JSON.stringify([n,n*1.5,n])||JSON.stringify(r.source)!==JSON.stringify(first.source))throw Error('Changed source, fallback route or substituted resolution');
  for(const key of ['origin','extent','direction','settings'])if(JSON.stringify(r.plan[key])!==JSON.stringify(first.plan[key]))throw Error('Changed physical field or settings');
  if(r.arms?.length!==2||!['open','wall'].every(name=>r.arms.some(a=>a.name===name&&a.recordsExact)))throw Error('Missing complete native arms');
 }
 return true;
}
const load=async(file,Type)=>{const b=await fs.readFile(file);return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
export function lightPlaneMetrics(coarse,fine,nx,ny,factor){
 if(!Number.isSafeInteger(factor)||factor<1||coarse.length!==nx*ny*4||fine.length!==coarse.length*factor*factor)throw Error('Nonregistered field comparison');
 const luminance=(a,i)=>a[4*i]*.2126+a[4*i+1]*.7152+a[4*i+2]*.0722,a=[],b=[];
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  a.push(luminance(coarse,x+nx*y));let sum=0;
  for(let j=0;j<factor;j++)for(let i=0;i<factor;i++)sum+=luminance(fine,x*factor+i+nx*factor*(y*factor+j));b.push(sum/(factor*factor));
 }
 const sum=v=>v.reduce((s,x)=>s+x,0),sa=sum(a),sb=sum(b),ma=sa/a.length,mb=sb/b.length;
 if(sa<=0||sb<=0||![...a,...b].every(v=>Number.isFinite(v)&&v>=0))throw Error('Blank or nonfinite resolution plane');
 let l1=0,cov=0,va=0,vb=0,logCov=0,logA=0,logB=0;const la=a.map(Math.log1p),lb=b.map(Math.log1p),mla=sum(la)/a.length,mlb=sum(lb)/b.length;
 for(let i=0;i<a.length;i++){l1+=Math.abs(a[i]-b[i]);cov+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2;logCov+=(la[i]-mla)*(lb[i]-mlb);logA+=(la[i]-mla)**2;logB+=(lb[i]-mlb)**2;}
 const centroid=v=>{let x=0,y=0;for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){x+=v[i+nx*j]*(-1+(i+.5)*2/nx);y+=v[i+nx*j]*(-1+(j+.5)*3/ny);}return [x/sum(v),y/sum(v)];},ca=centroid(a),cb=centroid(b);
 return {relativeL1:l1/sb,integratedRadianceRatio:sa/sb,linearCorrelation:va*vb?cov/Math.sqrt(va*vb):null,logCorrelation:logA*logB?logCov/Math.sqrt(logA*logB):null,coarseCentroid:ca,fineAreaAveragedCentroid:cb,centroidDistance:Math.hypot(ca[0]-cb[0],ca[1]-cb[1]),comparison:'fine plane area-averaged to coarse XY footprints; same world depth; no quality pass threshold'};
}
export async function runLightResolutionComparison(manifest,out){
 await fs.mkdir(out,{recursive:true});const report={schema:'kaminos.particle-light-resolution.v1',status:'running',phase:'identity',requested:manifest,lastTrustworthy:null,levels:[],planes:[],comparisons:[]};
 const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await save();
 try{
  if(!manifest.repoRoot||!manifest.expectedLightingCommit)throw Error('Explicit source root and lighting commit are required');
  report.effectiveSource={repoRoot:execFileSync('git',['-C',manifest.repoRoot,'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim(),head:execFileSync('git',['-C',manifest.repoRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['-C',manifest.repoRoot,'status','--porcelain'],{encoding:'utf8'}).trim()};
  if(report.effectiveSource.repoRoot!==manifest.repoRoot||report.effectiveSource.head!==manifest.expectedLightingCommit||report.effectiveSource.status)throw Error('Lighting source is dirty or differs from requested revision');
  const widths=manifest.widths,depths=manifest.depths;
  if(!Array.isArray(widths)||widths.length<2||widths.some((n,i)=>!Number.isSafeInteger(n)||n<2||n%2||(i&&(n<=widths[i-1]||n%widths[i-1]))))throw Error('Comparison needs increasing nested even widths');
  if(!Array.isArray(depths)||!depths.length||depths.some(z=>!Number.isFinite(z)||z<-1||z>1)||new Set(depths).size!==depths.length)throw Error('Invalid physical depth planes');
  report.lastTrustworthy='source revision verified';report.phase='native-fields';await save();
  for(const width of widths){
   const dir=path.join(out,'width-'+width),native=await runParticleLightWitness({snapshot:manifest.snapshot,capture:manifest.capture,sourceCommit:manifest.sourceCommit,out:dir,dims:[width,width*1.5,width],settings:{filterWidth:manifest.filterWidth??1}});
   report.levels.push({directory:dir,report:native});report.lastTrustworthy='native width '+width+' complete';await save();
  }
  validateResolutionReports(report.levels.map(l=>l.report),widths);report.phase='registered-planes';await save();
  const all=new Map();
  for(const level of report.levels){
   const dir=level.directory,r=level.report,{dims,origin,extent,direction}=r.plan,width=dims[0],c=await load(path.join(dir,'open.coefficients.f32'),Float32Array),positive=await load(path.join(dir,'open.positive.f32'),Float32Array),negative=await load(path.join(dir,'open.negative.f32'),Float32Array),solids=await load(path.join(dir,'open.solids.u32'),Uint32Array);
   if(!c.some((v,i)=>i%4===3&&v>0))throw Error('Extinction was not exercised');
   for(const depth of depths)for(const reverse of [false,true]){
    const values=sampleLightPlane({coefficients:c,positive,negative,solids,dims,origin,extent,direction,depth,reverse}),side=reverse?'negative':'positive',file=path.join(dir,'plane-'+depth+'-'+side+'.f64');
    if(!values.every(Number.isFinite))throw Error('Nonfinite registered physical plane');
    await fs.writeFile(file,new Uint8Array(values.buffer));const key=width+':'+depth+':'+side;all.set(key,values);report.planes.push({width,height:dims[1],depth,side,path:file,bytes:values.byteLength});
   }
  }
  for(let i=1;i<widths.length;i++)for(const depth of depths)for(const side of ['positive','negative']){
   const a=widths[i-1],b=widths[i];report.comparisons.push({coarseWidth:a,fineWidth:b,depth,side,...lightPlaneMetrics(all.get(a+':'+depth+':'+side),all.get(b+':'+depth+':'+side),a,a*1.5,b/a)});
  }
  report.status='passed';report.phase='complete';report.lastTrustworthy='all native fields and registered physical planes retained';report.qualityVerdict='Unassigned: inspect raw fixed-scale planes and numerical changes; command success is not spatial convergence.';report.claim='Fixed complete captured population, fixed bounds/settings and physical depth planes. Native spatial-resolution comparison; no temporal coherence or performance claim. Transverse footprint filter shrinks with receiver cell size.';
 }catch(error){report.status='failed';report.error=error.stack??String(error);throw error;}finally{await save();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [file,out]=process.argv.slice(2);if(!out)throw Error('Usage: particle-light-resolution.mjs manifest.json output-dir');await runLightResolutionComparison(JSON.parse(await fs.readFile(file)),out);}

