// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleLightPlane} from '../tools/particle-light-reference.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('registered planes query the same physical point for differing cell counts, including boundaries and vacuum emission',()=>{
 for(const n of [2,4,8])for(const sigma of [0,.1,10]){
  const dims=[1,1,n],c=new Float64Array(4*n),p=new Float64Array(4*n),m=new Float64Array(4*n),solid=new Uint32Array(n),value=length=>sigma?2*-Math.expm1(-sigma*length)/sigma:2*length;
  for(let k=0;k<n;k++){c.set([2/n,0,0,sigma/n],4*k);p.set([value((k+.5)/n),0,0,Math.exp(-sigma*(k+.5)/n)],4*k);m.set([value(1-(k+.5)/n),0,0,Math.exp(-sigma*(1-(k+.5)/n))],4*k);}
  for(const depth of [0,.125,.5,.875,1])for(const reverse of [false,true]){const out=sampleLightPlane({coefficients:c,positive:p,negative:m,solids:solid,dims,origin:[0,0,0],extent:[1,1,1],depth,reverse});near(out[0],value(reverse?1-depth:depth));near(out[3],Math.exp(-sigma*(reverse?1-depth:depth)));}
  assert.throws(()=>sampleLightPlane({coefficients:c,positive:p,negative:m,solids:solid,dims,origin:[0,0,0],extent:[1,1,1],depth:-.1}));
 }
});
import {validateResolutionReports} from '../tools/particle-light-resolution.mjs';
test('resolution comparison refuses partial, fallback, source-changed and silently substituted grids',()=>{
 const make=n=>({status:'passed',source:{sha256:'same',slots:8192,step:32},effectiveRoute:'native-apple/particle-Gaussian-slab-deposit/opposite-interior-sweeps',plan:{dims:[n,n*1.5,n],origin:[-1,-1,-1],extent:[2,3,2],direction:[0,0,1],settings:{filterWidth:1}},arms:[{name:'open',recordsExact:true},{name:'wall',recordsExact:true}]});
 assert.equal(validateResolutionReports([make(16),make(32)],[16,32]),true);
 for(const records of [[make(16)], [{...make(16),status:'failed'},make(32)], [make(16),{...make(32),source:{sha256:'other',slots:8192,step:32}}], [make(16),{...make(32),effectiveRoute:'fallback'}], [make(16),make(16)], [make(16),{...make(32),arms:[{name:'open',recordsExact:true}]}]])assert.throws(()=>validateResolutionReports(records,[16,32]));
});
import {lightPlaneMetrics,runLightResolutionComparison} from '../tools/particle-light-resolution.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('registered XY footprint averaging preserves a structured field and exposes shifted lobes',()=>{
 const a=new Float64Array(2*3*4),b=new Float64Array(4*6*4);for(let y=0;y<3;y++)for(let x=0;x<2;x++){const v=1+x+3*y;a.set([v,v,v,1],4*(x+2*y));for(let j=0;j<2;j++)for(let i=0;i<2;i++)b.set([v,v,v,1],4*(2*x+i+4*(2*y+j)));}
 const exact=lightPlaneMetrics(a,b,2,3,2);near(exact.relativeL1,0);near(exact.linearCorrelation,1);near(exact.centroidDistance,0);
 const shifted=new Float64Array(b);for(let y=0;y<6;y++)for(let x=0;x<4;x++)for(let k=0;k<3;k++)shifted[4*(x+4*y)+k]=b[4*((x+2)%4+4*y)+k];assert.ok(lightPlaneMetrics(a,shifted,2,3,2).relativeL1>.1);
 assert.throws(()=>lightPlaneMetrics(new Float64Array(a.length),b,2,3,2));assert.throws(()=>lightPlaneMetrics(a,b.subarray(4),2,3,2));
});
test('comparison failure before native setup leaves a terminal identity-phase report',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'particle-light-resolution-'));
 try{await assert.rejects(runLightResolutionComparison({},dir),/Explicit source root/);const report=JSON.parse(await fs.readFile(path.join(dir,'report.json')));assert.equal(report.status,'failed');assert.equal(report.phase,'identity');assert.equal(report.lastTrustworthy,null);assert.deepEqual(report.levels,[]);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('comparison binds claimed source to the checkout executing its imports',async()=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'particle-light-source-')));
 try{
  execFileSync('git',['init','--quiet',dir]);execFileSync('git',['-C',dir,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--quiet','--allow-empty','-m','source fixture']);
  const head=execFileSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),out=path.join(dir,'.git','evidence');
  await assert.rejects(runLightResolutionComparison({repoRoot:dir,expectedLightingCommit:head,widths:[],depths:[]},out),/Executing module root differs/);
  const r=JSON.parse(await fs.readFile(path.join(out,'report.json')));assert.equal(r.status,'failed');assert.equal(r.phase,'identity');assert.equal(r.effectiveSource.executionRoot,path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('CLI manifest loading failures retain a terminal report before native setup',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'particle-light-manifest-'));
 try{
  const bad=path.join(dir,'bad.json');await fs.writeFile(bad,'{bad json');
  for(const file of [bad,path.join(dir,'missing.json')]){
   const out=path.join(dir,path.basename(file)+'-out');
   assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(new URL('../tools/particle-light-resolution.mjs',import.meta.url)),file,out],{stdio:'pipe'}));
   const r=JSON.parse(await fs.readFile(path.join(out,'report.json')));assert.equal(r.status,'failed');assert.equal(r.phase,'manifest-load');assert.equal(r.manifestPath,file);assert.equal(r.lastTrustworthy,null);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
