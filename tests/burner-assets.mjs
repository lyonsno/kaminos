// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createAuthoringAssets} from '../authoring-assets.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';

const observed=[
 ['crown-ring','Crown · Ring burner','5c3025c41147a55cb1ec9cc722598d8d901279e87a1fa5ca4251de834f211e6e',12],
 ['seam-rail','Seam · Slot burner','a4b55a1082d64566860975d7080cb2d895fef8b33af9482ba0f118a819e21f7f',1],
 ['lance-nozzle','Lance · Angled nozzle','90e26d01f891005cf62813a956050b85da1ca8be338e297d73add55d3fd6c4b0',1],
];
const catalog=()=>createAuthoringAssets({request:async url=>{assert.equal(url,'/api/roots');return {};}});
test('Burners is available without an external asset directory, with the three operator-confirmed designs',async()=>{
 const c=catalog();assert.equal(await c.refresh(),true);assert.ok(c.read().roots.some(r=>r.id==='burners'));
 assert.equal(await c.browse('burners'),true);assert.equal(c.read().catalog,true);assert.equal(c.read().path,'');
 assert.deepEqual(c.read().entries.map(e=>[e.id,e.label]),observed.map(([id,label])=>[id,label]));
});
test('late external browsing cannot replace the built-in burner choice',async()=>{
 let resolve;const c=createAuthoringAssets({request:url=>{if(!url.includes('collection=greenroom'))throw Error('unexpected remote browse');return new Promise(r=>resolve=r);}});
 const pending=c.browse('greenroom');await c.browse('burners');const entry=c.read().entries[0];assert.ok(entry);c.select(entry);
 resolve({schema:'kaminos.authoring-assets.v1',collection:'greenroom',entries:[]});await pending;
 assert.equal(c.read().selected.id,'crown-ring');assert.equal(c.read().entries.length,3);
});
test('burners use ordinary mesh insertion and preserve design provenance in saved scene records',async()=>{
 let received;const c=createAuthoringAssets({request:async()=>{throw Error('unexpected backend browse');},addMesh:async e=>{received=e;return 'inserted';}});
 assert.equal(await c.browse('burners'),true);
 for(const entry of c.read().entries){c.select(entry);assert.equal(await c.add(),'inserted');assert.equal(received.kind,'mesh');assert.match(received.source,/^\.\/assets\/burners\/.+\.glb$/);assert.equal(received.assetOrigin.source,received.source);
  const saved=buildSceneDocument({objects:[{id:'copy',type:'glb',source:'/api/read?root=generated-meshes&path=retained.glb',assetOrigin:received.assetOrigin}]});
  assert.deepEqual(planSceneRestore(saved).objects[0].assetOrigin,received.assetOrigin);
 }
});
test('bundled GLBs are the exact observed designs, retaining each proposed outlet without a runtime binding',async()=>{
 const c=catalog();assert.equal(await c.browse('burners'),true);
 for(const [id,,sha,count] of observed){const entry=c.read().entries.find(e=>e.id===id);assert.ok(entry);
  const bytes=await readFile(new URL('../'+entry.source,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);
  assert.equal(entry.assetOrigin.sha256,sha);assert.equal(bytes.toString('ascii',0,4),'glTF');
  const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const ports=json.nodes.filter(n=>n.extras?.role==='proposed-emission-opening');assert.equal(ports.length,count);assert.ok(ports.every(n=>n.extras.runtimeBinding===null));
 }
});
