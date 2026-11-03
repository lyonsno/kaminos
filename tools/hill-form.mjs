import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {formTerrain,encodeFormation} from '../experiments/hill-terrain/formation.mjs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
if(!args.includes('--config')||!args.includes('--output'))throw Error('Usage: node tools/hill-form.mjs --config recipe.json --output terrain.hill');
const output=resolve(value('--output')),report={phase:'input',passed:false,root:process.cwd(),output,route:'cpu-offline-geological-preparation; upload-once-webgpu-runtime'};
await mkdir(dirname(output),{recursive:true});
try{
 report.revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.sourceSha256=createHash('sha256').update(await readFile(new URL('../experiments/hill-terrain/formation.mjs',import.meta.url))).digest('hex');
 const input=JSON.parse(await readFile(value('--config'),'utf8'));report.requested=input;report.phase='formation';const result=formTerrain(input),buffer=Buffer.from(encodeFormation(result));
 report.effective=result.config;report.metrics=result.metrics;report.bytes=buffer.length;report.sha256=createHash('sha256').update(buffer).digest('hex');report.phase='cache';await writeFile(output,buffer);report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}finally{await writeFile(output+'.report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
