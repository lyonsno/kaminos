// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, realpath, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createKaminosAppHost} from '../node-app-host.mjs';
import {createAuthoringAssets} from '../authoring-assets.mjs';
import {createPng} from './png-fixture.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(t, options={}) {
  const dir=await realpath(await mkdtemp(join(tmpdir(),'kaminos-node-host-')));
  const repoRoot=join(dir,'repo'),stateRoot=join(dir,'state'),sam3PacketRoot=join(dir,'packet');
  await Promise.all([repoRoot,stateRoot,sam3PacketRoot].map(path=>mkdir(path)));
  await writeFile(join(repoRoot,'index.html'),'<title>actual app bytes</title>');
  await writeFile(join(sam3PacketRoot,'tensor-manifest.json'),JSON.stringify({schema:'observed-manifest-fixture',tensors:[{file:'tensor.bin'}]}));
  await writeFile(join(sam3PacketRoot,'tensor.bin'),Buffer.from([0,1,2,3,4,5]));
  await options.setup?.({dir,repoRoot,stateRoot,sam3PacketRoot});
  const host=await createKaminosAppHost({repoRoot,stateRoot,sam3PacketRoot,...options});
  await host.listen(0,'127.0.0.1');
  const url=`http://127.0.0.1:${host.server.address().port}`;
  t.after(async()=>{await host.close();await rm(dir,{recursive:true,force:true});});
  const request=async(path,options)=>{
    const response=await fetch(url+path,options);
    assert.equal(response.status,200,`${path} must complete through the Node HTTP route`);
    return response.json();
  };
  return {dir,repoRoot,stateRoot,sam3PacketRoot,host,url,request};
}

test('Node host serves its exact app and model mount, HEAD and caller-requested byte range',async t=>{
  const f=await fixture(t),config=await f.request('/api/runtime-config');
  assert.equal(config.schema,'kaminos.runtime-config.v0');
  assert.equal(config.applicationHost.runtime,'node');
  assert.equal(config.applicationHost.repoRoot,f.repoRoot);
  assert.equal(config.applicationHost.stateRoot,f.stateRoot);
  assert.equal(config.sam3.mounted,true);
  assert.equal(config.sam3.modelRoot,f.sam3PacketRoot);
  assert.equal(await (await fetch(f.url+'/')).text(),'<title>actual app bytes</title>');
  assert.deepEqual(await (await fetch(f.url+'/sam3-packet/tensor-manifest.json')).json(),{schema:'observed-manifest-fixture',tensors:[{file:'tensor.bin'}]});
  const head=await fetch(f.url+'/sam3-packet/tensor.bin',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'6');assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await fetch(f.url+'/sam3-packet/tensor.bin',{headers:{Range:'bytes=2-4'}});
  assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-4/6');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),Buffer.from([2,3,4]));
  assert.equal((await fetch(f.url+'/sam3-packet/tensor.bin',{headers:{Range:'bytes=9-10'}})).status,416);
});

test('actual Authoring controller can upload, catalog and reselect complete immutable image bytes',async t=>{
  const f=await fixture(t),content=createPng(4,3),name='the entire original 名称.png';
  const upload=async()=>f.request('/api/ingest-image?'+new URLSearchParams({name}),{method:'POST',body:content});
  const a=await upload(),b=await upload();
  assert.equal(a.schema,'kaminos.asset-ingest.v0');assert.equal(a.kind,'image');
  assert.equal(a.entry.name,name);assert.equal(a.entry.sha256,'sha256:'+sha(content));
  assert.equal(a.entry.path,`${sha(content)}/${sha(name)}.png`);assert.equal(a.entry.path,b.entry.path);
  assert.deepEqual(Buffer.from(await (await fetch(f.url+a.entry.source)).arrayBuffer()),content);
  const api=createAuthoringAssets({request:f.request,addMesh:()=>{},uploadImage:async()=>a.entry});
  assert.equal(await api.refresh(),true);assert.equal(await api.browse('image-inbox'),true);
  assert.equal(api.read().entries.length,1);api.select(api.read().entries[0]);
  assert.equal(api.read().selected.source,a.entry.source);assert.equal(api.read().selected.name,name);
  const changed=await f.request('/api/ingest-image?'+new URLSearchParams({name}),{method:'POST',body:createPng(4,3,80)});
  assert.notEqual(changed.entry.path,a.entry.path);
  assert.deepEqual(Buffer.from(await (await fetch(f.url+a.entry.source)).arrayBuffer()),content);
  assert.equal((await f.request('/api/authoring-assets?collection=image-inbox')).entries.length,2);
});

test('scene save/reopen preserves additive data and needs an explicit overwrite decision for Save As',async t=>{
  const f=await fixture(t),scene={schema:'kaminos.scene.v1',version:10,objects:[],camera:{position:[1,2,3]},future:{preserve:['all','fields']}};
  const saved=await f.request('/api/save-scene',{method:'POST',body:JSON.stringify({...scene,_saveAsName:'chosen scene'})});
  assert.equal(saved.saved,'chosen-scene.kaminos.json');
  assert.deepEqual(await f.request('/api/read?'+new URLSearchParams({root:'scenes',path:saved.saved})),scene);
  const conflict=await fetch(f.url+'/api/save-scene',{method:'POST',body:JSON.stringify({...scene,_saveAsName:'chosen scene'})});
  assert.equal(conflict.status,409);assert.equal((await conflict.json()).exists,saved.saved);
  const updated={...scene,camera:{position:[9,8,7]}};
  assert.equal((await f.request('/api/save-scene',{method:'POST',body:JSON.stringify({...updated,_filename:saved.saved})})).saved,saved.saved);
  assert.deepEqual(await f.request('/api/read?'+new URLSearchParams({root:'scenes',path:saved.saved})),updated);
  assert.equal((await f.request('/api/browse?root=scenes&path=')).entries[0].name,saved.saved);
});

test('wrong mount, escaping paths, empty image and unsupported service cannot pretend to be useful assets',async t=>{
  const f=await fixture(t,{sam3PacketRoot:null});
  assert.equal((await f.request('/api/runtime-config')).sam3,null);
  assert.equal((await fetch(f.url+'/sam3-packet/tensor-manifest.json')).status,404);
  assert.equal((await fetch(f.url+'/api/ingest-image?name=empty.png',{method:'POST',body:''})).status,400);
  assert.equal((await fetch(f.url+'/api/ingest-image?name=../escape.png',{method:'POST',body:createPng(1,1)})).status,400);
  await writeFile(join(f.dir,'outside.bin'),'outside');
  await symlink(join(f.dir,'outside.bin'),join(f.stateRoot,'scenes','escape.bin'));
  assert.equal((await fetch(f.url+'/api/read?root=scenes&path=escape.bin')).status,403);
  assert.equal((await fetch(f.url+'/api/read?root=scenes&path=../outside.bin')).status,403);
  const absent=await fetch(f.url+'/api/run-pipeline',{method:'POST',body:'{}'});
  assert.equal(absent.status,501);assert.equal((await absent.json()).phase,'unsupported-service');
});

test('caller-owned stores remain independent across hosts',async t=>{
  const a=await fixture(t),b=await fixture(t);
  await a.request('/api/ingest-image?name=only-a.png',{method:'POST',body:createPng(1,1)});
  assert.equal((await a.request('/api/authoring-assets?collection=image-inbox')).entries.length,1);
  assert.equal((await b.request('/api/authoring-assets?collection=image-inbox')).entries.length,0);
  assert.equal((await b.request('/api/roots'))['image-inbox'].path,join(b.stateRoot,'assets','images','inbox'));
});

test('the supplied frontend dependency directory is a reported mount even when worktrees share it',async t=>{
  const module='export const actualDependency = true;';
  const f=await fixture(t,{setup:async({dir,repoRoot})=>{
    const dependencyRoot=join(dir,'shared-dependencies');
    await mkdir(join(dependencyRoot,'three-mesh-bvh','build'),{recursive:true});
    await writeFile(join(dependencyRoot,'three-mesh-bvh','build','index.module.js'),module);
    await symlink(dependencyRoot,join(repoRoot,'node_modules'));
  }}),dependencyRoot=join(f.dir,'shared-dependencies');
  const request=await fetch(f.url+'/node_modules/three-mesh-bvh/build/index.module.js');
  assert.equal(request.status,200,'the actual frontend dependency must be served');
  assert.equal(await request.text(),module);
  const config=await f.request('/api/runtime-config');
  assert.equal(config.applicationHost.dependencyRoot,dependencyRoot);
  await symlink(join(f.dir,'outside.bin'),join(dependencyRoot,'escape.bin'));
  await writeFile(join(f.dir,'outside.bin'),'unmounted');
  assert.equal((await fetch(f.url+'/node_modules/escape.bin')).status,403);
});

test('valid GLB containers persist by digest and malformed containers never enter the saved-mesh catalog',async t=>{
  const f=await fixture(t),json=Buffer.from('{"asset":{"version":"2.0"}}  ');
  const content=Buffer.alloc(20+json.length);content.write('glTF');content.writeUInt32LE(2,4);content.writeUInt32LE(content.length,8);content.writeUInt32LE(json.length,12);content.write('JSON',16);json.copy(content,20);
  const saved=await f.request('/api/ingest-mesh',{method:'POST',body:content});
  assert.equal(saved.schema,'kaminos.generated-mesh.v0');assert.equal(saved.sha256,sha(content));assert.equal(saved.bytes,content.length);
  assert.equal(saved.source,`/api/read?root=generated-meshes&path=${sha(content)}.glb`);
  assert.deepEqual(Buffer.from(await (await fetch(f.url+saved.source)).arrayBuffer()),content);
  assert.deepEqual(await f.request('/api/ingest-mesh',{method:'POST',body:content}),saved);
  const malformed=Buffer.from(content);malformed.writeUInt32LE(1,4);
  assert.equal((await fetch(f.url+'/api/ingest-mesh',{method:'POST',body:malformed})).status,400);
  const catalog=await f.request('/api/authoring-assets?collection=generated-meshes');
  assert.equal(catalog.entries.length,1);assert.equal(catalog.entries[0].kind,'mesh');assert.equal(catalog.entries[0].source,saved.source);
});
