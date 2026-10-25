import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [sourceRoot,preparation,out]=process.argv.slice(2);
if(!sourceRoot||!preparation||!out)throw Error('usage: SOURCE_ACCEPTED_WORKTREE PREPARATION_REPORT OUTPUT_INSIDE_SCRATCH');
const hash=b=>createHash('sha256').update(b).digest('hex'),root=process.cwd(),target=path.resolve(out);
if(!target.startsWith(path.join(root,'scratch')+path.sep)||fs.existsSync(target))throw Error('Select a new output directory inside this worktree scratch');
const setup=JSON.parse(fs.readFileSync(path.join(sourceRoot,'scratch/stride-stance-1017/setup.json'))),creature=setup.actors.find(a=>a.id==='trellis').creature;
const report=JSON.parse(fs.readFileSync(preparation));if(report.status!=='passed'||report.caseSha256!==creature.case_sha256)throw Error('Matching successful source preparation required');
const preparedBytes=fs.readFileSync(report.prepared.path);if(hash(preparedBytes)!==report.prepared.sha256)throw Error('Physical preparation bytes differ');
fs.mkdirSync(target,{recursive:true});
fs.cpSync(path.join(sourceRoot,creature.case),path.join(target,'skin'),{recursive:true});
const copy=(key,name)=>{const bytes=fs.readFileSync(path.join(sourceRoot,creature[key]));if(hash(bytes)!==creature[key+'_sha256'])throw Error('Source hash mismatch: '+key);fs.writeFileSync(path.join(target,name),bytes);};
copy('frame','rig-frame.json');copy('motion','motion.json');fs.writeFileSync(path.join(target,'prepared.json'),preparedBytes);
const url='/'+path.relative(root,target).split(path.sep).join('/'),inputs={case:url+'/skin',case_sha256:creature.case_sha256,frame:url+'/rig-frame.json',frame_sha256:creature.frame_sha256,motion:url+'/motion.json',motion_sha256:creature.motion_sha256,prepared:url+'/prepared.json',prepared_sha256:report.prepared.sha256};
if(creature.prefix){copy('prefix','prefix.json');inputs.prefix=url+'/prefix.json';inputs.prefix_sha256=creature.prefix_sha256;}
fs.writeFileSync(path.join(target,'inputs.json'),JSON.stringify(inputs,null,2));
fs.writeFileSync(path.join(target,'open.html'),`<!doctype html><meta charset="utf-8"><title>Creature contact</title><script type="module">const r=await fetch('./inputs.json',{cache:'no-store'});if(!r.ok)throw Error('Missing contact inputs');const inputs=await r.json();location.replace('/index.html?workspace=workbench&experiment=creature-flesh/contact&experiment_inputs='+encodeURIComponent(JSON.stringify(inputs)));</script>`);
console.log(JSON.stringify({path:target,url:url+'/open.html',source:inputs,preparedSha256:report.prepared.sha256}));
