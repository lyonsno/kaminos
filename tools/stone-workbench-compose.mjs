import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {composeStoneWorkbenchSource} from './stone-workbench-source.mjs';
const [hostRoot,out]=process.argv.slice(2);if(!hostRoot||!out)throw Error('Explicit host checkout and output directory required');
fs.mkdirSync(out,{recursive:true});const report={phase:'compose',status:'running',hostRoot,stoneRoot:process.cwd()};const save=()=>fs.writeFileSync(path.join(out,'composition.json'),JSON.stringify(report,null,2));save();
try{
 const source=fs.readFileSync(path.join(hostRoot,'index.html'),'utf8'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 report.hostRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:hostRoot,encoding:'utf8'}).trim();report.stoneRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.sourceHash=hash(source);const derived=composeStoneWorkbenchSource(source);report.derivedHash=hash(derived);report.index=path.join(out,'index.html');
 fs.writeFileSync(report.index,derived);report.status='composed';report.claim='derived-source-not-host-adoption';save();console.log(JSON.stringify(report));
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};save();throw error;}
