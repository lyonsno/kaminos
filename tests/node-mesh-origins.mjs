// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,realpath,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {createKaminosAppHost} from '../node-app-host.mjs';
import {createAuthoringAssets} from '../authoring-assets.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function glb() {
  const document=Buffer.from('{"asset":{"version":"2.0"}}'),json=Buffer.concat([document,Buffer.alloc((4-document.length%4)%4,32)]);
  const bytes=Buffer.alloc(20+json.length);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(json.length,12);bytes.write('JSON',16);json.copy(bytes,20);return bytes;
}
async function fixture(t) {
  const dir=await realpath(await mkdtemp(join(tmpdir(),'kaminos-node-origins-'))),repoRoot=join(dir,'repo'),stateRoot=join(dir,'state'),hosts=[];
  await mkdir(repoRoot);await writeFile(join(repoRoot,'index.html'),'<title>origin HTTP fixture</title>');
  async function start() {
    const host=await createKaminosAppHost({repoRoot,stateRoot});await host.listen(0,'127.0.0.1');hosts.push(host);
    const url=`http://127.0.0.1:${host.server.address().port}`;
    const call=async(path,options)=>{const response=await fetch(url+path,options);return {status:response.status,body:await response.json()};};
    return {host,url,call};
  }
  t.after(async()=>{for(const host of hosts)if(host.server.listening)await host.close();await rm(dir,{recursive:true,force:true});});
  const a=await start(),bytes=glb(),stored=await a.call('/api/ingest-mesh',{method:'POST',body:bytes});assert.equal(stored.status,200);
  const artifact=stored.body;
  const result=(runId='origin-run-a',name='The full authored 名称.glb')=>({source:artifact.source,sha256:artifact.sha256,name,
    generation:{schema:'kaminos.asset-generation.v1',runId,input:{source:'/api/read?root=image-inbox&path=input.png',sha256:'a'.repeat(64)},
      route:'sf3d.image-to-mesh.webgpu-local.v0',sha256:artifact.sha256,bytes:bytes.length,receiptValidation:{ok:true},future:{complete:['producer','data']}}});
  const publish=(client,value)=>client.call('/api/mesh-generation-origin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  return {dir,stateRoot,root:join(stateRoot,'assets','generated-meshes'),start,a,bytes,artifact,result,publish};
}

test('origin handback is idempotent and a fresh host browses/reselects the complete authored name and provenance',async t=>{
  const f=await fixture(t),value=f.result();
  const first=await f.publish(f.a,value);assert.equal(first.status,200,'the existing generation callback must finish instead of 501');
  assert.deepEqual(first.body,{schema:'kaminos.mesh-generation-origin.v1',result:value});
  assert.deepEqual(await f.publish(f.a,value),first);
  await f.a.host.close();const fresh=await f.start();
  const listing=await fresh.call('/api/authoring-assets?collection=generated-meshes');assert.equal(listing.status,200);assert.equal(listing.body.warnings.length,0);
  const entry=listing.body.entries.find(entry=>entry.source===value.source);assert.ok(entry);assert.deepEqual(entry.generation,value.generation);assert.equal(entry.display.title,value.name);
  const browse=await fresh.call('/api/browse?root=generated-meshes');assert.equal(browse.status,200);
  assert.deepEqual(browse.body.entries.find(entry=>entry.name===f.artifact.sha256+'.glb').generation,value.generation);
  const controller=createAuthoringAssets({request:async(path,options)=>{const r=await fresh.call(path,options);assert.equal(r.status,200);return r.body;},addMesh:()=>{}});
  assert.equal(await controller.browse('generated-meshes'),true);const selected=controller.read().entries.find(entry=>entry.source===value.source);
  assert.equal(selected.label,value.name);controller.select(selected);assert.deepEqual(controller.read().selected.generation,value.generation);
  const saved=await fresh.call('/api/save-scene',{method:'POST',body:JSON.stringify({_saveAsName:'generated origin scene',objects:[{id:'mesh-1',source:value.source,name:value.name,generation:value.generation}]})});
  assert.equal(saved.status,200);const reopened=await fresh.call('/api/read?'+new URLSearchParams({root:'scenes',path:saved.body.saved}));
  assert.deepEqual(reopened.body.objects[0],{id:'mesh-1',source:value.source,name:value.name,generation:value.generation});
  assert.deepEqual(Buffer.from(await (await fetch(fresh.url+value.source)).arrayBuffer()),f.bytes);
});

test('two hosts cannot publish conflicting provenance for one run and identical concurrent retry is harmless',async t=>{
  const f=await fixture(t),b=await f.start(),values=[f.result('competing-run','first.glb'),f.result('competing-run','second.glb')];
  const results=await Promise.all([f.publish(f.a,values[0]),f.publish(b,values[1])]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=values[results.findIndex(r=>r.status===200)];
  const listing=await f.a.call('/api/authoring-assets?collection=generated-meshes');assert.equal(listing.body.entries[0].display.title,winner.name);
  assert.deepEqual((await Promise.all([f.publish(f.a,winner),f.publish(b,winner)])).map(r=>r.status),[200,200]);
  assert.equal((await f.publish(b,{...winner,generation:{...winner.generation,route:'different-observed-route'}})).status,409);
});

test('different concurrent runs for the same mesh all remain stored after restart',async t=>{
  const f=await fixture(t),b=await f.start(),values=['one','two','three','four'].map(id=>f.result(id,id+'.glb'));
  assert.deepEqual((await Promise.all(values.map((value,i)=>f.publish(i%2?b:f.a,value)))).map(r=>r.status),[200,200,200,200]);
  await f.a.host.close();await b.host.close();const fresh=await f.start();
  const files=await readdir(f.root,{recursive:true}),stored=[];
  for(const path of files)if(path.endsWith('.json'))stored.push(JSON.parse(await readFile(join(f.root,path),'utf8')));
  const origins=stored.flatMap(value=>value.origins?Object.values(value.origins):value.result?[value.result]:[]);
  assert.deepEqual(origins.map(origin=>origin.generation.runId).sort(),values.map(value=>value.generation.runId).sort(),'all accepted runs must survive competing publication');
  const latest=await fresh.call('/api/authoring-assets?collection=generated-meshes');assert.equal(latest.body.warnings.length,0);
  assert.ok(values.some(value=>value.name===latest.body.entries[0].display.title));
  assert.deepEqual(Buffer.from(await (await fetch(fresh.url+f.artifact.source)).arrayBuffer()),f.bytes);
});

test('missing or contradictory artifact identity and unvalidated provenance fail before publication while mesh bytes survive',async t=>{
  const f=await fixture(t),valid=f.result(),bad=[{...valid,sha256:'../outside'},{...valid,source:'/api/read?root=scratch&path=other.glb'},
    {...valid,generation:{...valid.generation,bytes:f.bytes.length+1}},{...valid,generation:{...valid.generation,sha256:'b'.repeat(64)}},
    {...valid,generation:{...valid.generation,runId:''}},{...valid,generation:{...valid.generation,input:{sha256:'not-a-digest'}}},
    {...valid,generation:{...valid.generation,route:''}},{...valid,generation:{...valid.generation,receiptValidation:{ok:false}}},{...valid,name:''}];
  for(const value of bad)assert.equal((await f.publish(f.a,value)).status,400);
  const missing={...valid,sha256:'b'.repeat(64),source:'/api/read?root=generated-meshes&path='+('b'.repeat(64))+'.glb',generation:{...valid.generation,sha256:'b'.repeat(64)}};
  assert.equal((await f.publish(f.a,missing)).status,400);
  assert.equal((await f.a.call('/api/mesh-generation-origin',{method:'POST',body:'{'})).status,400);
  const listing=await f.a.call('/api/authoring-assets?collection=generated-meshes');assert.equal(listing.body.entries[0].generation,undefined);
  assert.deepEqual(Buffer.from(await (await fetch(f.a.url+valid.source)).arrayBuffer()),f.bytes);
  assert.equal((await f.publish(f.a,valid)).status,200,'the retained output can finish persistence without new mesh computation');
});

test('legacy Python origin aggregates are read and conflicting run ids cannot be rewritten through Node',async t=>{
  const f=await fixture(t),old=f.result('legacy-run','Existing Python result.glb');
  await writeFile(join(f.root,'.'+f.artifact.sha256+'.glb.origins.json'),JSON.stringify({schema:'kaminos.mesh-generation-origins.v1',sha256:f.artifact.sha256,latestRunId:old.generation.runId,origins:{[old.generation.runId]:{name:old.name,generation:old.generation}}}));
  const listing=await f.a.call('/api/authoring-assets?collection=generated-meshes');assert.equal(listing.body.entries[0].display.title,old.name);assert.deepEqual(listing.body.entries[0].generation,old.generation);
  assert.equal((await f.publish(f.a,old)).status,200);assert.equal((await f.publish(f.a,{...old,name:'contradictory.glb'})).status,409);
  const newer=f.result('new-node-run','Node continuation.glb');assert.equal((await f.publish(f.a,newer)).status,200);
  assert.equal((await f.a.call('/api/authoring-assets?collection=generated-meshes')).body.entries[0].display.title,newer.name);
});

test('corrupt provenance stays visibly unverified and cannot be silently replaced',async t=>{
  const f=await fixture(t);await writeFile(join(f.root,'.'+f.artifact.sha256+'.glb.origins.json'),'{');
  const listing=await f.a.call('/api/authoring-assets?collection=generated-meshes');assert.equal(listing.status,200);
  assert.equal(listing.body.entries.length,1);assert.equal(listing.body.entries[0].generation,undefined);assert.ok(listing.body.warnings.length>0);
  assert.equal((await f.publish(f.a,f.result())).status,400);
  assert.equal(await readFile(join(f.root,'.'+f.artifact.sha256+'.glb.origins.json'),'utf8'),'{');
});

test('publication after a held temporary write determines display order across restart and retry',async t=>{
  const f=await fixture(t),b=await f.start(),aValue=f.result('held-run-a','Published last.glb'),bValue=f.result('run-b','Published earlier.glb');
  let observed,release;const held=new Promise(resolve=>observed=resolve),gate=new Promise(resolve=>release=resolve);
  const originalLink=fs.link,originalRename=fs.rename;
  const hold=async(target,action)=>{if(target.endsWith('/'+sha(aValue.generation.runId)+'.json')||target.endsWith('/'+sha(aValue.generation.runId))){observed();await gate;}return action();};
  fs.link=(source,target)=>hold(target,()=>originalLink(source,target));fs.rename=(source,target)=>hold(target,()=>originalRename(source,target));syncBuiltinESMExports();
  try {
    const pending=f.publish(f.a,aValue);await held;
    // Real modification times differ; the gate controls publication order.
    await new Promise(resolve=>setTimeout(resolve,25));assert.equal((await f.publish(b,bValue)).status,200);
    release();assert.equal((await pending).status,200);
    const verify=async(client)=>{
      const catalog=await client.call('/api/authoring-assets?collection=generated-meshes');assert.equal(catalog.body.entries[0].generation.runId,aValue.generation.runId,'last published origin must be displayed');
      const browse=await client.call('/api/browse?root=generated-meshes');assert.equal(browse.body.entries[0].generation.runId,aValue.generation.runId);
    };
    await verify(b);await f.a.host.close();await b.host.close();const fresh=await f.start();await verify(fresh);
    assert.equal((await f.publish(fresh,bValue)).status,200);await verify(fresh);
    assert.equal((await f.publish(fresh,{...bValue,name:'Cannot replace.glb'})).status,409);await verify(fresh);
  }finally {release();fs.link=originalLink;fs.rename=originalRename;syncBuiltinESMExports();}
});
