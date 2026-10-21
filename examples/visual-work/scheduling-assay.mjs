import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {buildSceneDocument} from '../../scene-persistence-core.js';
import {legacyLocalLiquidEmitterRecord,defaultLocalLiquidSetup} from '../../local-liquid-setup.mjs';
import {checkWater,checkOverlap} from './scheduling-evidence.mjs';

const {values}=parseArgs({options:Object.fromEntries(['out','browser','playwright','python'].map(key=>[key,{type:'string'}]))});
for(const key of ['out','browser','playwright'])if(!values[key])throw Error(`--${key} required`);
const root=fileURLToPath(new URL('../../',import.meta.url)),out=path.resolve(values.out);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'prepare',root,source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  requested:values,stepsPerCase:180,casesPerArm:2,arms:[],memory:[],startedAt:new Date().toISOString(),
  limits:['Finite independent cases; interleaving models an admitted completed-case boundary, not fleet queue latency.',
    'Frame gaps measure the water page, not operator-perceived responsiveness.',
    'Saved scenes retain authoring inputs; water.json records solver observations, not a restartable particle checkpoint.',
    'Two reversed-order rounds are exploratory measurements of this pair, not admission policy.']};
const write=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const children=new Set();let server,serverDone,serverFailure,log,sampler;
const memory=()=>{try{report.memory.push({at:Date.now(),vm:execFileSync('/usr/bin/vm_stat',{encoding:'utf8'}),
  processes:execFileSync('/bin/ps',['-axo','pid=,ppid=,rss=,pcpu=,comm='],{encoding:'utf8'})});}catch(error){report.memory.push({at:Date.now(),error:String(error)});}};
await write();
try {
  const home=path.join(out,'home'),scenes=path.join(out,'scenes'),basins=path.join(out,'basins');
  for(const folder of [home,scenes,basins])await fs.mkdir(folder,{recursive:true});
  const emitter=legacyLocalLiquidEmitterRecord({x:0,y:.7,z:0,radius:.12,strength:1,rate:1200},'water-source');
  const source=buildSceneDocument({objects:[emitter],activeObjectId:emitter.id,
    localLiquid:{...defaultLocalLiquidSetup(),particleCount:12288,densityIterations:1,showSupportGeometry:true},
    camera:{position:[2,1.8,2.4],target:[0,0,0],fov:40},
    editorDisplay:{quality:'preview',water:'full'},
    postprocessing:{ao:{enabled:false},dof:{enabled:false}},
    environment:{name:'studio',exposure:1.2,intensity:.7,rotation:0,showBackground:false,ground:{visible:true,height:-.85}}});
  await fs.writeFile(path.join(scenes,'water-source.kaminos.json'),JSON.stringify(source,null,2));
  const previewSource=buildSceneDocument({objects:[{id:'box',type:'procedural-mesh',source:'kaminos:geometry',
    geometry:{kind:'box',parameters:{width:1,height:1,depth:1}},surface:{color:'#b84c62',roughness:.6,metalness:0},
    transform:{position:[0,.5,0],rotation:[0,.3,0],scale:[1,1,1]}}],activeObjectId:'box',
    camera:{position:[3,2,4],target:[0,.5,0],fov:40},editorDisplay:{quality:'preview'},
    environment:{name:'studio',exposure:1.2,intensity:.6,rotation:0,showBackground:false,ground:{visible:true,height:0}}});
  await fs.writeFile(path.join(scenes,'preview-source.kaminos.json'),JSON.stringify(previewSource,null,2));
  const inputs=path.join(out,'inputs.json');await fs.writeFile(inputs,JSON.stringify({steps:report.stepsPerCase}));
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const origin=`http://127.0.0.1:${port}`;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('KAMINOS_')));
  server=spawn(values.python||'python3',['-u','serve.py',String(port),'--volume-settings-store',basins,'--no-shared-basin-store',
    '--volume-basin-session-store',path.join(out,'sessions'),'--volume-cockpit-layout-store',path.join(out,'layouts')],
    {cwd:root,env:{...env,HOME:home,KAMINOS_SCENES_DIR:scenes,KAMINOS_BIND_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  serverDone=new Promise(resolve=>{server.once('exit',resolve);server.once('error',error=>{serverFailure=error;resolve();});});
  log=await fs.open(path.join(out,'server.log'),'a');
  server.stdout.on('data',data=>log.write(data));server.stderr.on('data',data=>log.write(data));
  report.server={pid:server.pid,origin};report.phase='server';await write();
  while(true){
    if(serverFailure)throw serverFailure;
    if(server.exitCode!==null)throw Error(`Server exited ${server.exitCode}`);
    try{if((await fetch(`${origin}/api/runtime-config`)).ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const run=(args,onMessage)=>{
    const timing={start:Date.now()};
    const child=spawn(process.execPath,args,{cwd:root,stdio:['ignore','inherit','inherit','ipc']});
    children.add(child);timing.pid=child.pid;
    child.on('message',message=>onMessage?.(message));
    const done=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('exit',(code,signal)=>{
        children.delete(child);timing.end=Date.now();timing.code=code;timing.signal=signal;
        if(code===0)resolve(timing);else reject(Error(`Child ${child.pid} exited ${code}/${signal}`));
      });
    });
    done.catch(()=>{});
    return {done,timing};
  };
  memory();sampler=setInterval(memory,1000);
  // Same work in every arm; reversing the second round exposes gross order/warm-cache effects.
  for(const [round,order] of [['forward',['serial','interleaved','overlap']],['reverse',['overlap','interleaved','serial']]]){
    for(const mode of order){
      const arm={round,mode,start:Date.now(),water:[]};report.arms.push(arm);report.phase=`${round}/${mode}`;await write();
      const armOut=path.join(out,round,mode);await fs.mkdir(armOut,{recursive:true});
      let preview;
      const startPreview=()=>{
        preview=run(['visual-work-run.mjs','--origin',origin,'--repo',root,'--scene','preview-source.kaminos.json',
          '--scenes',scenes,'--basins',basins,'--out',path.join(armOut,'preview'),
          '--example',path.join(root,'examples/visual-work/scheduling-preview.mjs'),
          '--browser',values.browser,'--playwright',values.playwright],message=>{
            if(message.type==='preview-mounted')preview.timing.activeStart=message.at;
            if(message.type==='preview-captured')preview.timing.activeEnd=message.at;
          });
        arm.preview=preview.timing;
      };
      const runWater=async index=>{
        const caseOut=path.join(armOut,`water-${index}`);
        const child=run(['visual-work-run.mjs','--origin',origin,'--repo',root,'--scene','water-source.kaminos.json',
          '--scenes',scenes,'--basins',basins,'--out',caseOut,'--example',path.join(root,'examples/visual-work/scheduling-water.mjs'),
          '--inputs',inputs,'--browser',values.browser,'--playwright',values.playwright,
          '--cost-reason','Approved scheduling assay: 12288 particles, one density iteration, 180 additional steps per case, 640x480 preview.'],message=>{
          if(index===0 && message.type==='water-start'){
            arm.previewRequestedAt=message.at;
            if(mode==='overlap')startPreview();
          }
        });
        const timing=await child.done;
        const evidence=checkWater(JSON.parse(await fs.readFile(path.join(caseOut,'water.json'),'utf8')));
        arm.water.push({...timing,...evidence,path:caseOut});
      };
      await runWater(0);
      if(!arm.previewRequestedAt)throw Error('Preview arrival was never observed');
      if(mode==='interleaved'){startPreview();await preview.done;}
      await runWater(1);arm.longCompletedAt=Date.now();
      if(mode==='serial')startPreview();
      await preview.done;
      const previewReport=JSON.parse(await fs.readFile(path.join(armOut,'preview','launch.json'),'utf8'));
      if(previewReport.status!=='passed'||!previewReport.browserClosed)throw Error('Preview incomplete');
      if(mode==='overlap')checkOverlap(arm);
      arm.end=Date.now();arm.previewLatencyMs=arm.preview.end-arm.previewRequestedAt;
      arm.longCompletionMs=arm.longCompletedAt-arm.start;
      arm.elapsedMs=arm.end-arm.start;
      await write();
    }
  }
  const persisted=JSON.parse(await fs.readFile(path.join(scenes,'water-source.kaminos.json'),'utf8'));
  if(JSON.stringify(persisted)!==JSON.stringify(source))throw Error('Authored water source changed');
  report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally{
  clearInterval(sampler);memory();
  for(const child of children){child.kill('SIGTERM');}
  await Promise.all([...children].map(child=>new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve);})));
  if(server?.pid && server.exitCode===null && server.signalCode===null){server.kill('SIGTERM');await serverDone;}
  if(log)await log.close();
  report.closed=true;report.finishedAt=new Date().toISOString();await write();
  console.log(JSON.stringify({out,status:report.status,arms:report.arms.map(a=>({round:a.round,mode:a.mode,previewLatencyMs:a.previewLatencyMs,longCompletionMs:a.longCompletionMs,elapsedMs:a.elapsedMs})),failure:report.failure}));
}
