import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {bindComponentTransport} from './structural-material-component-transport.mjs';
const [out,baseline,...inputs]=process.argv.slice(2),hash=b=>createHash('sha256').update(b).digest('hex');
const report={status:'running',baseline,inputs,runs:[],claim:'CPU surface support binding only; exact same retained native stone geometry and weights'};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));save();
let phase='inputs',lastTrustworthyEvidence='Invocation recorded; no observations evaluated';
try{
 assert.ok(inputs.length>0,'At least one retained observation required');
 phase='baseline';
 const prior=execFileSync('git',['show',`${baseline}:structural-material-component-transport.mjs`],{encoding:'utf8'});
 const legacy=await import(`data:text/javascript;base64,${Buffer.from(prior.replace("from 'three'",`from '${import.meta.resolve('three')}'`)).toString('base64')}`);
 report.revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceSha256=hash(fs.readFileSync('structural-material-component-transport.mjs'));report.baselineSha256=hash(prior);
 lastTrustworthyEvidence='Baseline and candidate source resolved';save();
 for(const input of inputs){
 phase='observation';
 const bytes=fs.readFileSync(input),w=JSON.parse(bytes).result.observed.witness,rest=w.interior.mesh.positions,components=Array(rest.length).fill(-1),volumes=rest.map((_,i)=>w.state.state[i*16+3]/1000);
 for(const piece of w.pieces)for(const id of piece.binding.frame.ids)components[id]=piece.component;
 const bind=fn=>w.pieces.map(p=>fn(rest,p.binding.entries.map(e=>e.point),{components,component:p.component,volumes,radius:p.binding.radius}));
 phase='binding-comparison';const entries=[];let reference;
 for(const kind of ['legacy','indexed','indexed','legacy']){
  const start=performance.now(),value=bind(kind==='legacy'?legacy.bindComponentTransport:bindComponentTransport),milliseconds=performance.now()-start;
  if(reference)assert.deepEqual(value,reference,'Exact surface support changed');else reference=value;
  entries.push({kind,milliseconds});
 }
 const mean=kind=>entries.filter(e=>e.kind===kind).reduce((s,e)=>s+e.milliseconds,0)/2,dense=mean('legacy'),indexed=mean('indexed');
 report.runs.push({input,sha256:hash(bytes),points:rest.length,vertices:w.pieces.reduce((s,p)=>s+p.binding.entries.length,0),entries,legacyMilliseconds:dense,indexedMilliseconds:indexed,speedup:dense/indexed,exactBindings:true});lastTrustworthyEvidence=`Complete exact binding comparison: ${input}`;save();
}report.status='passed';save();}catch(e){report.status='failed';report.failure={phase,lastTrustworthyEvidence,message:e.message,stack:e.stack};save();throw e;}
console.log(JSON.stringify(report));
