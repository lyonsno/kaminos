import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateSkeletonMotion} from '../experiments/creature-motion/skeleton.experiment.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const inside=(base,target)=>{const p=path.relative(base,target);return p===''||p!=='..'&&!p.startsWith('..'+path.sep)&&!path.isAbsolute(p);};
// File publication is independent of GPU generation and can be replayed against
// an existing report. A live link is offered only after actual HTTP conformance.
export async function publishMotionView({reportPath,out=path.dirname(reportPath),origin=null,fetchImpl=globalThis.fetch}={}){
 out=path.resolve(out);await fs.mkdir(out,{recursive:true});out=await fs.realpath(out);
 const receipt={schema:'kaminos.motion-view-publication.v1',status:'unavailable',phase:'read-report',report:path.resolve(reportPath),recipe:path.join(out,'view.json'),url:null,origin,visualInspection:'not-performed',sources:[]};
 try{
  const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
  if(report.status!=='completed'||!report.cases?.length||report.cases.length!==report.requestedCases?.length||report.cases.some(c=>c.validation!=='accepted-schema'))throw Error('View requires every requested case in a completed batch');
  receipt.phase='authenticate-motion';const entries=[];
  for(let i=0;i<report.cases.length;i++){
   const c=report.cases[i],task=report.requestedCases[i],file=await fs.realpath(c.path),bytes=await fs.readFile(file),m=validateSkeletonMotion(JSON.parse(bytes));
   if(m.prompt!==task.text||m.seed!==task.seed||m.cfgScale!==(task.cfgScale??3)||m.assetCondSha256!==report.bundle.assetCondSha256)throw Error('Motion differs from requested batch source');
   const digest=sha(bytes),relative=path.relative(out,file).split(path.sep).join('/');
   entries.push({id:'motion-'+i,label:`${m.skeleton.name??'Skeleton'} · ${m.prompt}`,motion:relative,motion_sha256:digest});receipt.sources.push({path:file,sha256:digest,prompt:m.prompt,seed:m.seed,cfgScale:m.cfgScale,joints:m.joints,frames:m.frames});
  }
  const recipe={schema:'kaminos.skeleton-motion-view.v1',entries,presentation:'in-place',play:true,rate:1};
  const bytes=Buffer.from(JSON.stringify(recipe,null,2)+'\n');await fs.writeFile(receipt.recipe,bytes);receipt.recipeSha256=sha(bytes);receipt.status='files-only';receipt.phase='files-written';
  if(origin){
   receipt.status='unavailable';receipt.phase='mount';const server=new URL(origin);if(!['http:','https:'].includes(server.protocol))throw Error('View origin must be HTTP');
   const rootsResponse=await fetchImpl(new URL('/api/roots',server));if(!rootsResponse.ok)throw Error('View roots HTTP '+rootsResponse.status);const roots=await rootsResponse.json(),actual=await fs.realpath(receipt.recipe),matches=[];
   for(const [id,root] of Object.entries(roots)){if(!root.exists)continue;let base;try{base=await fs.realpath(root.path);}catch{continue;}if(inside(base,actual))matches.push({id,base});}
   matches.sort((a,b)=>b.base.length-a.base.length);if(!matches.length)throw Error('Batch output is not mounted in this Workbench');const mount=matches[0];receipt.mount=mount;
   const readURL=file=>{const u=new URL('/api/read',server);u.searchParams.set('root',mount.id);u.searchParams.set('path',path.relative(mount.base,file).split(path.sep).join('/'));return u;};
   receipt.phase='http-conformance';
   for(const [file,digest] of [[actual,receipt.recipeSha256],...receipt.sources.map(s=>[s.path,s.sha256])]){if(!inside(mount.base,file))throw Error('Motion source outside selected mount');const response=await fetchImpl(readURL(file),{cache:'no-store'});if(!response.ok)throw Error('View source HTTP '+response.status);if(sha(Buffer.from(await response.arrayBuffer()))!==digest)throw Error('View HTTP source digest mismatch');}
   const discoveryResponse=await fetchImpl(new URL('/api/workbench-experiments',server));if(!discoveryResponse.ok)throw Error('View discovery unavailable');const discovery=await discoveryResponse.json();
   if(!discovery.modules?.includes('/experiments/creature-motion/skeleton.experiment.mjs'))throw Error('Source motion viewer not registered in this Workbench');receipt.serverSource=discovery.source??null;
   const url=new URL('/index.html',server);url.searchParams.set('experiment','marionette/skeleton-motion');url.searchParams.set('experiment_inputs',JSON.stringify({recipe:readURL(actual).pathname+readURL(actual).search,recipe_sha256:receipt.recipeSha256}));receipt.url=url.href;receipt.status='link-verified';receipt.phase='complete';
  }
 }catch(e){receipt.status='unavailable';receipt.url=null;receipt.error=String(e.message??e);}
 receipt.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'view-publication.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined,reportPath=get('--report');if(!reportPath)throw Error('--report is required');
 const r=await publishMotionView({reportPath,out:get('--out'),origin:get('--origin')??process.env.KAMINOS_VIEW_ORIGIN??null});console.log(JSON.stringify(r,null,2));if(r.status==='unavailable')process.exitCode=1;
}
