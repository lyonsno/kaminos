// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DEFAULT_RECIPE} from '../experiments/stock-family/model.mjs';
import {saveFamilyAsset,validateFamilyAsset,openStockFamilyAsset} from '../experiments/stock-family/library.mjs';
const bytes=new TextEncoder().encode('observed fixture'),sha=createHash('sha256').update(bytes).digest('hex'),url=`/api/read?root=generated-meshes&path=${sha}.glb`;
const source={...DEFAULT_RECIPE.source,sha256:sha,url:'/api/job-output?job_id=fixture&file=output.glb'},recipe={...DEFAULT_RECIPE,source,sources:[source]},id='12345678-1234-1234-1234-123456789abc';
test('retains source bytes internally and keeps the original locator in a named editable family',async()=>{
 const calls=[];const request=async(path,options)=>{calls.push(path);if(path===source.url)return new Response(bytes);if(path==='/api/ingest-mesh')return Response.json({schema:'kaminos.generated-mesh.v0',sha256:sha,bytes:bytes.length,source:url});const input=JSON.parse(options.body);assert.equal(input.id,id);assert.equal(input.recipe.source.url,url);assert.equal(input.recipe.source.originUrl,source.url);return Response.json({schema:'kaminos.stock-family-asset.v1',id,name:input.name,revision:'b'.repeat(64),recipe:input.recipe});};
 const saved=await saveFamilyAsset({recipe,name:'Channels',id,revision:'a'.repeat(64)},{request});assert.equal(saved.name,'Channels');assert.deepEqual(saved.recipe.variants,recipe.variants);assert.deepEqual(calls,[source.url,'/api/ingest-mesh','/api/stock-families']);assert.equal(recipe.source.url,source.url);
});
test('failed retention, wrong bytes, and stale server errors cannot report saved',async()=>{
 await assert.rejects(saveFamilyAsset({recipe,name:'Test'},{request:async()=>new Response('different')}),/Source changed/);
 await assert.rejects(saveFamilyAsset({recipe,name:'Test'},{request:async path=>path===source.url?new Response(bytes):Response.json({schema:'kaminos.generated-mesh.v0',sha256:sha,bytes:bytes.length,source:'/wrong'})}),/identity mismatch/);
 await assert.rejects(saveFamilyAsset({recipe:{...recipe,source:{...source,url},sources:[]},name:'Test'},{request:async path=>path===url?new Response(bytes):Response.json({error:'Family changed in another tab'},{status:409})}),/another tab/);
 assert.throws(()=>validateFamilyAsset({schema:'kaminos.stock-family-asset.v1',name:'Bad'}),/Invalid saved/);
});
test('withheld or non-family selection never opens an experiment',async()=>{
 await assert.rejects(openStockFamilyAsset({kind:'stock-family',visibility:{status:'withheld'}},{}),/available/);
 await assert.rejects(openStockFamilyAsset({kind:'mesh'},{}),/available/);
});
test('native family open keeps a live internal address, not an inline revision snapshot',async()=>{
 const previous=globalThis.fetch,calls=[];globalThis.fetch=async()=>Response.json({schema:'kaminos.stock-family-asset.v1',id,name:'Test',revision:'a'.repeat(64),recipe});
 try{await openStockFamilyAsset({kind:'stock-family',source:'/api/read?root=generated-meshes&path='+id+'.stock-family.json'},{kaminosWorkbenchExperiments:{open:async(...args)=>calls.push(args)},kaminosAssets:{close(){}},kaminosWorkspace:{setMode(){}}});
 assert.deepEqual(calls,[['stock-family',{assetSource:'/api/read?root=generated-meshes&path='+id+'.stock-family.json'}]]);
 }finally{globalThis.fetch=previous;}
});
test('malformed retained reference poses fail before creating scene objects',()=>{
 assert.throws(()=>validateFamilyAsset({schema:'kaminos.stock-family-asset.v1',id,name:'Test',revision:'a'.repeat(64),recipe:{...recipe,referencePose:{position:[0,0],rotation:[0,0,0],scale:[1,1,1]}}}),/reference pose/);
});
test('support sources retain their own bytes and local identity alongside the family source',async()=>{
 const supportBytes=new TextEncoder().encode('support fixture'),supportSha=createHash('sha256').update(supportBytes).digest('hex'),supportUrl=`/api/read?root=generated-meshes&path=${supportSha}.glb`,calls=[];
 const support={label:'Timber post',source:{...source,sha256:supportSha,url:'/support-job.glb'},pose:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]}};
 const request=async(path,options)=>{calls.push(path);if(path===source.url)return new Response(bytes);if(path===support.source.url)return new Response(supportBytes);
  if(path==='/api/ingest-mesh'){const isSupport=new Uint8Array(options.body).length===supportBytes.length;return Response.json({schema:'kaminos.generated-mesh.v0',sha256:isSupport?supportSha:sha,bytes:isSupport?supportBytes.length:bytes.length,source:isSupport?supportUrl:url});}
  const input=JSON.parse(options.body);return Response.json({schema:'kaminos.stock-family-asset.v1',id,name:input.name,revision:'b'.repeat(64),recipe:input.recipe});};
 const saved=await saveFamilyAsset({recipe:{...recipe,supports:[support]},name:'Supported channels'},{request});
 assert.equal(saved.recipe.supports[0].source.url,supportUrl);assert.equal(saved.recipe.supports[0].source.originUrl,support.source.url);assert.ok(calls.includes(support.source.url));assert.deepEqual(support.source.url,'/support-job.glb');
});
