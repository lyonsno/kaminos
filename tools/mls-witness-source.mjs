import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export function validateServedMlsSource(report){
  const source=report.servedSource?.source;
  assert.equal(report.servedSource?.schema,'kaminos.runtime-config.v0','missing served source schema');
  assert.equal(source?.repoRoot,report.source?.root,'served source root mismatch');
  assert.equal(source?.commit,report.source?.head,'served source revision mismatch');
  assert.equal(typeof source?.dirty,'boolean','missing served source dirty state');
  assert(Object.keys(report.expectedFiles??{}).length>0,'missing served source file identities');
  for(const [url,sha]of Object.entries(report.expectedFiles)){
    assert.equal(report.servedFiles?.[url]?.status,200,`missing served source response ${url}`);
    assert.equal(report.servedFiles[url].sha256,sha,`served source bytes mismatch ${url}`);
  }
}

export function bindMlsWitnessSource({page,url,root,files,out,report}){
  const base=new URL(url),pending=[];
  report.source={root:fs.realpathSync(root),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
  report.expectedFiles={};report.servedFiles={};
  for(const file of files){
    const bytes=fs.readFileSync(path.join(root,file)),pathname=file==='index.html'?base.pathname:'/'+file;
    report.expectedFiles[pathname]=createHash('sha256').update(bytes).digest('hex');
    fs.mkdirSync(path.dirname(path.join(out,'source',file)),{recursive:true});fs.writeFileSync(path.join(out,'source',file),bytes);
  }
  page.on('response',response=>{
    const uri=new URL(response.url());if(uri.origin!==base.origin||!Object.hasOwn(report.expectedFiles,uri.pathname))return;
    pending.push((async()=>{
      try{report.servedFiles[uri.pathname]={status:response.status(),sha256:createHash('sha256').update(await response.body()).digest('hex')};}
      catch(error){report.servedFiles[uri.pathname]={status:response.status(),error:String(error)};}
    })());
  });
  return async()=>{
    report.servedSource=await page.evaluate(async()=>{
      const response=await fetch('/api/runtime-config',{cache:'no-store'});if(!response.ok)throw Error('Served runtime config unavailable');return response.json();
    });
    await Promise.all(pending);validateServedMlsSource(report);
  };
}

export const MLS_WITNESS_FILES=['index.html','owner-live-fluid-session.mjs','mls-juice-contract.mjs','mls-juice-solver.mjs','mls-juice-renderer.mjs','mls-juice-host.mjs',
  'vendor/splash-mls-mpm/p2g_1.wgsl','vendor/splash-mls-mpm/p2g_2.wgsl','vendor/splash-mls-mpm/g2p.wgsl'];
