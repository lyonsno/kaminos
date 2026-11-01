// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('  // An image plane is unlit'),end=html.indexOf('  environmentLoaded.then(',start);
assert.ok(start>=0&&end>start);
const code=html.slice(start,end)+';globalThis.done=environmentLoaded;';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function run(search='?image_root=images&image_path=one.png'){
 const environment=deferred(),image=deferred(),calls=[];
 const route={effectiveUrl:'/api/read?root=images&path=one.png',fileName:'one.png'};
 const c={URLSearchParams,location:{search,hash:'',href:'http://localhost/'+search},window:{location:{search}},
  initialEnvironment:'studio',loadEnvironment:()=>{calls.push('environment');return environment.promise;},
  startupPreferences:null,kaminosImageAssetRouteFromSearch:p=>p.has('image_path')?route:null,
  kaminosMeshAssetRouteFromSearch:()=>null,kaminosSplatAssetRouteFromSearch:()=>null,
  loadKaminosImageAssetRoute:()=>{calls.push('image');return image.promise;},setInfo:()=>{},
  greenroomImportSplat:async()=>calls.push('legacy-splat'),console,
 };
 vm.runInNewContext(code,c);return {environment,image,calls,c};
}
test('direct image import begins while the HDR environment is still pending',async()=>{
 const r=run();await Promise.resolve();
 assert.ok(r.calls.includes('image'),'image must not wait for the unrelated HDR download');
 let done=false;r.c.done.then(()=>done=true);r.image.resolve(true);await Promise.resolve();
 assert.equal(done,false,'environment owner still waits for the selected environment');
 r.environment.resolve();await r.c.done;
 assert.equal(r.calls.filter(x=>x==='image').length,1,'image is imported once');
});
test('combined legacy asset routes retain their ordered replacement behavior',async()=>{
 const r=run('?load=splats/one.ply&image_root=images&image_path=one.png');
 assert.equal(r.calls.includes('image'),false);
 r.image.resolve(true);r.environment.resolve();await r.c.done;
 assert.deepEqual(r.calls,['environment','legacy-splat','image']);
});
test('ordinary environment startup does not import an image',async()=>{
 const r=run('');r.environment.resolve();await r.c.done;
 assert.deepEqual(r.calls,['environment']);
});
