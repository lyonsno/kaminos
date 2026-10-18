import {readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const args=new Map(process.argv.slice(2).reduce((a,v,i,s)=>i%2?a:[...a,[v,s[i+1]]],[]));
for(const key of ['root','plan','motion-inputs','correction-report','mount','out','origin'])if(!args.get('--'+key))throw Error('Required --'+key);
const root=realpathSync(args.get('--root')),out=resolve(args.get('--out')),mount=resolve(root,args.get('--mount'));
if(!relative(root,mount).startsWith('scratch/')||relative(root,mount).includes('..'))throw Error('Caller-owned scratch mount required');
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const plan=JSON.parse(readFileSync(args.get('--plan'))),motion=JSON.parse(readFileSync(args.get('--motion-inputs'))),report=JSON.parse(readFileSync(args.get('--correction-report')));
if(report.status!=='completed'||report.phase!=='complete'||report.casts?.length!==2||report.casts.some(c=>!plan.casts.some(p=>p.slug===c.slug)))throw Error('Both completed correction packages required');
const check=record=>{if(sha(record.path)!==record.sha256)throw Error('Source digest changed: '+record.path);};
for(const r of [plan.frame,motion.motion,motion.baseFrame,...plan.casts.map(c=>c.case),...report.casts.flatMap(c=>[c.case,c.correction])])check(r);
for(const c of [...plan.casts,...report.casts]){const m=JSON.parse(readFileSync(c.case.path));if(m.bones.length!==36||m.provenance.frameChainSha256!==plan.frame.sha256)throw Error('Unexpected bind frame');for(const [name,a]of Object.entries(m.assets))if(sha(join(resolve(c.case.path,'..'),name))!==a.sha256)throw Error('Package asset changed');}
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
mkdirSync(mount,{recursive:true});mkdirSync(out,{recursive:true});
function link(path,name){const target=join(mount,name);if(existsSync(target)){if(realpathSync(target)!==realpathSync(path))throw Error('Conflicting mount '+target);}else symlinkSync(path,target);}
link(plan.frame.path,'frame.json');link(motion.motion.path,'motion.json');link(motion.baseFrame.path,'base-frame.json');
const prefix=relative(root,mount);
const modules=['experiments/creature-motion/rig-cast-comparison.experiment.mjs','experiments/creature-motion/pose-normalization-setup.mjs',
 'experiments/creature-motion/rig-cast-source.mjs','experiments/creature-motion/rest-descendant-motion.mjs',
 'experiments/creature-motion/full-body-runtime.mjs','experiments/creature-motion/gpu-skin-deformer.mjs','lib/three.core.js'].map(path=>({path,sha256:sha(join(root,path))}));
const offers=[];
for(const cast of plan.casts){
 const derived=report.casts.find(c=>c.slug===cast.slug);
 link(resolve(cast.case.path,'..'),cast.slug+'-original');link(resolve(derived.case.path,'..'),cast.slug+'-corrected');
 const make=(variant,record)=>({slug:variant,label:cast.slug+' · '+(variant==='original'?'unchanged original':'pose + rig proportions'),
  case:prefix+'/'+cast.slug+'-'+variant,case_sha256:record.sha256,
  motion:prefix+'/motion.json',motion_sha256:motion.motion.sha256,base_frame:prefix+'/base-frame.json',base_frame_sha256:motion.baseFrame.sha256,
  frame:prefix+'/frame.json',frame_sha256:plan.frame.sha256});
 const setup={sourceCommit:commit,castLabel:cast.slug,correction:'pose-and-rig-proportions',sample:0,
  casts:[make('original',cast.case),make('corrected',derived.case)]};
 const setupPath=join(mount,cast.slug+'-setup.json');writeFileSync(setupPath,JSON.stringify(setup,null,2)+'\n');
 const url=new URL('/index.html',args.get('--origin'));url.searchParams.set('experiment','mushfinger/rig-cast-comparison');
 url.searchParams.set('experiment_inputs',JSON.stringify({setup:prefix+'/'+cast.slug+'-setup.json',setup_sha256:sha(setupPath)}));
 writeFileSync(join(mount,cast.slug+'.html'),'<!doctype html><meta charset="utf-8"><title>Rest correction comparison</title><script>location.replace('+JSON.stringify(url.pathname+url.search)+')</script>');
 const offer={repoRoot:root,sourceCommit:commit,url:url.href,setup,setupSha256:sha(setupPath),modules,
  computationalReport:args.get('--correction-report'),scope:'original versus derived pose AND rig-proportion correction under identical retained clip; not pose-only'};
 writeFileSync(join(out,cast.slug+'-offer.json'),JSON.stringify(offer,null,2)+'\n');offers.push({cast:cast.slug,url:new URL('/'+prefix+'/'+cast.slug+'.html',args.get('--origin')).href});
}
console.log(JSON.stringify(offers,null,2));
