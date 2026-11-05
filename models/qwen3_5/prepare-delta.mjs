#!/usr/bin/env node
// Index existing base/adapter safetensors for the native browser; retain bytes.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,link,stat,realpath,rename} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readSafetensorsHeader} from '../../webgpu-inference-kit/tools/sam-model.mjs';
import {qwen35ModelLayout} from './model-layout.js';
import {deltaLayout} from './delta-adapter.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function digest(file,start,end){const h=createHash('sha256');for await(const b of createReadStream(file,start===undefined?{}:{start,end}))h.update(b);return h.digest('hex');}
async function json(file,value){const tmp=file+'.partial';await writeFile(tmp,JSON.stringify(value,null,2)+'\n');await rename(tmp,file);}
const localName=n=>n.replace(/^model\.language_model\./,'model.').replace(/\.weight$/,'');
export async function prepareDelta({modelDir,adapterDir,outDir,onProgress=()=>{}}){
 const out=resolve(outDir);await mkdir(out,{recursive:true});const report={status:'running',phase:'identity',modelDir:resolve(modelDir),adapterDir:resolve(adapterDir),outDir:out,files:[]};await json(join(out,'prepare-report.json'),report);
 try{
  const configBytes=await readFile(join(modelDir,'config.json')),config=JSON.parse(configBytes),provenance=JSON.parse(await readFile(join(modelDir,'conversion_provenance.json'))),extracted=JSON.parse(await readFile(join(adapterDir,'manifest.json')));
  if(provenance.base_role!=='qwen'||provenance.source_repo!==extracted.sources?.qwen_repo||provenance.source_revision!==extracted.sources?.qwen_revision||sha(configBytes)!==provenance.converted_config_sha256)throw Error('base Qwen provenance mismatch');
  if(extracted.schema!=='kaminos.bfl-pup-delta-manifest.v1'||extracted.complete!==true||extracted.params?.include_vocab!==true)throw Error('complete vocabulary-inclusive delta required');
  const tensors={},files={},manifest={schema:'kaminos.qwen35-text-weights.v1',config,source:{baseRole:'qwen',sourceRevision:provenance.source_revision,configSha256:sha(configBytes),localRoot:await realpath(out),originalLocalRoot:await realpath(modelDir),files},tensors};
  async function expose(file,name){const target=join(out,name);try{await link(file,target);}catch(e){if(e.code!=='EEXIST')throw e;const [a,b]=await Promise.all([stat(file),stat(target)]);if(a.ino!==b.ino||a.dev!==b.dev)throw Error('output file already belongs to another source: '+name);}return target;}
  async function row(file,h,name,record){const offset=h.dataStart+record.data_offsets[0],bytes=record.data_offsets[1]-record.data_offsets[0],width={BF16:2,U32:4,F32:4}[record.dtype],elements=record.shape.reduce((a,b)=>a*b,1);if(!width||elements*width!==bytes||offset+bytes>h.size)throw Error('invalid tensor '+name);return{file:basename(file),offset,bytes,shape:record.shape,dtype:record.dtype,sha256:await digest(file,offset,offset+bytes-1)};}
  report.phase='base-index';await json(join(out,'prepare-report.json'),report);
  for(const [file,expected]of Object.entries(provenance.converted_header_digests)){
   const path=join(modelDir,file),h=await readSafetensorsHeader(path);if(await digest(path,8,h.dataStart-1)!==expected)throw Error('base header mismatch '+file);const exposed=await expose(path,file);files[file]={bytes:h.size,headerSha256:expected};
   for(const [key,v]of Object.entries(h.tensors)){if(!key.startsWith('language_model.'))continue;const name=key.slice(15);tensors[name]=await row(exposed,h,name,v);onProgress({phase:'base',name});}
  }
  const layout=qwen35ModelLayout(manifest),native={schema:'kaminos.qwen35-delta.v1',complete:true,maxRank:extracted.max_rank,qwenRevision:provenance.source_revision,baseConfigSha256:sha(configBytes),bflRevision:extracted.sources.bfl_revision,extractionSignature:extracted.extraction_signature_sha256,projections:{},exact:{},sourceShards:{}};
  report.phase='adapter-index';await json(join(out,'prepare-report.json'),report);
  for(const [group,spec]of Object.entries(extracted.shards)){
   if(!extracted.expected_shard_groups.includes(group)||!/^shards\/[\w.-]+$/.test(spec.file))throw Error('invalid adapter shard');const path=join(adapterDir,spec.file);if((await stat(path)).size!==spec.size_bytes||await digest(path)!==spec.sha256)throw Error('adapter shard hash mismatch '+group);
   const name='delta-'+basename(path),exposed=await expose(path,name),h=await readSafetensorsHeader(path);native.sourceShards[name]={sha256:spec.sha256,bytes:spec.size_bytes};
   for(const key of spec.expected_keys){
    const mode=spec.tensor_stats[key]?.mode,target=localName(key);
    if(mode==='lowrank_svd'){
     const a=h.tensors[key+'.lora_A'],b=h.tensors[key+'.lora_B'];if(!a||!b)throw Error('missing factors '+key);
     native.projections[target]={a:await row(exposed,h,key,a),b:await row(exposed,h,key,b)};
    }else if(mode==='exact'){
     const b=h.tensors[key+'.bfl'];if(!b)throw Error('missing exact target '+key);native.exact[target+'.weight']=await row(exposed,h,key,b);
     // A_log/dt_bias are parameters without a weight suffix.
     if(!key.endsWith('.weight')){native.exact[target]=native.exact[target+'.weight'];delete native.exact[target+'.weight'];}
    }else throw Error('unknown adapter target mode '+key);
    onProgress({phase:'adapter',name:key});
   }
  }
  deltaLayout(native,{manifest,layout});
  for(const file of ['config.json','tokenizer.json','tokenizer_config.json','system_prompts.json'])await expose(join(modelDir,file),file);
  await json(join(out,'delta.json'),native);manifest.delta={file:'delta.json',sha256:sha(await readFile(join(out,'delta.json')))};await json(join(out,'weights.json'),manifest);report.status='complete';report.phase='complete';report.baseManifestSha256=sha(await readFile(join(out,'weights.json')));report.deltaManifestSha256=sha(await readFile(join(out,'delta.json')));report.targets={projections:Object.keys(native.projections).length,exact:Object.keys(native.exact).length};
 }catch(e){report.status='failed';report.error=String(e.stack??e);throw e;}finally{await json(join(out,'prepare-report.json'),report);}return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const{values}=parseArgs({options:{'model-dir':{type:'string'},'adapter-dir':{type:'string'},out:{type:'string'}}});prepareDelta({modelDir:values['model-dir'],adapterDir:values['adapter-dir'],outDir:values.out}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});}
