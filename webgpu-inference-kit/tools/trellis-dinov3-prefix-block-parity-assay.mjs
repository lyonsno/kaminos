#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { assertCleanGitCheckout } from './trellis-dinov3-source-attestation.mjs';

const args=new Map();
for(let index=2;index<process.argv.length;index+=2) args.set(process.argv[index],process.argv[index+1]);
if(process.argv.includes('--help')) {
  console.log('Usage: node tools/trellis-dinov3-prefix-block-parity-assay.mjs --model-dir PATH --source-image PATH --trellis-root PATH --evidence-dir PATH --report PATH --receiver ADDRESS [--mode block0-parity|resident-handoff|resident-block1] [--python PATH] [--chrome PATH] [--source-revision SHA] [--debug-port N] [--server-port N]');
  process.exit(0);
}
const root=resolve(new URL('..',import.meta.url).pathname);
const modelDir=resolve(args.get('--model-dir')||'');
const sourceImage=resolve(args.get('--source-image')||'');
const trellisRoot=resolve(args.get('--trellis-root')||'');
const evidenceDir=resolve(args.get('--evidence-dir')||'');
const reportPath=resolve(args.get('--report')||'');
const python=args.get('--python')||resolve(trellisRoot,'.venv/bin/python');
const chrome=args.get('--chrome')||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort=args.get('--debug-port')||'9577';
const serverPort=args.get('--server-port')||'18577';
const mode=args.get('--mode')||'block0-parity';
const invocationId=`trellis-dinov3-${mode}-${new Date().toISOString().replaceAll(':','').replaceAll('-','')}`;
const referenceDir=resolve(evidenceDir,'mlx-reference');
const browserReportPath=resolve(evidenceDir,'browser-report.json');
const stdoutPath=resolve(evidenceDir,'assay.stdout.log');
const stderrPath=resolve(evidenceDir,'assay.stderr.log');
const startReceiptPath=resolve(evidenceDir,'start-receipt.json');
const expected={
  'model.safetensors':'dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179',
  'config.json':'135ecd23e34a70b6fbed8b083fdecb319b7e3a54e3d849258bbe4ddcf1783bb5',
  'preprocessor_config.json':'960c41d1f3a7778b936365769a2d90550b318a6c0a53a0296957adacfe5e0dd7',
};
let phase='local-preflight';
let lastTrustworthyEvidence={description:'command inputs not yet verified',detail:{phase}};
let stdout='';
let stderr='';
let effectiveCommands={};
let checkoutAtStart=null;

async function sha256File(path) {
  const digest=createHash('sha256');
  await new Promise((resolveDone,rejectDone)=>{
    const stream=createReadStream(path);
    stream.on('data',chunk=>digest.update(chunk));
    stream.once('error',rejectDone);
    stream.once('end',resolveDone);
  });
  return digest.digest('hex');
}
function gitRevision(path) {
  const result=spawnSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'});
  if(result.status!==0) throw new Error(`git revision unavailable for ${path}: ${result.stderr||result.error||'unknown error'}`);
  return result.stdout.trim();
}
function persistReport(extra={}) {
  if(!reportPath) return null;
  const report={
    schema:mode==='resident-block1'?'kaminos.trellis-dinov3-resident-block1-assay.v0':mode==='resident-handoff'?'kaminos.trellis-dinov3-resident-handoff-assay.v1':'kaminos.trellis-dinov3-prefix-block0-parity-assay.v0',ok:false,mode,invocationId,
    failure_phase:phase,reportPath,startReceiptPath,referenceDir,browserReportPath,stdoutPath,stderrPath,
    evidenceDir,modelDir,sourceImage,trellisRoot,python,chrome,
    lastTrustworthyEvidence,commandIdentity:effectiveCommands,
    stdoutTail:stdout.slice(-12000),stderrTail:stderr.slice(-12000),...extra,
  };
  mkdirSync(dirname(reportPath),{recursive:true});
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  return report;
}
function runChild(command,commandArgs,{cwd,env}={}) {
  return new Promise(resolveChild=>{
    const child=spawn(command,commandArgs,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>{const text=chunk.toString();stdout+=text;appendFileSync(stdoutPath,text);});
    child.stderr.on('data',chunk=>{const text=chunk.toString();stderr+=text;appendFileSync(stderrPath,text);});
    child.once('error',error=>resolveChild({code:null,signal:null,error:String(error?.stack||error),pid:child.pid||null}));
    child.once('close',(code,signal)=>resolveChild({code,signal,error:null,pid:child.pid||null}));
  });
}

let report=null;
try {
  if(!['--model-dir','--source-image','--trellis-root','--evidence-dir','--report','--receiver'].every(key=>args.has(key))) throw new Error('required arguments: --model-dir, --source-image, --trellis-root, --evidence-dir, --report, --receiver');
  if(!['block0-parity','resident-handoff','resident-block1'].includes(mode)) throw new Error(`unsupported mode ${mode}`);
  const kaminosRevision=gitRevision(root);
  if(args.has('--source-revision')&&args.get('--source-revision')!==kaminosRevision) throw new Error(`requested Kaminos source revision ${args.get('--source-revision')} differs from effective checkout ${kaminosRevision}`);
  checkoutAtStart=assertCleanGitCheckout(root,kaminosRevision);
  if(!existsSync(evidenceDir)) mkdirSync(evidenceDir,{recursive:true});
  if(readdirSync(evidenceDir).length!==0) throw new Error(`evidence directory must be empty to prevent stale reference/output reuse: ${evidenceDir}`);
  mkdirSync(referenceDir,{recursive:true});
  for(const path of [modelDir,sourceImage,trellisRoot,python,resolve(root,'tools/trellis-dinov3-mlx-reference.py'),resolve(root,'tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs')]) if(!existsSync(path)) throw new Error(`required route input is missing: ${path}`);
  if(!statSync(sourceImage).isFile()||!statSync(resolve(modelDir,'model.safetensors')).isFile()) throw new Error('source image or pinned checkpoint is not a regular file');
  const modelRevision=resolve(modelDir).split('/').at(-1);
  if(modelRevision!=='ea8dc2863c51be0a264bab82070e3e8836b02d51') throw new Error(`model snapshot directory is not the pinned revision: ${modelRevision}`);
  const observedFiles={};
  for(const [filename,expectedHash] of Object.entries(expected)) {
    const path=resolve(modelDir,filename);
    const actual=await sha256File(path);
    observedFiles[filename]={path,sha256:actual,expectedSha256:expectedHash,ok:actual===expectedHash};
    if(actual!==expectedHash) throw new Error(`pinned model file digest mismatch for ${filename}: ${actual} != ${expectedHash}`);
  }
  const sourceSha256=await sha256File(sourceImage);
  if(sourceSha256!=='abf395cc52d81c26dadae9f024072d6c7301679be4e8fc08d572723d7ae32a21') throw new Error(`pinned source image digest mismatch: ${sourceSha256}`);
  const trellisRevision=gitRevision(trellisRoot);
  const trellisDinoSource=resolve(trellisRoot,'trellmlx/models/dinov3.py');
  const trellisDinoSourceSha256=await sha256File(trellisDinoSource);
  if(trellisRevision!=='cddaf3cb8a9f28956114956ebe754d6661a3f695'||trellisDinoSourceSha256!=='5e56c76b947bbd59e9353c06470101ac28b6462649161cc8dd3740b2cf66403c') throw new Error(`native MLX reference source drifted: revision=${trellisRevision} source=${trellisDinoSourceSha256}`);
  const referenceBoundary=mode==='resident-block1'
    ? 'complete block0 plus block1 attention residual, norm2, GELU MLP, and LayerScale residual'
    : mode==='resident-handoff'
      ? 'block0 + layer1.layer_scale1 × layer1.attention(layer1.norm1(block0))'
      : 'complete block0 output';
  const sourceIdentity={mode,referenceBoundary,sourceImage:{path:sourceImage,sha256:sourceSha256},model:{id:'facebook/dinov3-vitl16-pretrain-lvd1689m',revision:modelRevision,files:observedFiles},mlxReference:{root:trellisRoot,revision:trellisRevision,sourceFile:trellisDinoSource,sourceFileSha256:trellisDinoSourceSha256},kaminos:{root,revision:kaminosRevision}};
  const pythonArgs=[resolve(root,'tools/trellis-dinov3-mlx-reference.py'),'--model-dir',modelDir,'--source-image',sourceImage,'--trellis-root',trellisRoot,'--out-dir',referenceDir];
  const browserArgs=[resolve(root,'tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs'),'--reference-dir',referenceDir,'--source-image',sourceImage,'--output-dir',evidenceDir,'--report',browserReportPath,'--mode',mode,'--source-revision',kaminosRevision,'--chrome',chrome,'--debug-port',debugPort,'--server-port',serverPort,'--atol','0.002','--rtol','0.001'];
  effectiveCommands={
    sourceIdentity,
    mlxReference:{executable:python,args:pythonArgs,cwd:trellisRoot,route:'local MLX Metal F32 reference export',gpuQueueScope:'part of this matched composite job'},
    browserParity:{executable:process.execPath,args:browserArgs,cwd:root,route:'headless Chrome WebGPU F32 against the just-exported MLX tensors'},
    queue:{timeout:null,serialization:'one serialized job executes MLX reference then WebGPU comparator; no other GPU job interleaves'},
  };
  const startReceipt={schema:mode==='resident-block1'?'kaminos.trellis-dinov3-resident-block1-assay-start.v0':mode==='resident-handoff'?'kaminos.trellis-dinov3-resident-handoff-assay-start.v1':'kaminos.trellis-dinov3-prefix-block0-parity-assay-start.v0',invocationId,receiver:args.get('--receiver'),startedAt:new Date().toISOString(),sourceIdentity,effectiveCommands,terminalEvidence:{reportPath,referenceManifest:resolve(referenceDir,'reference-manifest.json'),browserReportPath,gpuOutputs:resolve(evidenceDir,'gpu'),stdoutPath,stderrPath}};
  writeFileSync(startReceiptPath,JSON.stringify(startReceipt,null,2)+'\n');
  lastTrustworthyEvidence={description:'input manifest independently rehashed; exact image, checkpoint, MLX implementation, and source commits verified',detail:sourceIdentity};

  phase='mlx-reference-execution';
  const referenceRun=await runChild(python,pythonArgs,{cwd:trellisRoot,env:{PYTHONUNBUFFERED:'1'}});
  if(referenceRun.code!==0) {
    let failureManifest=null;
    try { failureManifest=JSON.parse(readFileSync(resolve(referenceDir,'reference-manifest.json'),'utf8')); } catch {}
    phase=failureManifest?.failure_phase||'mlx-reference-execution';
    lastTrustworthyEvidence={description:'exact source/checkpoint preflight passed; MLX tensor execution/export did not complete',detail:{sourceIdentity,failureManifest,child:referenceRun}};
    report=persistReport({sourceIdentity,referenceRun,failureManifest,ok:false,claim:'no matched WebGPU/MLX DINOv3 block-0 result; execution stopped in the native MLX reference phase'});
    console.error(JSON.stringify({ok:false,failure_phase:phase,reportPath,lastTrustworthyEvidence},null,2));
    process.exitCode=1;
  } else {
    const manifestPath=resolve(referenceDir,'reference-manifest.json');
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
    const expectedManifestIdentity=manifest.ok===true&&manifest.model?.revision===modelRevision&&manifest.model?.files?.['model.safetensors']?.sha256===expected['model.safetensors']&&manifest.preprocessing?.sourceFileSha256===sourceSha256&&manifest.reference?.sourceRevision===trellisRevision&&manifest.reference?.sourceFileSha256===trellisDinoSourceSha256&&manifest.computation?.precision==='float32'&&manifest.computation?.sequenceLength===1029&&(mode!=='resident-handoff'||manifest.computation?.residentProbe==='layer1.attention(block1_norm1_hidden_states); block0_hidden_states + attention_output * layer1.layer_scale1')&&(mode!=='resident-block1'||manifest.computation?.residentBlock1Probe==='layer1.norm2(block1_after_attention_hidden_states); layer1.mlp(block1_norm2_hidden_states); block1_after_attention_hidden_states + mlp_output * layer1.layer_scale2');
    if(!expectedManifestIdentity) throw new Error(`MLX exporter completed but its full reference identity did not match the requested source: ${manifestPath}`);
    lastTrustworthyEvidence={description:mode==='resident-block1'?'same-job native MLX F32 full block-1 stage tensors and all reference input hashes verified':mode==='resident-handoff'?'same-job native MLX F32 block-1 attention-residual reference and all reference input hashes verified':'same-job native MLX F32 patch/prefix/block-0 tensors and all reference input hashes verified',detail:{manifestPath,modelRevision,sourceSha256,trellisRevision,trellisDinoSourceSha256,outputs:Object.keys(manifest.outputs||{}).length}};
    phase='webgpu-parity-execution';
    const browserRun=await runChild(process.execPath,browserArgs,{cwd:root});
    let browserReport=null;
    try { browserReport=JSON.parse(readFileSync(browserReportPath,'utf8')); } catch {}
    const rawOutputCheck={};
    const expectedOutputs=mode==='resident-block1'?['block1Attention','block1Norm2','block1MlpHidden','block1MlpProjection','block1Output']:mode==='resident-handoff'?['block1Attention']:['patchEmbeddings','prefixHiddenStates','block0HiddenStates'];
    for(const name of expectedOutputs) {
      const record=browserReport?.persistedOutputReceipts?.[`${name}.f32`];
      const exists=record&&existsSync(record.path);
      const actualSha256=exists?await sha256File(record.path):null;
      rawOutputCheck[name]={path:record?.path||null,expectedSha256:record?.sha256||null,actualSha256,byteLength:exists?statSync(record.path).size:null,ok:Boolean(exists&&actualSha256===record.sha256&&statSync(record.path).size===record.byteLength)};
    }
    const checkoutAtEnd=assertCleanGitCheckout(root,kaminosRevision);
    const sourceAttestationOk=browserReport?.sourceAttestation?.ok===true;
    const parityOk=browserRun.code===0&&browserReport?.ok===true&&sourceAttestationOk&&Object.values(rawOutputCheck).every(entry=>entry.ok);
    phase=parityOk?'complete':'webgpu-parity-or-output-custody';
    lastTrustworthyEvidence={description:parityOk?'matched WebGPU F32 route and all raw same-observation outputs plus served source bytes were independently verified':'last trustworthy MLX reference remained valid; WebGPU or raw-output/source-attestation parity did not close',detail:{browserReportPath,browserStatus:browserReport?.ok||false,rawOutputCheck,comparisons:browserReport?.comparisons||{}}};
    report=persistReport({
      ok:parityOk,sourceIdentity,referenceRun,browserRun,referenceManifest:manifestPath,browserReportPath,
      browserReport,rawOutputCheck,sourceAttestation:{checkoutAtStart,checkoutAtEnd,servedSourceAttestation:browserReport?.sourceAttestation||null,ok:sourceAttestationOk},
      claim:parityOk?browserReport.browserState?.claim:`no completed matched F32 ${mode} result; inspect browser failure phase and last trustworthy evidence`,
      nextSlice:parityOk?(mode==='resident-block1'?'continue from the completed block-1 F32 output to block-2 norm1 using the same image, checkpoint, preprocessing, precision, and reference':mode==='resident-handoff'?'continue from the block-1 attention residual through block-1 norm2, GELU MLP, and residual with the same image, checkpoint, and precision':'connect the verified block-0 F32 output to the next native TRELLIS conditioning operation without changing image, checkpoint, precision, or route identity'):'repair the named failing route stage, preserving source/precision/reference identity',
    });
    console.log(JSON.stringify({ok:parityOk,reportPath,sourceIdentity,comparisons:browserReport?.comparisons||{},rawOutputCheck,claim:report.claim},null,2));
    if(!parityOk) process.exitCode=1;
  }
} catch(error) {
  lastTrustworthyEvidence={...lastTrustworthyEvidence,detail:{...lastTrustworthyEvidence.detail,error:String(error?.message||error)}};
  phase=phase==='local-preflight'?'local-preflight':`${phase}-failure`;
  report=persistReport({ok:false,error:String(error?.stack||error),claim:'no successful matched F32 DINOv3 block-0 parity observed'});
  console.error(JSON.stringify({ok:false,failure_phase:phase,reportPath,error:String(error?.message||error),lastTrustworthyEvidence},null,2));
  process.exitCode=1;
}
