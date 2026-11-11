#!/usr/bin/env node
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {build} from 'esbuild';
const execute=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');

export async function buildSceneWorkerBundle({repoRoot,out,reportPath}={}){
 if(!repoRoot)throw Error('Worker build requires an explicit repoRoot');
 repoRoot=resolve(repoRoot);out=resolve(out??join(repoRoot,'scene-worker.entry.bundle.mjs'));reportPath=resolve(reportPath??out+'.build.json');
 const report={status:'building',repoRoot,out,sourceEntry:join(repoRoot,'scene-worker.entry.mjs'),failurePhase:'inputs',outputSha256:null,inputs:[]};
 const save=async()=>{await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');};
 try{
  await stat(report.sourceEntry);await stat(join(repoRoot,'index.html'));await save();
  report.failurePhase='control-definitions';
  const result=await execute('python3',[join(repoRoot,'tools/scene-worker-control-definitions.py'),'--page',join(repoRoot,'index.html')]);
  const definitions=JSON.parse(result.stdout);if(!definitions.controls||!Object.keys(definitions.controls).length)throw Error('Page control definitions are empty');
  report.controlSourceSha256=definitions.source.sha256;report.controlCount=Object.keys(definitions.controls).length;
  report.failurePhase='bundle';
  const built=await build({absWorkingDir:repoRoot,entryPoints:[report.sourceEntry],outfile:out,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,metafile:true,external:['node:*'],
   plugins:[{name:'worker-page-controls',setup(bundler){
    bundler.onResolve({filter:/^kaminos:worker-control-definitions$/},()=>({path:'page-controls',namespace:'worker-page-controls'}));
    bundler.onLoad({filter:/.*/,namespace:'worker-page-controls'},()=>({contents:'export default '+JSON.stringify(definitions.controls),loader:'js'}));
   }},{name:'page-vendored-three',setup(bundler){
    bundler.onResolve({filter:/^three(?:\/webgpu|\/tsl)?$/},args=>({path:join(repoRoot,args.path==='three/tsl'?'lib/three.tsl.js':'lib/three.webgpu.js')}));
   }}]});
  report.inputs=Object.keys(built.metafile.inputs);report.failurePhase='output';
  // This upstream Emscripten factory keeps Node-only imports behind its actual
  // ENVIRONMENT_IS_NODE branch. Preserve that browser/worker dispatch.
  report.externalNodeImports=[];
  for(const [input,value]of Object.entries(built.metafile.inputs))for(const imported of value.imports??[])if(imported.path.startsWith('node:')){
   if(!input.endsWith('models/trellis2/vendor/fast-simplification/fast-simplification-0.2.0.mjs'))throw Error('Unexpected Node-only worker dependency '+input+': '+imported.path);
   report.externalNodeImports.push({input,path:imported.path});
  }
  report.warnings=built.warnings;

  if(report.inputs.some(path=>/node_modules\/three\/(src|build)\//.test(path)))throw Error('Worker bundle resolved an installed second Three core');
  for(const name of ['scene-worker-runtime.mjs','scene-worker-scene-resources.mjs','scene-worker-fire-resources.mjs','volume-core.js','authoring-image-serving.mjs'])if(!report.inputs.some(path=>path.endsWith(name)))throw Error('Worker bundle omitted actual owner '+name);
  const bytes=await readFile(out);if(!bytes.length)throw Error('Worker bundle output is empty');
  report.outputSha256=hash(bytes);report.outputBytes=bytes.length;report.status='built';report.failurePhase=null;await save();return report;
 }catch(error){report.status='failed';report.error=String(error?.message??error);await save();throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};const names={'--repo-root':'repoRoot','--out':'out','--report':'reportPath'};
 try{
  for(let i=2;i<process.argv.length;i++){const flag=process.argv[i];if(flag==='--help'){console.log('node tools/build-scene-worker.mjs --repo-root <checkout> [--out <bundle.mjs>] [--report <report.json>]');process.exit(0);}if(!names[flag]||!process.argv[i+1])throw Error('Unknown or missing build argument '+flag);options[names[flag]]=process.argv[++i];}
  const report=await buildSceneWorkerBundle(options);console.log(JSON.stringify({status:report.status,repoRoot:report.repoRoot,out:report.out,bytes:report.outputBytes,sha256:report.outputSha256}));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
