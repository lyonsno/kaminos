// kaminos-test: node — each TRELLIS-derived scene object gets a GI proxy handle: a stored low tier of its hero, loaded
// outside the frame loop, never in the scene, placed exactly where the object draws; surfel assets also point at their
// own coarse surfels. Pass policy is the GI renderer's; this only resolves, loads and places.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import * as THREE from '../lib/three.core.js';
import {createGiProxyRegistry} from '../scene-gi-proxies.mjs';

const HERO='a'.repeat(64),SURF='b'.repeat(64);
const tierBytes=faces=>new TextEncoder().encode(`tier-${faces}`).buffer;
const sha=b=>createHash('sha256').update(new Uint8Array(b)).digest('hex');
const TIERS=[5000,1000,500].map(faces=>({faces,sha256:sha(tierBytes(faces)),closed:true,error:{schema:'kaminos.lod-geometric-error.v1',reference:{kind:'hero',sha256:HERO},relative:{p95:faces===1000?.0072:.004,max:.02,mean:.001}}}));
function world({tiers=TIERS,corruptBytes=false,ownsPreparation=()=>false}={}){
  const calls=[],loaded=[];
  const fetchJson=async url=>{calls.push(url);const q=new URL(url,'http://k');const faces=Number(q.searchParams.get('faces'));
    const levels=q.searchParams.get('source')===HERO?tiers.map(t=>({...t,source:`/api/read?root=generated-meshes&path=${t.sha256}.glb`})):[];
    const fitting=levels.filter(l=>l.faces<=faces);return {schema:'kaminos.lod-set.v0',source:q.searchParams.get('source'),levels,choice:fitting[0]??levels.at(-1)??null,withinBudget:!!fitting.length};};
  const fetchBytes=async url=>{const s=new URL(url,'http://k').searchParams.get('path').slice(0,64);const t=tiers.find(t=>t.sha256===s);return corruptBytes?new ArrayBuffer(3):tierBytes(t.faces);};
  const parseGlb=async bytes=>{const g=new THREE.Group();const m=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());g.add(m);g.userData.faces=new TextDecoder().decode(bytes);loaded.push(g);return g;};
  return {calls,loaded,registry:createGiProxyRegistry({THREE,fetchJson,fetchBytes,parseGlb,ownsPreparation})};
}
function sceneObject(source,generation=null){const scene=new THREE.Scene(),root=new THREE.Group();root.position.set(1,2,3);root.scale.setScalar(1.6);
  root.userData.kaminosSceneObject={source,generation};scene.add(root);scene.updateMatrixWorld(true);return {scene,root};}
const heroSource=`/api/read?root=generated-meshes&path=${HERO}.glb`;

test('a TRELLIS mesh object gets its 1000-face tier by default, loaded but never added to the scene',async()=>{
  const {registry,calls,loaded}=world(),{scene,root}=sceneObject(heroSource);
  const h=await registry.attach(root);
  assert.equal(h.state,'loaded');assert.equal(h.representation,'mesh');assert.equal(h.heroSha,HERO);
  assert.deepEqual(h.requested,{faces:1000});assert.equal(h.effective.faces,1000);assert.equal(h.effective.sha,TIERS[1].sha256);assert.equal(h.effective.withinBudget,true);
  assert.deepEqual(h.levels.map(l=>l.faces),[5000,1000,500]);
  assert.equal(h.error.reference.kind,'hero');assert.equal(h.error.units,'fraction of the hero bounding-box diagonal');assert.equal(h.error.relative.p95,.0072);
  assert.equal(h.proxyRoot,loaded[0]);assert.equal(h.proxyRoot.parent,null,'never in the scene graph');assert.equal(root.children.length,0,'no child added to the object');
  const route=new URL(calls[0],'http://kaminos.local');
  assert.equal(route.pathname,'/api/mesh-lods');
  assert.equal(route.searchParams.get('source'),HERO);
  assert.equal(route.searchParams.get('faces'),'1000');
  assert.equal(route.searchParams.get('prepare'),'auto','stored mesh arrival enrolls missing quality in background preparation');
  assert.equal(registry.get(root),h);
});

test('placement puts the proxy exactly where the object draws, following later moves',async()=>{
  const {registry}=world(),{scene,root}=sceneObject(heroSource);const h=await registry.attach(root);
  const p=h.placement(scene);assert.ok(p.equals(new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(root.matrixWorld)));
  root.position.x=9;const q=h.placement(scene);assert.ok(Math.abs(q.elements[12]-9)<1e-9,'recomputed from the current root, not cached');
});

test('client-owned generation or import preparation does not also enroll a server bake',async()=>{
  const {registry,calls}=world({ownsPreparation:()=>true});
  await registry.attach(sceneObject(heroSource).root);
  assert.equal(new URL(calls[0],'http://local').searchParams.get('prepare'),'client');
});

test('the GI renderer can choose another tier by faces or by error; the newest choice wins',async()=>{
  const {registry}=world(),{root}=sceneObject(heroSource);await registry.attach(root);
  const slow=registry.select(root,{faces:5000}),fast=registry.select(root,{faces:500});
  const [a,b]=await Promise.all([slow,fast]);assert.equal(registry.get(root).effective.faces,500);assert.equal(b.effective.faces,500);
  assert.equal(a.superseded,true,'an older selection reports that it was superseded');
});

test('a surfel asset resolves its hero tiers through meshSha256 and points at its own coarse surfels',async()=>{
  const {registry}=world(),{root}=sceneObject(`/api/read?root=generated-meshes&path=${SURF}.glb`,{representation:'trellis-surfels',meshSha256:HERO});
  const surfels=new THREE.Group();surfels.isTrellisSurfelRoot=true;surfels.surfelOptions={levels:[1,2,4]};root.add(surfels);
  const h=await registry.attach(root);
  assert.equal(h.representation,'surfels');assert.equal(h.assetSha,SURF);assert.equal(h.heroSha,HERO);assert.equal(h.state,'loaded');
  assert.equal(h.surfels.root,surfels);assert.deepEqual(h.surfels.levels,[1,2,4]);assert.equal(h.surfels.coarsest,4);
});

test('a surfels-only asset with raw-decode tiers registered under its own assetSha loads those tiers as its GI proxy',async()=>{
  const {calls,loaded}=world();
  const registry=createGiProxyRegistry({
    THREE,
    fetchJson:async url=>{
      calls.push(url);const q=new URL(url,'http://k');const faces=Number(q.searchParams.get('faces'));
      const levels=q.searchParams.get('source')===SURF?TIERS.map(t=>({...t,source:`/api/read?root=generated-meshes&path=${t.sha256}.glb`})):[];
      const fitting=levels.filter(l=>l.faces<=faces);
      return {schema:'kaminos.lod-set.v0',source:q.searchParams.get('source'),levels,choice:fitting[0]??levels.at(-1)??null,withinBudget:!!fitting.length};
    },
    fetchBytes:async url=>tierBytes(TIERS.find(t=>url.includes(t.sha256)).faces),
    parseGlb:async bytes=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));loaded.push(g);return g;},
  });
  const {root}=sceneObject(`/api/read?root=generated-meshes&path=${SURF}.glb`,{representation:'trellis-surfels'});
  const surfels=new THREE.Group();surfels.isTrellisSurfelRoot=true;surfels.surfelOptions={levels:[1,4,8,16]};root.add(surfels);
  const h=await registry.attach(root);
  assert.equal(h.state,'loaded');assert.equal(h.representation,'surfels');assert.equal(h.assetSha,SURF);assert.equal(h.heroSha,null);
  assert.equal(h.effective.faces,1000);assert.equal(h.proxyRoot,loaded[0]);assert.equal(h.surfels.coarsest,16);
  const route=new URL(calls[0],'http://kaminos.local');
  assert.equal(route.searchParams.get('source'),SURF);
  assert.equal(route.searchParams.get('faces'),'1000');
});

test('objects with no TRELLIS tiers say why, and nothing is loaded',async()=>{
  const {registry,loaded}=world({tiers:[]});
  assert.equal((await registry.attach(sceneObject(heroSource).root)).state,'no-tiers');
  assert.equal((await registry.attach(sceneObject('/kiln.glb').root)).state,'not-generated');
  const so=sceneObject(`/api/read?root=generated-meshes&path=${SURF}.glb`,{representation:'trellis-surfels'});const s=new THREE.Group();s.isTrellisSurfelRoot=true;so.root.add(s);
  const h=await registry.attach(so.root);assert.equal(h.state,'no-tiers');assert.match(h.reason,/surfels-only/);
  assert.equal(loaded.length,0);
});

test('a proxy whose bytes do not match its sha is refused',async()=>{
  const {registry}=world({corruptBytes:true}),h=await registry.attach(sceneObject(heroSource).root);
  assert.equal(h.state,'failed');assert.match(h.failure,/content/);assert.equal(h.proxyRoot,null);
});

test('release disposes the proxy and forgets the object',async()=>{
  const {registry}=world(),{root}=sceneObject(heroSource);const h=await registry.attach(root);
  let disposed=0;h.proxyRoot.traverse(m=>{if(m.isMesh)m.geometry.addEventListener('dispose',()=>disposed++);});
  registry.release(root);assert.equal(disposed,1);assert.equal(registry.get(root),null);assert.equal(registry.list().length,0);
});

const disposals=root=>{const seen=[];root.traverse(m=>{if(m.isMesh)m.geometry.addEventListener('dispose',()=>seen.push(m.userData.tag??'proxy'));});return seen;};
test('GI-PROXY-02: changing the selection disposes the proxy it replaces, and release disposes the current one',async()=>{
  const {registry}=world(),{root}=sceneObject(heroSource);
  const first=await registry.attach(root);const firstDisposed=disposals(first.proxyRoot);
  const second=await registry.select(root,{faces:500});assert.equal(firstDisposed.length,1,'the replaced 1000-face proxy is disposed');
  const secondDisposed=disposals(second.proxyRoot);registry.release(root);assert.equal(secondDisposed.length,1);
});
test('GI-PROXY-03: after release and reattachment, a request from before the release can never win',async()=>{
  let hold;const gate=new Promise(r=>{hold=r;});
  const w=world(),{root}=sceneObject(heroSource);
  const slowRegistry=createGiProxyRegistry({THREE,fetchJson:async url=>{if(/faces=1000/.test(url))await gate;return (await w.registry.attach(sceneObject(heroSource).root),{schema:'kaminos.lod-set.v0',levels:TIERS.map(t=>({...t,source:`/api/read?root=generated-meshes&path=${t.sha256}.glb`})),choice:{...TIERS.find(t=>t.faces===(/faces=1000/.test(url)?1000:500)),source:`/api/read?root=generated-meshes&path=${TIERS.find(t=>t.faces===(/faces=1000/.test(url)?1000:500)).sha256}.glb`},withinBudget:true});},
    fetchBytes:async url=>tierBytes(TIERS.find(t=>url.includes(t.sha256)).faces),parseGlb:async()=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));return g;}});
  const old=slowRegistry.attach(root);slowRegistry.release(root);
  const fresh=await slowRegistry.attach(root,{faces:500});hold();const stale=await old;
  assert.equal(slowRegistry.get(root).effective.faces,500,'the newer selection stands');assert.equal(stale.superseded,true);assert.equal(fresh.effective.faces,500);
});
test('GI-PROXY-04: release disposes the proxy materials\' textures too',async()=>{
  const textures=[];
  const w=world(),registry=createGiProxyRegistry({THREE,fetchJson:async url=>{const s=await w.registry.attach(sceneObject(heroSource).root);return {schema:'kaminos.lod-set.v0',levels:[],choice:{...TIERS[1],source:`/api/read?root=generated-meshes&path=${TIERS[1].sha256}.glb`},withinBudget:true};},
    fetchBytes:async()=>tierBytes(1000),parseGlb:async()=>{const map=new THREE.Texture(),normalMap=new THREE.Texture();for(const t of [map,normalMap])t.addEventListener('dispose',()=>textures.push(t));
      const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({map,normalMap})));return g;}});
  const {root}=sceneObject(heroSource);await registry.attach(root);registry.release(root);
  assert.equal(textures.length,2,'map and normalMap are disposed');
});
test('GI-PROXY-01: clearing the registry (a cleared or reopened scene) disposes every proxy and ignores late results',async()=>{
  const {registry}=world(),a=sceneObject(heroSource),b=sceneObject(heroSource);
  const ha=await registry.attach(a.root);const da=disposals(ha.proxyRoot);const pending=registry.attach(b.root);
  registry.clear();assert.equal(da.length,1);assert.equal(registry.list().length,0);
  const late=await pending;assert.equal(late.superseded,true);assert.equal(registry.list().length,0,'a result arriving after the clear is not published');
});

test('GI-PROXY-01: the page clears the registry when it clears a scene, and releases a removed object',async()=>{
  const fs=await import('node:fs'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const body=name=>{const a=html.indexOf(`function ${name}(`);let depth=0,i=html.indexOf(") {",a)+2;for(;i<html.length;i++){if(html[i]==='{')depth++;else if(html[i]==='}'&&--depth===0)break;}return html.slice(a,i);};
  const {createWorkingScene}=await import('../working-scene.mjs'),{createSceneLifecycle}=await import('../scene-lifecycle.mjs'),vm=await import('node:vm');
  const {registry}=world(),{root}=sceneObject(heroSource);await registry.attach(root);let disposed=0;
  registry.get(root).proxyRoot.traverse(node=>node.geometry?.addEventListener('dispose',()=>disposed++));
  const h=vm.createContext({workbenchViewerReady:Promise.resolve(),authoringGenerateLayout:null,generationWorkshop:null,createSceneLifecycle,prepareSavedSceneAssets:async()=>null,workingScene:createWorkingScene(),scene:{remove(){}},disposeObjectTree(){},setSceneObjectMounted(){},restoreLoadedSceneRecord(){},setSceneGroupsFromRecords(){},setSceneSelection(){},setActiveSceneObject(){},setActiveSceneGroup(){},
    volumePrototype:null,setVolumePrimitivesState(){},VOLUME_PRIMITIVE_SCHEMA:"kaminos.volume-primitives.v0",clearSceneEditingState(){},clearSceneTransient(){},projectClearedScene(){},sceneGiProxies:registry,waterFeature:{clear(){}},authoredAsh:new Map(),retireSceneFlame:async()=>{},flameFeature:{clear:async()=>{}},setInfo(){},sceneSpotLights:new Map()});
  const extract=name=>{const a=html.indexOf('function '+name+'('),b=html.indexOf('\n}',a)+2;assert.ok(a>=0&&b>a);return html.slice(a,b);};
  vm.runInContext(extract('createPageSceneLifecycle')+'\n'+extract('clearSceneDomains'),h);
  h.sceneLifecycle=h.createPageSceneLifecycle();
  const start=html.indexOf('async function clearScene('),end=html.indexOf('\nfunction clearSceneEditingState(',start);
  await vm.runInContext(html.slice(start,end)+'\nclearScene();',h);
  assert.equal(registry.list().length,0);assert.equal(disposed,1,'page lifecycle must release the real proxy registry');
  assert.match(body('createPageSceneMembershipOperations'),/sceneGiProxies\.release\(entry\.object\)/);
});

test('GI-PROXY-04: a texture or material shared within the proxy is disposed once',async()=>{
  const counts={texture:0,material:0};
  const registry=createGiProxyRegistry({THREE,fetchJson:async()=>({schema:'kaminos.lod-set.v0',levels:[],choice:{...TIERS[1],source:`/api/read?root=generated-meshes&path=${TIERS[1].sha256}.glb`},withinBudget:true}),
    fetchBytes:async()=>tierBytes(1000),parseGlb:async()=>{const t=new THREE.Texture();t.addEventListener('dispose',()=>counts.texture++);
      const m=new THREE.MeshStandardMaterial({roughnessMap:t,metalnessMap:t});m.addEventListener('dispose',()=>counts.material++);
      const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(),m),new THREE.Mesh(new THREE.BoxGeometry(),m));return g;}});
  const {root}=sceneObject(heroSource);await registry.attach(root);registry.release(root);
  assert.deepEqual(counts,{texture:1,material:1});
});

test('the registry knows whether any GI pass consumes proxies, so a setting that changes nothing on screen can say so',()=>{
  const {registry}=world();
  assert.deepEqual(registry.consumers(),[],'no GI pass has declared it reads proxies');
  const release=registry.registerConsumer('ssgi-proxy-source');
  assert.deepEqual(registry.consumers(),['ssgi-proxy-source']);
  release();assert.deepEqual(registry.consumers(),[]);
  assert.throws(()=>registry.registerConsumer(''),/name/);
});

test('Review N4: index.html wires window.kaminosGiProxies.prepare and importSceneMesh background tier preparation', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /prepare:\s*async\s*\(rootOrSha,\s*options\s*=\s*\{\}\)\s*=>/, 'window.kaminosGiProxies exposes prepare(rootOrSha, options)');
  const importStart = html.indexOf('async function importSceneMesh(');
  assert.ok(importStart > 0);
  const importBody = html.slice(importStart, html.indexOf('const meshDataTargets=', importStart));
  assert.match(importBody, /window\.kaminosGiProxies\?\.prepare\?\.\(digest,\s*\{heroGLB:/, 'importSceneMesh triggers background GI proxy tier preparation on imported GLBs');
});

test('named .glb files in generated-meshes resolve through /api/mesh-lods and adopt the canonical sha256', async () => {
  const calls = [], loaded = [];
  const registry = createGiProxyRegistry({
    THREE,
    fetchJson: async url => {
      calls.push(url);
      const q = new URL(url, 'http://k');
      const src = q.searchParams.get('source');
      if (src === 'trellis-kiln-mlx1024-500k.glb') {
        const levels = TIERS.map(t => ({...t, source: `/api/read?root=generated-meshes&path=${t.sha256}.glb`}));
        return {schema: 'kaminos.lod-set.v0', source: HERO, levels, choice: levels[1], withinBudget: true};
      }
      if (src === 'untiered-kiln.glb') {
        return {schema: 'kaminos.lod-set.v0', source: HERO, levels: [], choice: null, withinBudget: false};
      }
      throw Error('unexpected source ' + src);
    },
    fetchBytes: async () => tierBytes(1000),
    parseGlb: async () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())); loaded.push(g); return g; },
  });
  const namedLoaded = await registry.attach(sceneObject('/api/read?root=generated-meshes&path=trellis-kiln-mlx1024-500k.glb').root);
  assert.equal(namedLoaded.state, 'loaded');
  assert.equal(namedLoaded.heroSha, HERO);
  assert.equal(namedLoaded.assetSha, HERO);
  const namedUntiered = await registry.attach(sceneObject('/api/read?root=generated-meshes&path=untiered-kiln.glb').root);
  assert.equal(namedUntiered.state, 'no-tiers');
  assert.equal(namedUntiered.heroSha, HERO);
  assert.equal(namedUntiered.assetSha, HERO);
});

for(const state of ['loaded','no-tiers','disabled'])test(`queued quality preparation preserves ${state} arrival without duplicate client ownership`,async()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function applyGiProxySetting(entry){'),end=html.indexOf('\nfunction writeObjectGiProxy(',start);
  const entry={id:'existing',giProxy:{enabled:true,selection:{faces:1000}},object:{}};
  const h={state,heroSha:HERO,levels:state==='loaded'?TIERS:[],prepareQueued:true};
  let release,refreshes=0,selections=0;const gate=new Promise(resolve=>{release=resolve;});
  const registry={select:async()=>++selections===1?h:{...h,prepareQueued:false},whenPrepared:()=>gate};
  let clientPrepares=0;
  const win={kaminosGiProxies:{prepare:async()=>{clientPrepares++;}},_kaminosDirty(){},kaminosFireLightingSettings:{sync(){}},__kaminosRefreshLodSource:async source=>{assert.equal(source,HERO);refreshes++;}};
  const apply=new Function('sceneGiProxies','syncSceneDataInspector','window','setInfo','autoPreparedLodSources','prepareSceneNavigationRoot','workingScene',html.slice(start,end)+';return applyGiProxySetting;')(registry,()=>{},win,()=>{},new Set(),()=>{},{objects:[entry]});
  let result;
  try{result=await Promise.race([apply(entry),new Promise(resolve=>setImmediate(()=>resolve('blocked')))]);}
  finally{release({...h,prepareQueued:false});}
  assert.equal(result,h,'available geometry must return before the queued quality job finishes');
  assert.equal(clientPrepares,0,'server pending ownership must suppress the client fallback');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(refreshes,1);
});

test('applyGiProxySetting auto-prepares missing tiers once per heroSha and LOD refresh preserves live burn bodies', async () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('const autoPreparedLodSources = new Set(), inFlightLodPrepares = new Map();'), 'index.html defines autoPreparedLodSources and inFlightLodPrepares');
  const start = html.indexOf('function applyGiProxySetting(entry){');
  const end = html.indexOf('\nfunction writeObjectGiProxy(', start);
  const snippet = html.slice(start, end);
  const prepared = [];
  const autoPreparedLodSources = new Set();
  const window = {
    kaminosFireLightingSettings: {sync() {}},
    _kaminosDirty() {},
    kaminosGiProxies: {
      prepare: async (sha, opts) => {
        prepared.push({sha, opts});
        return {phase: 'done', tiers: [{faces: 1000}]};
      },
    },
  };
  const sceneGiProxies = {
    select: async () => ({state: 'no-tiers', heroSha: HERO, assetSha: HERO}),
    disable() {},
  };
  const fn = new Function('sceneGiProxies', 'syncSceneDataInspector', 'window', 'setInfo', 'autoPreparedLodSources', 'prepareSceneNavigationRoot', `${snippet}; return applyGiProxySetting;`)(
    sceneGiProxies, () => {}, window, () => {}, autoPreparedLodSources, () => {}
  );
  const entry = {id: 'kiln-1', label: 'Kiln', giProxy: {enabled: true, selection: {faces: 1000}}, object: {}};
  await fn(entry);
  await fn(entry);
  assert.equal(prepared.length, 1, 'auto-prepare runs once per heroSha');
  assert.equal(prepared[0].sha, HERO);
  const refreshStart=html.indexOf('const refreshSceneObjectsForLodSource =');
  const refreshEnd=html.indexOf('\nwindow.__kaminosRefreshLodSource',refreshStart);
  assert.ok(refreshStart>=0&&refreshEnd>refreshStart);
  const refreshed=[],resident={fuel:.42,steps:71},other={id:'other',object:{}};
  const burning={read:()=>({state:{fields:[{surfaceLod:{tier:'hero'},...resident}]}}),
    forget(){assert.fail('LOD completion must not destroy resident burn history');},sync(){}};
  const refresh=new Function('workingScene','sceneGiProxies','applyGiProxySetting','sceneBurning',
    html.slice(refreshStart,refreshEnd)+';return refreshSceneObjectsForLodSource;')(
      {objects:[entry,other]},{get:root=>({heroSha:root===entry.object?HERO:'other'})},async row=>refreshed.push(row.id),burning);
  await refresh(HERO);
  assert.deepEqual(refreshed,[entry.id]);
  assert.equal(burning.read().state.fields[0].steps,71);
});



test('disabling a shadow proxy can retain its level catalog without releasing automatic beauty consumers', async () => {
  const {registry, loaded} = world();
  const {root} = sceneObject(heroSource);
  const initial = await registry.attach(root);
  let releases = 0;
  registry.onRelease(() => releases++);
  const disabled = await registry.disable(root, {retainLevels: true});
  assert.equal(disabled?.state, 'disabled');
  assert.equal(disabled.proxyRoot, null);
  assert.deepEqual(disabled.levels, initial.levels, 'automatic beauty retains the source ladder');
  assert.equal(loaded.length, 1, 'catalog retrieval never loads another proxy mesh');
  assert.equal(releases, 0, 'shadow opt-out does not release other LOD consumers');
  registry.release(root);
  assert.equal(releases, 1, 'object removal still releases all consumers');
});

test('a saved shadow opt-out resolves levels for beauty without fetching or parsing proxy geometry', async () => {
  const {registry, loaded, calls} = world();
  const {root} = sceneObject(heroSource);
  const disabled = await registry.disable(root, {retainLevels: true});
  assert.equal(disabled?.state, 'disabled');
  assert.deepEqual(disabled.levels.map(level => level.faces), [5000, 1000, 500]);
  assert.equal(loaded.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(registry.get(root).proxyRoot, null);
});


test('a cold shadow opt-out exposes catalog retrieval failure without loading geometry', async () => {
  const {root} = sceneObject(heroSource);
  const registry = createGiProxyRegistry({THREE,
    fetchJson: async () => { throw Error('catalog unavailable'); },
    fetchBytes: async () => { throw Error('proxy geometry must remain unloaded'); },
    parseGlb: async () => { throw Error('proxy geometry must remain unloaded'); },
  });
  await registry.disable(root, {retainLevels: true});
  assert.equal(registry.get(root).state, 'failed');
  assert.equal(registry.get(root).failure, 'catalog unavailable');
  assert.equal(registry.get(root).proxyRoot, null);
});

test('the actual page source refresh publishes new levels to shadow opt-outs and retains them through a failed refresh', async () => {
  const vm = await import('node:vm');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  let levels = [TIERS[2]], available = true, releases = 0;
  const {root} = sceneObject(heroSource);
  const registry = createGiProxyRegistry({THREE,
    fetchJson: async () => {
      if (!available) throw Error('catalog unavailable');
      return {source: HERO, levels, choice: levels[0]};
    },
    fetchBytes: async () => { throw Error('disabled shadows must not load proxy geometry'); },
    parseGlb: async () => { throw Error('disabled shadows must not parse proxy geometry'); },
  });
  registry.onRelease(() => releases++);
  const entry = {id: 'refresh-kiln', type: 'glb', source: heroSource, object: root,
    giProxy: {enabled: false, selection: {faces: 1000}}, label: 'Kiln'};
  const context = vm.createContext({Promise, workingScene: {objects: [entry]}, sceneGiProxies: registry,
    autoPreparedLodSources: new Set(), sceneColliderCollection: null, sceneBurning: null,
    syncSceneDataInspector() {}, prepareSceneNavigationRoot() {},
    window: {kaminosFireLightingSettings: {sync() {}}, _kaminosDirty() {}},
  });
  const refreshStart = html.indexOf('const refreshSceneObjectsForLodSource = async source => {');
  const refreshEnd = html.indexOf('\nwindow.__kaminosRefreshLodSource', refreshStart);
  const applyStart = html.indexOf('function applyGiProxySetting(entry)');
  const applyEnd = html.indexOf('\nfunction writeObjectGiProxy(', applyStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart && applyStart >= 0 && applyEnd > applyStart);
  vm.runInContext(html.slice(refreshStart, refreshEnd) + '\n' + html.slice(applyStart, applyEnd) +
    '\nglobalThis.refresh = refreshSceneObjectsForLodSource;', context);
  await context.applyGiProxySetting(entry);
  assert.deepEqual(registry.get(root).levels.map(level => level.faces), [500]);
  levels = [TIERS[0], TIERS[2]];
  await context.refresh(HERO);
  assert.deepEqual(registry.get(root).levels.map(level => level.faces), [5000, 500], 'completed preparation must publish its new ladder');
  available = false;
  await context.refresh(HERO);
  assert.deepEqual(registry.get(root).levels.map(level => level.faces), [5000, 500], 'failed refresh preserves the last usable catalog');
  assert.equal(registry.get(root).state, 'disabled');
  assert.equal(registry.get(root).catalogFailure, 'catalog unavailable');
  assert.equal(registry.get(root).proxyRoot, null);
  assert.equal(releases, 0, 'refresh never releases resident beauty consumers');
  registry.clear();
});
