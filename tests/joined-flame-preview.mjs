// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {assertJoinedPreview} from '../tools/joined-preview-contract.mjs';
test('a converged joined solve cannot pass as a visible flame with a blank frame',()=>{
  const state={phase:'running',effective:{fine:[32,32,32]},coarse:[32,64,32],roof:false,backend:'WebGPU:apple',frame:{meanLuma:0,litPixels:0}};
  assert.throws(()=>assertJoinedPreview(state,{fine:[32,32,32],coarse:[32,64,32],roof:false}),/blank/);
});
test('preview admission rejects missing source controls, stale generations and fallback routes',()=>{
  const expected={fine:[32,32,32],coarse:[32,64,32],roof:false};
  const state={phase:'running',effective:{fine:[32,32,32],physicalColor:{effective:'emissive-transport-v2'},ghostGeneration:64},coarse:[32,64,32],roof:false,backend:'WebGPU:apple',frame:{meanLuma:1,litPixels:42},controls:{curl:0,emitterSourceLaw:'immersed-source'},steps:64,gpuErrors:[],pressure:{breakdown:false,maxDivergenceError:.0009}};
  assert.doesNotThrow(()=>assertJoinedPreview(state,expected));
  for(const mutate of [s=>delete s.controls.curl,s=>s.effective.ghostGeneration=63,s=>s.backend='fallback',s=>s.effective.physicalColor.effective='legacy',s=>s.frame=null,s=>s.pressure.maxDivergenceError=.002,s=>s.coarse=[16,32,16],s=>s.phase='failed']){
    const bad=structuredClone(state);mutate(bad);assert.throws(()=>assertJoinedPreview(bad,expected));
  }
});
test('interactive joined preview serves explicit roots and names diagnostic scheduling',async()=>{
  const out=mkdtempSync(join(tmpdir(),'joined-preview-test-'));
  const child=spawn(process.execPath,['tools/joined-material-consumer-capture.mjs',resolve('.'),resolve('.'),out,'','', 'preview'],{stdio:['ignore','pipe','pipe']});
  try{
    const address=await new Promise((accept,reject)=>{let text='';child.stdout.on('data',b=>{text+=b;for(const line of text.split('\n')){try{const r=JSON.parse(line);if(r.preview)accept(r.url);}catch{}}});child.on('error',reject);child.on('exit',()=>reject(Error('preview never listened: '+readFileSync(join(out,'report.json'),'utf8'))));});
    const page=await(await fetch(address)).text();
    assert.match(page,/joined-flame-preview-browser.mjs/);
    assert.match(page,/Diagnostic/);
    const source=await fetch(new URL('/fine/volume-core.js',address));assert.equal(source.status,200);
    const missing=await fetch(new URL('/unknown/path',address));assert.equal(missing.status,404);
    const report=JSON.parse(readFileSync(join(out,'report.json')));assert.equal(report.phase,'interactive-listener');assert.equal(report.status,'serving-unverified');
  }finally{child.kill();}
});
