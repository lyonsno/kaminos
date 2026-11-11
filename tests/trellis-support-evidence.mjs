// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import {assertSupportInspection} from '../trellis-support-evidence.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const fixture=()=>({initial:{backend:'WebGPU',candidate:{originalTriangles:187308,supportTriangles:12,sourcePatchTriangles:2,sourceTriangleIds:[1],boundarySegments:2}},sourceBytes:{sha256:'fb92b5218ec297d51020f6008c5b69779c544589aa56b2e22ecf399f7ad7c45d'},changed:{region:{origin:[.16,0,0]},pending:false,candidate:{sourceTriangleIds:[2]}},near:{effective:'source'},far:{effective:'support'},pageErrors:[],consoleErrors:[],captures:['a','b','c','d'],lighting:{lightingPending:false,lighting:{route:'textured-clipped-source-shared-transport',bounces:1,environment:0,lightDirection:[0,1,0],radiance:Array.from({length:9},()=>[.1,.2,.3,1])}},lightingConformance:{maxAbsoluteError:0,rows:Array.from({length:9},()=>({expected:[.1,.2,.3],actual:[.1,.2,.3],errors:[0,0,0]}))},probe:{backend:'WebGPU',samples:Array.from({length:9},()=>({hit:true,material:{linearBaseColor:[.2,.3,.4],roughness:.5,metalness:.2,opacity:1}}))}});
test('missing visual evidence cannot pass a numerical-only inspection',()=>{const f=fixture();f.captures=[];assert.throws(()=>assertSupportInspection(f),/captures/);});
test('fallback, stale source, ignored controls, missing LOD branch and browser errors fail',()=>{
  for(const mutate of [f=>f.initial.backend='WebGL',f=>f.sourceBytes.sha256='stale',f=>f.changed.candidate.sourceTriangleIds=[1],f=>f.far.effective='source',f=>f.consoleErrors.push('GPU validation failed')]){const f=fixture();mutate(f);assert.throws(()=>assertSupportInspection(f));}
});
test('missing source material labels or a geometric miss cannot masquerade as the healthy source probe',()=>{
 for(const mutate of [f=>delete f.probe.samples[0].material,f=>f.probe.samples[0].hit=false,f=>f.probe.samples[0].material.roughness=NaN]){const f=fixture();mutate(f);assert.throws(()=>assertSupportInspection(f),/material|healthy/);}
});
test('witness retains a failure report when a local inspection dependency is missing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'support-witness-import-'));
 try{const script=path.join(dir,'witness.mjs'),out=path.join(dir,'output');await fs.copyFile(new URL('../tools/trellis-support-witness.mjs',import.meta.url),script);
  const run=spawnSync(process.execPath,[script,'http://127.0.0.1:1/',out,'unused-independent-browser'],{encoding:'utf8'});assert.equal(run.status,1);const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,'inspection-dependency');assert.equal(report.captures.length,0);assert.ok(report.error.includes('Cannot find module'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('blank, fallback, partial or non-finite lighting cannot pass the textured-source witness',()=>{
 for(const mutate of [f=>delete f.lighting,f=>f.lighting.lighting.route='constant-material',f=>f.lighting.lighting.radiance.pop(),f=>f.lighting.lighting.radiance[0][0]=NaN,f=>f.lighting.lighting.radiance=f.lighting.lighting.radiance.map(()=>[0,0,0,1]),f=>f.lightingConformance.maxAbsoluteError=.5]){const f=fixture();mutate(f);assert.throws(()=>assertSupportInspection(f),/lighting/);}
});
