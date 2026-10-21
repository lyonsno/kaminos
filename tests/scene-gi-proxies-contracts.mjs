// kaminos-test: node — each TRELLIS-derived scene object gets a GI proxy handle: a stored low tier of its hero, loaded
// outside the frame loop, never in the scene, placed exactly where the object draws; surfel assets also point at their
// own coarse surfels. Pass policy is the GI renderer's; this only resolves, loads and places.
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import * as THREE from '../lib/three.core.js';
import {createGiProxyRegistry} from '../scene-gi-proxies.mjs';

const HERO='a'.repeat(64),SURF='b'.repeat(64);
const tierBytes=faces=>new TextEncoder().encode(`tier-${faces}`).buffer;
const sha=b=>createHash('sha256').update(new Uint8Array(b)).digest('hex');
const TIERS=[5000,1000,500].map(faces=>({faces,sha256:sha(tierBytes(faces)),closed:true,error:{schema:'kaminos.lod-geometric-error.v1',reference:{kind:'hero',sha256:HERO},relative:{p95:faces===1000?.0072:.004,max:.02,mean:.001}}}));
function world({tiers=TIERS,corruptBytes=false}={}){
  const calls=[],loaded=[];
  const fetchJson=async url=>{calls.push(url);const q=new URL(url,'http://k');const faces=Number(q.searchParams.get('faces'));
    const levels=q.searchParams.get('source')===HERO?tiers.map(t=>({...t,source:`/api/read?root=generated-meshes&path=${t.sha256}.glb`})):[];
    const fitting=levels.filter(l=>l.faces<=faces);return {schema:'kaminos.lod-set.v0',source:q.searchParams.get('source'),levels,choice:fitting[0]??levels.at(-1)??null,withinBudget:!!fitting.length};};
  const fetchBytes=async url=>{const s=new URL(url,'http://k').searchParams.get('path').slice(0,64);const t=tiers.find(t=>t.sha256===s);return corruptBytes?new ArrayBuffer(3):tierBytes(t.faces);};
  const parseGlb=async bytes=>{const g=new THREE.Group();const m=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());g.add(m);g.userData.faces=new TextDecoder().decode(bytes);loaded.push(g);return g;};
  return {calls,loaded,registry:createGiProxyRegistry({THREE,fetchJson,fetchBytes,parseGlb})};
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
  assert.match(calls[0],/\/api\/mesh-lods\?source=a{64}&faces=1000/);
  assert.equal(registry.get(root),h);
});

test('placement puts the proxy exactly where the object draws, following later moves',async()=>{
  const {registry}=world(),{scene,root}=sceneObject(heroSource);const h=await registry.attach(root);
  const p=h.placement(scene);assert.ok(p.equals(new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(root.matrixWorld)));
  root.position.x=9;const q=h.placement(scene);assert.ok(Math.abs(q.elements[12]-9)<1e-9,'recomputed from the current root, not cached');
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
  assert.match(body('clearScene'),/sceneGiProxies\.clear\(\)/);
  assert.match(body('removeSceneObjectInternal'),/sceneGiProxies\.release\(entry\.object\)/);
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
