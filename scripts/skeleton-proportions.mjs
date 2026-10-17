#!/usr/bin/env node
// Same file-in/file-out contract as the rest-skeleton editor. No model invocation.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {measureProportionAtlas} from '../experiments/creature-motion/skeleton-proportions.mjs';
export function run({input,out}){
 if(!input||!out)throw Error('Usage: node scripts/skeleton-proportions.mjs --input <saved-skeleton-or-editor-input.json> --out <report.json>');
 const report={schema:'kaminos.skeleton-proportion-file-report.v1',status:'failed',phase:'read',input:path.resolve(input),output:path.resolve(out),route:'deterministic-rest-origin-measurements'};
 try{
  const bytes=fs.readFileSync(input),value=JSON.parse(bytes);report.inputSha256=createHash('sha256').update(bytes).digest('hex');
  const plan=value.plan??value;report.phase='measure';report.measurement=measureProportionAtlas(plan,plan.rest_authoring?.proportionAtlas??value.proportion_atlas??null);report.status=report.measurement.status==='unsupported'?'unsupported':'measured';report.phase='complete';
 }catch(error){report.error=error.message;}
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname){const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];try{const report=run({input:args.includes('--input')?value('--input'):null,out:args.includes('--out')?value('--out'):null});console.log(JSON.stringify({status:report.status,phase:report.phase,out:report.output,error:report.error}));if(report.status==='failed')process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}}
