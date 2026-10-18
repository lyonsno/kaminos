import {readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const args=new Map(process.argv.slice(2).reduce((a,v,i,s)=>i%2?a:[...a,[v,s[i+1]]],[]));
for(const key of ['--root','--inputs','--report','--out','--origin'])if(!args.get(key))throw Error('Required '+key);
const root=realpathSync(args.get('--root')),out=resolve(args.get('--out')),inputPath=resolve(args.get('--inputs')),reportPath=resolve(args.get('--report'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const input=JSON.parse(readFileSync(inputPath)),report=JSON.parse(readFileSync(reportPath));
if(report.status!=='completed'||report.phase!=='complete'||report.casts?.length!==input.casts.length||report.casts.some(c=>!input.casts.some(i=>i.slug===c.slug)))throw Error('Both completed bindings required; partial/failed outputs are not a setup');
for(const record of [input.motion,input.baseFrame,report.frame])if(sha(record.path)!==record.sha256)throw Error('Retained setup source digest changed');
for(const row of report.casts){const manifestPath=join(row.path,'manifest.json');if(sha(manifestPath)!==row.sha256)throw Error('Bound cast manifest changed');const m=JSON.parse(readFileSync(manifestPath));if(m.bones.length!==36||m.provenance.frameChainSha256!==report.frame.sha256)throw Error('Unexpected generating rig');for(const [name,asset]of Object.entries(m.assets))if(sha(join(row.path,name))!==asset.sha256)throw Error('Bound asset missing or changed');}
const preview=join(root,'scratch/rig-cast-1018');mkdirSync(preview,{recursive:true});mkdirSync(out,{recursive:true});
function mount(path,name){const link=join(preview,name);if(existsSync(link)){if(realpathSync(link)!==realpathSync(path))throw Error('Conflicting retained mount '+link);}else symlinkSync(path,link);}
mount(report.output??report.requested.out,'data');mount(input.motion.path,'motion.json');mount(input.baseFrame.path,'base-frame.json');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const setup={sourceCommit,sample:0,casts:report.casts.map(row=>({slug:row.slug,label:row.label,case:'scratch/rig-cast-1018/data/'+row.slug,case_sha256:row.sha256,
 motion:'scratch/rig-cast-1018/motion.json',motion_sha256:input.motion.sha256,base_frame:'scratch/rig-cast-1018/base-frame.json',base_frame_sha256:input.baseFrame.sha256,
 frame:'scratch/rig-cast-1018/data/frame.json',frame_sha256:report.frame.sha256}))};
writeFileSync(join(preview,'setup.json'),JSON.stringify(setup,null,2)+'\n');
const url=new URL('/index.html',args.get('--origin'));url.searchParams.set('experiment','mushfinger/rig-cast-comparison');url.searchParams.set('experiment_inputs',JSON.stringify({setup:'scratch/rig-cast-1018/setup.json',setup_sha256:sha(join(preview,'setup.json'))}));
writeFileSync(join(preview,'open.html'),'<!doctype html><meta charset="utf-8"><title>Rig-generated creatures</title><script>location.replace('+JSON.stringify(url.pathname+url.search)+')</script>');
writeFileSync(join(out,'offer.json'),JSON.stringify({repoRoot:root,sourceCommit,url:url.href,setup,inputPath,reportPath,
 setupSha256:sha(join(preview,'setup.json')),requestedMotion:'retained base28, no new inference',effectiveMotion:'same base matrices plus8 fixed local rest descendants',
 modules:['experiments/creature-motion/rig-cast-comparison.experiment.mjs','experiments/creature-motion/rig-cast-source.mjs','experiments/creature-motion/rest-descendant-motion.mjs','experiments/creature-motion/full-body-runtime.mjs','experiments/creature-motion/gpu-skin-deformer.mjs','lib/three.core.js'].map(path=>({path,sha256:sha(join(root,path))}))},null,2)+'\n');
console.log(JSON.stringify({url:url.href,sourceCommit,offer:join(out,'offer.json')}));
