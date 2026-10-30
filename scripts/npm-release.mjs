import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

const names={kit:'@kaminos/webgpu-inference-kit',klein:'@kaminos/flux2-klein',
  supermat:'@kaminos/supermat',unimate:'@kaminos/unimate-webgpu',u2net:'@kaminos/u2net'};
const repository='git+https://github.com/lyonsno/kaminos.git';
export function validateInput(input){
  if(!Object.hasOwn(names,input.package))throw Error('Unknown release package');
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version??''))throw Error('An exact package version is required');
  if(!/^[a-f0-9]{40}$/.test(input.source??''))throw Error('An exact source commit SHA is required');
  if(!/^[a-f0-9]{64}$/.test(input.sha256??''))throw Error('An approved archive SHA256 is required');
  return {package:input.package,name:names[input.package],version:input.version,source:input.source,sha256:input.sha256};
}

async function command(file,args,{cwd,env=process.env,log}={}){
  const child=spawn(file,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  const stdout=[],stderr=[];
  child.stdout.on('data',data=>stdout.push(data));child.stderr.on('data',data=>stderr.push(data));
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  const result={file,args,cwd,exitCode:code,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()};
  if(log)await fs.writeFile(log,JSON.stringify(result,null,2));
  if(code!==0)throw Error(`${file} exited ${code}: ${result.stderr||result.stdout}`);
  return result.stdout;
}

export async function verifyArchive(archive,input){
  const expected=validateInput(input),bytes=await fs.readFile(archive);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256!==expected.sha256)throw Error('Archive SHA256 differs from approved bytes');
  const manifest=JSON.parse(await command('tar',['-xOf',archive,'package/package.json']));
  if(manifest.name!==expected.name)throw Error('Archive package name differs from requested package');
  if(manifest.version!==expected.version)throw Error('Archive version differs from requested version');
  if(manifest.private===true)throw Error('Archive package is private');
  if(manifest.repository?.url!==repository)throw Error('Archive repository differs from trusted publisher');
  return {name:manifest.name,version:manifest.version,repository:manifest.repository,sha256,bytes:bytes.length,
    integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')};
}

export function assertPublisher(env=process.env){
  if(env.GITHUB_REPOSITORY!=='lyonsno/kaminos'||env.GITHUB_REF!=='refs/heads/main'
    ||env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw Error('Publication requires a manual dispatch from lyonsno/kaminos main');
  if(env.RUNNER_ENVIRONMENT!=='github-hosted')throw Error('Publication requires a GitHub-hosted runner');
  if(!env.ACTIONS_ID_TOKEN_REQUEST_URL||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('Publication requires GitHub OIDC');
  if(env.NODE_AUTH_TOKEN||env.NPM_TOKEN||env.NPM_KAMINOS_ACCESS_TOKEN)throw Error('Static npm tokens are not used by this publisher');
}

export async function prepareRelease(options){
  const out=path.resolve(options.out),report={schema:'kaminos.npm-release.v1',status:'failed',phase:'input',
    requested:{package:options.package,version:options.version,source:options.source,sha256:options.sha256}};
  await fs.mkdir(out,{recursive:true});
  const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await save();
  try{
    const input=validateInput(options),sourceRoot=await fs.realpath(options.sourceRoot);
    report.phase='source';await save();
    const actual=(await command('git',['rev-parse','HEAD'],{cwd:sourceRoot})).trim();
    if(actual!==input.source)throw Error('Effective source differs from requested source');
    if((await command('git',['status','--porcelain','--untracked-files=no'],{cwd:sourceRoot})).trim())throw Error('Release source has tracked changes');
    report.actualSource=actual;report.sourceRoot=sourceRoot;report.node=process.version;
    report.npm=(await command('npm',['--version'],{cwd:sourceRoot})).trim();
    report.phase='pack';await save();
    const stage=await fs.mkdtemp(path.join(out,'pack-'));
    const env={...process.env,NPM_CONFIG_IGNORE_SCRIPTS:'true'};
    let count=0;
    const run=(file,args,cwd=sourceRoot)=>command(file,args,{cwd,env,log:path.join(out,`command-${++count}.json`)});
    const pack=async cwd=>{
      const [row]=JSON.parse(await run('npm',['pack','--json','--ignore-scripts','--pack-destination',stage],cwd));
      if(!row?.filename||path.basename(row.filename)!==row.filename)throw Error('Pack returned no package archive');
      return path.join(stage,row.filename);
    };
    let archive;
    if(input.package==='kit')archive=await pack(path.join(sourceRoot,'webgpu-inference-kit'));
    else if(input.package==='klein'){
      const result=JSON.parse(await run(process.execPath,['models/flux2-klein/pack-klein.mjs','--out',path.join(stage,'klein'),'--version',input.version,'--json']));
      archive=result.tarball;
    }else if(input.package==='unimate'){
      const folder=path.join(stage,'unimate');
      await run(process.execPath,['models/unimate/pack-npm.mjs','--out',folder]);archive=await pack(folder);
    }else{
      const args=[`scripts/pack-${input.package}-module.mjs`,'--out',stage,'--version',input.version];
      if(input.package==='supermat')args.push('--json');
      const result=JSON.parse(await run(process.execPath,args));
      archive=result.tarball;
    }
    report.phase='verify';await save();
    const resolved=await fs.realpath(archive);
    if(!resolved.startsWith(stage+path.sep))throw Error('Pack archive is outside the caller-owned output');
    report.artifact=await verifyArchive(resolved,input);
    await fs.copyFile(resolved,path.join(out,'package.tgz'));
    report.archive='package.tgz';report.status='prepared';report.phase='complete';await save();
    return report;
  }catch(error){report.error=String(error.stack??error);await save();throw error;}
}

export async function verifyRelease(options){
  const out=path.resolve(options.out),report={status:'failed',phase:'verify'};
  try{
    report.requested=validateInput(options);
    if(options.publication)assertPublisher();
    const preparation=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
    if(preparation.status!=='prepared'||preparation.actualSource!==options.source)throw Error('Missing source-bound successful preparation');
    report.artifact=await verifyArchive(path.join(out,'package.tgz'),options);
    report.actualSource=preparation.actualSource;report.status='verified';
    return report;
  }catch(error){report.error=String(error.stack??error);throw error;}
  finally{await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {positionals,values}=parseArgs({allowPositionals:true,options:Object.fromEntries(
    ['package','version','source','sha256','out','source-root'].map(name=>[name,{type:'string'}]))});
  const options={...values,sourceRoot:values['source-root']};
  try{
    if(positionals[0]==='prepare')await prepareRelease(options);
    else if(positionals[0]==='verify')console.log(JSON.stringify(await verifyRelease({...options,publication:true})));
    else throw Error('Use prepare or verify');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
