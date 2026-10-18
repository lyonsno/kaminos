import * as THREE from './lib/three.webgpu.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// Explicit provisional Stunt Doubles mapping, 2026-10-17T14:43:30Z; no measured-error selection.
export const KILN_CASTER_SOURCE='f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b';
export const KILN_CASTERS=Object.freeze({'5k':'1050a1d34389366eac0161ea002176fece47c7eeaac53a7795bae63ed4807456','10k':'11319add7e7593d80f33ec9c25b6f43c531122d423b9a25ef06b86b71b2d7470'});
export function validateCasterLevel(v){if(!['original',...Object.keys(KILN_CASTERS)].includes(v))throw Error('unknown fire shadow caster level');return v;}
export async function loadFireCaster(level){
  validateCasterLevel(level);const hash=KILN_CASTERS[level];
  const response=await fetch(`/api/read?root=generated-meshes&path=${hash}.glb`);
  if(!response.ok)throw Error(`fire caster ${level} unavailable: HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==hash)throw Error('fire caster content identity mismatch');
  // Depth only: preserve geometry/node matrices; do not decode unused PBR images.
  const loader=new GLTFLoader().register(parser=>({name:'KaminosDepthOnlyCaster',beforeRoot(){for(const mesh of parser.json.meshes??[])for(const p of mesh.primitives)delete p.material;}}));
  const {scene}=await loader.parseAsync(bytes,'');scene.traverse(m=>{if(m.isMesh)m.castShadow=true;});return scene;
}
const release=root=>root.traverse(m=>{if(m.isMesh){m.geometry.dispose();for(const a of Array.isArray(m.material)?m.material:[m.material])a.dispose();}});
const matches=root=>{const s=root.userData?.kaminosSceneObject?.source;if(typeof s!=='string')return false;const u=new URL(s,'http://kaminos.local');return u.pathname==='/api/read'&&u.searchParams.get('root')==='generated-meshes'&&u.searchParams.get('path')===`${KILN_CASTER_SOURCE}.glb`;};
export function createFireShadowCasters({scene,load=loadFireCaster}){
  let level='original',requested='original',generation=0,disposed=false,error=null,active=false;
  const assets=new Map(),instances=new Map(),fingerprints=new WeakMap(),state={targets:0,originalTriangles:0,captureTriangles:0};
  const clear=()=>{for(const {wrapper}of instances.values()){wrapper.removeFromParent();wrapper.traverse(m=>{if(m.isMesh)m.material.dispose();});}instances.clear();};
  return {
    async setLevel(v){
      validateCasterLevel(v);if(disposed)throw Error('fire caster consumer disposed');const version=++generation;requested=v;error=null;
      if(v==='original'){level=v;clear();Object.assign(state,{targets:0,originalTriangles:0,captureTriangles:0});return;}
      try{if(!assets.has(v)){const asset=await load(v);if(disposed||version!==generation){release(asset);return;}assets.set(v,asset);}if(version===generation){level=v;clear();}}
      catch(e){if(version===generation)error=String(e.message);throw e;}
    },
    withCapture(fn){
      if(disposed)throw Error('fire caster consumer disposed');if(level==='original'||active)return fn();
      scene.updateMatrixWorld(true);const roots=[];scene.traverseVisible(r=>{if(matches(r))roots.push(r);});
      const hidden=[];Object.assign(state,{targets:0,originalTriangles:0,captureTriangles:0});
      try{active=true;for(const root of roots){
        const meshes=[];root.traverseVisible(m=>{if(m.isMesh&&m.castShadow)meshes.push(m);});if(!meshes.length)continue;
        if(meshes.some(m=>m.isSkinnedMesh||m.isInstancedMesh||m.morphTargetInfluences?.length))throw Error('fire caster substitution requires static geometry');
        if(!root.matrixWorld.elements.every(Number.isFinite)||root.matrixWorld.determinant()===0)throw Error('fire caster requires a finite invertible source transform');
        if(meshes.some(m=>(Array.isArray(m.material)?m.material:[m.material]).some(a=>a.transparent||a.opacity<1||a.alphaTest>0||a.displacementMap)))throw Error('fire-shadow-unsupported-caster: reduced source must remain opaque and undisplaced');
        const key=JSON.stringify(meshes.map(m=>[m.uuid,m.geometry.uuid,m.geometry.attributes.position.version,m.geometry.index?.version,m.matrix.elements]));
        if(!fingerprints.has(root))fingerprints.set(root,key);if(fingerprints.get(root)!==key)throw Error('fire caster source geometry changed; choose original');
        const sides=new Set(meshes.flatMap(m=>(Array.isArray(m.material)?m.material:[m.material]).map(m=>m.side)));if(sides.size!==1)throw Error('fire caster source has mixed sidedness');
        let instance=instances.get(root);if(!instance){const wrapper=new THREE.Group(),proxy=assets.get(level).clone(true);proxy.traverse(m=>{if(m.isMesh)m.material=m.material.clone();});wrapper.matrixAutoUpdate=false;wrapper.add(proxy);instance={wrapper,proxy};instances.set(root,instance);}
        const {wrapper,proxy}=instance;wrapper.matrix.copy(scene.matrixWorld).invert().multiply(root.matrixWorld);
        proxy.traverse(m=>{if(m.isMesh){m.material.side=[...sides][0];state.captureTriangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;}});
        state.originalTriangles+=meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
        hidden.push([root,root.visible]);root.visible=false;scene.add(wrapper);state.targets++;
      }return fn();}finally{for(const [root,visible]of hidden)root.visible=visible;for(const {wrapper}of instances.values())wrapper.removeFromParent();active=false;}
    },
    debugState:()=>({level,requested,error,...state,asset:KILN_CASTERS[level]??null,source:KILN_CASTER_SOURCE,errorMeasured:false,scope:'point-shadow-captures-only'}),
    dispose(){if(disposed)return;disposed=true;generation++;clear();for(const a of assets.values())release(a);assets.clear();},
  };
}
