// Export an ordinary browser module; package identity and weight hosting remain caller-owned.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
export async function exportBrowserModule({out}={}) {
 if(typeof out!=='string'||!out.trim())throw Error('Explicit output directory required');
 const destination=path.resolve(out);await fs.mkdir(destination,{recursive:true});
 const report={schema:'kaminos.qwen-browser-export.v1',status:'failed',phase:'bundle',output:destination};
 const save=()=>fs.writeFile(path.join(destination,'qwen-export.json'),JSON.stringify(report,null,2)+'\n');await save();
 try{
  const result=await build({stdin:{contents:`export {Qwen35TextModel} from './text-model.js';export {QwenTokenizer} from '../flux2-klein/qwen-tokenizer.js';export {createQwenTextChat,expandPupText} from './pup-text.js';`,resolveDir:import.meta.dirname,sourcefile:'qwen-browser-entry.js'},outfile:path.join(destination,'qwen-text.js'),bundle:true,format:'esm',platform:'browser',target:'esnext',metafile:true,
   plugins:[{name:'installed-kit',setup(b){b.onResolve({filter:/webgpu-inference-kit\/src\/(autoregressive-generation|token-sampling|flash-attention-kernel)\.js$/},args=>({path:'@kaminos/webgpu-inference-kit/'+(args.path.endsWith('flash-attention-kernel.js')?'core':'generation'),external:true}));}}]});
  report.bundle=result.metafile;
  for(const output of Object.values(result.metafile.outputs))for(const dependency of output.imports)
   if(!['@kaminos/webgpu-inference-kit/core','@kaminos/webgpu-inference-kit/generation'].includes(dependency.path))throw Error('Unexpected external import: '+dependency.path);
  await fs.copyFile(new URL('../../webgpu-inference-kit/LICENSE',import.meta.url),path.join(destination,'LICENSE'));
  await fs.copyFile(new URL('../flux2-klein/THIRD_PARTY_NOTICES.txt',import.meta.url),path.join(destination,'KLEIN_THIRD_PARTY_NOTICES.txt'));
  const bytes=await fs.readFile(path.join(destination,'qwen-text.js'));report.sha256=createHash('sha256').update(bytes).digest('hex');report.bytes=bytes.length;report.status='exported';report.phase='complete';await save();return report;
 }catch(error){report.error=String(error.stack??error);await save();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const {values}=parseArgs({options:{out:{type:'string'}}});console.log(JSON.stringify(await exportBrowserModule(values)));}
