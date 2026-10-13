// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mountCreatureInvestigation} from '../experiments/creature-motion/investigation.mjs';
import {retainInvestigationCapture} from '../investigation-capture.mjs';
import {createInvestigationRecording} from '../investigation-recording.mjs';
import {createRgbPng} from './png-fixture.mjs';
const base=await fs.mkdtemp(path.join(os.tmpdir(),'creature-reopen-'));
const source={route:'synthetic-policy/current-shared-retention',rawMotionSha256:'a'.repeat(64),bodySha256:'b'.repeat(64)};
let opens=0;
const page={evaluate:async(fn,recipe)=>{opens++;return {frame:recipe.inputs.frame};}};
const mountInvestigation=async()=>({reportPath:path.join(base,'investigation.json'),finish:async()=>{}});
try {
 await fs.writeFile(path.join(base,'investigation.json'),JSON.stringify({status:'finished'}));
 await assert.rejects(mountCreatureInvestigation({page,out:base,source:{route:'unidentified'},mountInvestigation}),/source identity/);
 const handle=await mountCreatureInvestigation({page,out:base,source,mountInvestigation});
 for(const scenario of ['valid','wrong-view','wrong-asset','wrong-clip','wrong-domain-source','unverified-body','wrong-body','wrong-transform','removed','incomplete']){
  const view={position:[1,2,3],target:[0,0,0],up:[0,1,0],fov:45,zoom:1,near:.01,far:100};
  const transform={position:[3,2,1],quaternion:[0,0,0,1],scale:[1.5,.8,2]};
  const inputs={asset:'/body.glb',body_sha256:source.bodySha256,source_sha256:source.rawMotionSha256,clip:'trot',frame:30,transform:structuredClone(transform),view:structuredClone(view)};
  const domain={asset:{requested:'/body.glb',bodySha256:source.bodySha256},transform,source:{source_sha256:source.rawMotionSha256,frames:60,fps:30},frame:30,time:1,status:'paused',clipName:'trot',view};
  const context={domain,recipe:{id:'marionette/retained-creature',inputs},newOptionalField:true};
  if(scenario==='wrong-view')inputs.view.position=[9,9,9];
  if(scenario==='wrong-asset')inputs.asset='/other.glb';
  if(scenario==='wrong-clip')inputs.clip='other';
  if(scenario==='wrong-domain-source')domain.source.source_sha256='c'.repeat(64);
  if(scenario==='unverified-body')delete domain.asset.bodySha256;
  if(scenario==='wrong-body')inputs.body_sha256='c'.repeat(64);
  if(scenario==='wrong-transform')inputs.transform.position=[0,0,0];
  if(scenario==='removed')domain.status='removed';
  const recording=createInvestigationRecording({id:'policy-'+scenario,source,initial:context,startingConditions:{kind:'synthetic-policy'}});
  const read=()=>{const snapshot=recording.snapshot();if(scenario==='incomplete')snapshot.complete=false;return {recording:snapshot,context};};
  const out=path.join(base,scenario),reportPath=path.join(out,'report.json');
  try {
   await retainInvestigationCapture({out,source,recordingId:recording.id,read,capture:async()=>createRgbPng(2,1,[200,0,0,0,200,0])});
  }catch(error){if(scenario!=='incomplete')throw error;}
  finally{recording.finish();}
  const prior=opens;
  if(scenario==='valid'){const result=await handle.reopen(reportPath);assert.equal(result.state.frame,30);assert.equal(opens,prior+1);}
  else {await assert.rejects(handle.reopen(reportPath));assert.equal(opens,prior,'invalid recipe must fail before replacing the current body');}
 }
} finally {await fs.rm(base,{recursive:true,force:true});}
console.log('Captured frame/view/asset/clip/source and complete-prefix checks fail before reopen mutation; additive context stays compatible');
