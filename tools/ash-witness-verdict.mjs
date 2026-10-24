import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function acceptsAshWitness(report,kind,exitCode){
 if(exitCode!==(kind==='positive'?0:1)||report.status!==(kind==='positive'?'passed':'failed')||report.browserClosed!==true)return false;
 if(kind==='positive')return report.phase==='complete'&&report.errors?.length===0&&report.consoleErrors?.length===0;
 if(kind==='pageerror')return report.phase==='pageerror-negative'&&report.injectedPageError==='injected GPU ash witness failure'&&report.errors?.some(e=>e===`Error: ${report.injectedPageError}`)===true;
 if(kind==='unmounted')return report.phase==='mount'&&String(report.error).includes('No experiment open');
 if(kind==='frozen-live')return report.phase==='live'&&String(report.error).includes('live host frames must actually advance ash')&&report.liveFrames?.length>0&&report.liveFrames.every(f=>f.steps===report.liveFrames[0].steps);
 return false;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [, ,file,kind,exitCode]=process.argv;
 process.exitCode=acceptsAshWitness(JSON.parse(readFileSync(file,'utf8')),kind,Number(exitCode))?0:1;
}
