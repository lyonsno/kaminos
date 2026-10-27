// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const helper=new URL('../scripts/npm-release.mjs',import.meta.url);
test('release verifies approved bytes and metadata before allowing hosted publication',async t=>{
  assert.ok(existsSync(helper),'Missing exact-archive OIDC release verifier');
  const {validateInput,verifyArchive,verifyRelease,assertPublisher,prepareRelease}=await import(helper);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'npm-release-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const input={package:'kit',version:'0.1.60',source:'b'.repeat(40),sha256:'a'.repeat(64)};
  const manifest={name:'@kaminos/webgpu-inference-kit',version:input.version,private:false,
    repository:{url:'git+https://github.com/lyonsno/kaminos.git'}};
  let serial=0;
  async function fixture(change={}){
    const folder=path.join(root,String(++serial));await fs.mkdir(path.join(folder,'package'),{recursive:true});
    await fs.writeFile(path.join(folder,'package/package.json'),JSON.stringify({...manifest,...change}));
    const archive=path.join(folder,'package.tgz');
    execFileSync('tar',['-czf',archive,'-C',folder,'package']);
    const bytes=await fs.readFile(archive);
    return {archive,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  const good=await fixture();
  await t.test('same archive is verified without modification',async()=>{
    const actual=await verifyArchive(good.archive,{...input,sha256:good.sha256});
    assert.equal(actual.name,manifest.name);assert.equal(actual.version,input.version);
    assert.equal(actual.sha256,good.sha256);assert.ok(actual.bytes>0);
  });
  await t.test('changed bytes, wrong version, private package and repository mismatch reject',async()=>{
    await assert.rejects(()=>verifyArchive(good.archive,input),/SHA256/);
    for(const change of [{version:'0.1.61'},{private:true},{name:'@other/package'},
      {repository:{url:'git+https://github.com/other/repo.git'}}]){
      const row=await fixture(change);
      await assert.rejects(()=>verifyArchive(row.archive,{...input,sha256:row.sha256}),/package|version|repository/);
    }
  });
  await t.test('source/hash/package inputs cannot silently default',()=>{
    for(const change of [{source:'main'},{source:''},{sha256:''},{package:'missing'},{version:'latest'}])
      assert.throws(()=>validateInput({...input,...change}));
  });
  const env={GITHUB_REPOSITORY:'lyonsno/kaminos',GITHUB_REF:'refs/heads/main',
    GITHUB_EVENT_NAME:'workflow_dispatch',RUNNER_ENVIRONMENT:'github-hosted',
    ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.invalid/token',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture'};
  await t.test('publication accepts only main/manual/hosted/OIDC and no static token',()=>{
    assert.doesNotThrow(()=>assertPublisher(env));
    for(const change of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/cc/branch'},
      {GITHUB_EVENT_NAME:'push'},{RUNNER_ENVIRONMENT:'self-hosted'},
      {ACTIONS_ID_TOKEN_REQUEST_TOKEN:''},{NODE_AUTH_TOKEN:'fixture'},{NPM_TOKEN:'fixture'}])
      assert.throws(()=>assertPublisher({...env,...change}));
  });
  await t.test('preparation failure leaves a report and never claims a built archive',async()=>{
    const out=path.join(root,'failed');
    await assert.rejects(()=>prepareRelease({...input,sourceRoot:root,out}),/git|repository|source/i);
    const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
    assert.equal(report.status,'failed');assert.equal(report.phase,'source');
    assert.equal(report.archive,undefined);assert.ok(report.error);
  });
  await t.test('a stale or forged preparation cannot replace the requested commit or bytes',async()=>{
    const out=path.join(root,'handoff');await fs.mkdir(out);
    await fs.copyFile(good.archive,path.join(out,'package.tgz'));
    const options={...input,sha256:good.sha256,out};
    for(const preparation of [{status:'failed',actualSource:input.source},
      {status:'prepared',actualSource:'c'.repeat(40)}]){
      await fs.writeFile(path.join(out,'report.json'),JSON.stringify(preparation));
      await assert.rejects(()=>verifyRelease(options),/source-bound/);
      assert.equal(JSON.parse(await fs.readFile(path.join(out,'verification.json'))).status,'failed');
    }
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({status:'prepared',actualSource:input.source,unknownAdditive:true}));
    assert.equal((await verifyRelease(options)).status,'verified');
    await fs.appendFile(path.join(out,'package.tgz'),'changed');
    await assert.rejects(()=>verifyRelease(options),/SHA256/);
  });
});

test('manual release workflow keeps preparation and publication privileges separate',async()=>{
  const file=new URL('../.github/workflows/npm-publish.yml',import.meta.url);
  assert.ok(existsSync(file),'Missing manual OIDC release workflow');
  const workflow=await fs.readFile(file,'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^  (push|pull_request|pull_request_target|issue_comment):/m);
  const [preparation,publication]=workflow.split(/^  publish:$/m);
  assert.ok(publication);
  assert.doesNotMatch(preparation,/id-token: write/);
  assert.match(publication,/id-token: write/);
  assert.match(publication,/environment: npm/);
  assert.match(publication,/refs\/heads\/main/);
  assert.match(publication,/npm publish .*--ignore-scripts/);
  assert.doesNotMatch(publication,/npm (ci|install)(?! -g npm@)/);
  assert.doesNotMatch(publication,/secrets\.NPM|npm stage|package-source/);
});
