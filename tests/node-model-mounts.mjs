// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,realpath,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createKaminosAppHost} from '../node-app-host.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,setup=async()=>{}) {
  const dir=await realpath(await mkdtemp(join(tmpdir(),'kaminos-model-mounts-')));
  const paths={dir,repoRoot:join(dir,'repo'),stateRoot:join(dir,'state'),kleinWeightsRoot:join(dir,'klein'),trellisCheckpointRoot:join(dir,'trellis')};
  await Promise.all(['repo','klein/te','klein/dit','klein/vae','trellis'].map(part=>mkdir(join(dir,part),{recursive:true})));
  for(const part of ['te','dit','vae'])await writeFile(join(paths.kleinWeightsRoot,part,'manifest.json'),JSON.stringify({part,additive:{preserve:true}}));
  paths.manifest=Buffer.from('{"schema":"owner-manifest","unknown":{"preserve":true}}\n');
  await writeFile(join(paths.trellisCheckpointRoot,'manifest.json'),paths.manifest);
  paths.tensor=Buffer.from([0,1,2,3,4,5,6,7]);
  for(const path of [join(paths.kleinWeightsRoot,'te','embedding.bin'),join(paths.trellisCheckpointRoot,'tensor.f32')])await writeFile(path,paths.tensor);
  const override=await setup(paths)||{};
  const host=await createKaminosAppHost({...paths,...override});await host.listen(0,'127.0.0.1');
  t.after(async()=>{await host.close();await rm(dir,{recursive:true,force:true});});
  return {...paths,host,url:`http://127.0.0.1:${host.server.address().port}`};
}

test('explicit Klein and TRELLIS mounts preserve consumer URLs and exact manifest identity',async t=>{
  const f=await fixture(t),response=await fetch(f.url+'/api/runtime-config');assert.equal(response.status,200);
  const config=await response.json();
  assert.deepEqual(config.klein,{weightsUrl:'/klein-weights',modelRoot:f.kleinWeightsRoot,mounted:true});
  assert.deepEqual(config.trellisPage,{checkpointUrl:'/trellis-checkpoints',modelRoot:f.trellisCheckpointRoot,mounted:true,manifestSha256:sha(f.manifest)});
  assert.equal(f.host.config.kleinWeightsRoot,f.kleinWeightsRoot);assert.equal(f.host.config.trellisCheckpointRoot,f.trellisCheckpointRoot);
  for(const part of ['te','dit','vae']){
    const response=await fetch(f.url+config.klein.weightsUrl+'/'+part+'/manifest.json');assert.equal(response.status,200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(join(f.kleinWeightsRoot,part,'manifest.json')));
  }
  const manifest=await fetch(f.url+config.trellisPage.checkpointUrl+'/manifest.json');assert.equal(manifest.status,200);
  assert.equal(manifest.headers.get('content-type'),'application/json');assert.deepEqual(Buffer.from(await manifest.arrayBuffer()),f.manifest);
});

test('model binaries provide exact HEAD and single-range responses required by token-row loaders',async t=>{
  const f=await fixture(t);
  for(const path of ['/klein-weights/te/embedding.bin','/trellis-checkpoints/tensor.f32']){
    const head=await fetch(f.url+path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'8');assert.equal((await head.arrayBuffer()).byteLength,0);
    for(const [range,start,end] of [['bytes=2-5',2,5],['bytes=-2',6,7],['bytes=6-',6,7]]){
      const response=await fetch(f.url+path,{headers:{Range:range}});assert.equal(response.status,206);
      assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/8`);assert.equal(response.headers.get('content-length'),String(end-start+1));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.tensor.subarray(start,end+1));
    }
    const response=await fetch(f.url+path,{headers:{Range:'bytes=99-100'}});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */8');
  }
});

test('missing and partial packages stay visibly unmounted without substituting another root',async t=>{
  const f=await fixture(t,async p=>{
    await rm(join(p.kleinWeightsRoot,'vae','manifest.json'));return {trellisCheckpointRoot:join(p.dir,'missing')};
  });
  const config=await (await fetch(f.url+'/api/runtime-config')).json();assert.equal(config.klein.mounted,false);
  assert.equal(config.trellisPage.modelRoot,join(f.dir,'missing'));assert.equal(config.trellisPage.mounted,false);assert.equal(config.trellisPage.manifestSha256,null);
  assert.equal((await fetch(f.url+'/klein-weights/vae/manifest.json')).status,404);
  assert.equal((await fetch(f.url+'/trellis-checkpoints/manifest.json')).status,404);
  const absent=await fixture(t,async()=>({kleinWeightsRoot:null,trellisCheckpointRoot:null}));
  const absentConfig=await (await fetch(absent.url+'/api/runtime-config')).json();assert.equal(absentConfig.klein,null);assert.equal(absentConfig.trellisPage,null);
  assert.equal((await fetch(absent.url+'/klein-weights/te/manifest.json')).status,404);assert.equal((await fetch(absent.url+'/trellis-checkpoints/manifest.json')).status,404);
});

test('package paths and advertised manifests cannot escape their explicit mount through symlinks',async t=>{
  const f=await fixture(t,async p=>{
    const outside=join(p.dir,'outside.json');await writeFile(outside,'{"secret":"unmounted"}');
    await rm(join(p.trellisCheckpointRoot,'manifest.json'));await symlink(outside,join(p.trellisCheckpointRoot,'manifest.json'));
    await symlink(outside,join(p.kleinWeightsRoot,'te','escape.json'));
  });
  const config=await (await fetch(f.url+'/api/runtime-config')).json();assert.equal(config.trellisPage.mounted,false);assert.equal(config.trellisPage.manifestSha256,null);
  for(const path of ['/klein-weights/te/escape.json','/trellis-checkpoints/manifest.json','/klein-weights/%2e%2e%2foutside.json'])assert.equal((await fetch(f.url+path)).status,403);
});
