import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {buildSceneDocument} from '../../scene-persistence-core.js';

const {values} = parseArgs({options:Object.fromEntries(['out','browser','playwright','python'].map(name=>[name,{type:'string'}]))});
for (const key of ['out','browser','playwright']) if (!values[key]) throw Error(`--${key} required`);
const root=fileURLToPath(new URL('../../',import.meta.url)),out=path.resolve(values.out);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'prepare',root,requested:values};
const write=()=>fs.writeFile(path.join(out,'witness.json'),JSON.stringify(report,null,2));
let server;
let exited;
await write();
try {
  const home=path.join(out,'home'),scenes=path.join(out,'scenes'),basins=path.join(out,'basins');
  for(const directory of [home,scenes,basins]) await fs.mkdir(directory,{recursive:true});
  const source=buildSceneDocument({objects:[{id:'box',type:'procedural-mesh',source:'kaminos:geometry',
    geometry:{kind:'box',parameters:{width:1,height:1,depth:1}},surface:{color:'#b84c62',roughness:.6,metalness:0},
    transform:{position:[0,.5,0],rotation:[0,.3,0],scale:[1,1,1]}}],activeObjectId:'box',
    camera:{position:[3,2,4],target:[0,.5,0],fov:40},editorDisplay:{quality:'full'},
    environment:{name:'studio',exposure:1.2,intensity:.6,rotation:0,showBackground:false,ground:{visible:true,height:0}}});
  await fs.writeFile(path.join(scenes,'source.kaminos.json'),JSON.stringify(source));
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const origin=`http://127.0.0.1:${port}`;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('KAMINOS_')));
  server=spawn(values.python||'python3',['-u','serve.py',String(port),'--volume-settings-store',basins,'--no-shared-basin-store',
    '--volume-basin-session-store',path.join(out,'sessions'),'--volume-cockpit-layout-store',path.join(out,'layouts')],
    {cwd:root,env:{...env,HOME:home,KAMINOS_SCENES_DIR:scenes,KAMINOS_BIND_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  exited=new Promise(resolve=>server.once('exit',resolve));
  const log=await fs.open(path.join(out,'server.log'),'a');
  server.stdout.on('data',data=>log.write(data));server.stderr.on('data',data=>log.write(data));
  report.server={pid:server.pid,origin};report.phase='server';await write();
  let serving=false;
  while(!serving){
    if(server.exitCode!==null)throw Error(`server exited ${server.exitCode}`);
    try{serving=(await fetch(`${origin}/api/runtime-config`)).ok;}catch{}
    if(!serving)await new Promise(resolve=>setTimeout(resolve,100));
  }
  report.phase='comparison';await write();
  const args=['visual-work-run.mjs','--origin',origin,'--repo',root,'--scene','source.kaminos.json','--scenes',scenes,'--basins',basins,
    '--out',path.join(out,'comparison'),'--example',path.join(root,'examples/visual-work/pose-comparison.mjs'),'--browser',values.browser,'--playwright',values.playwright];
  const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw Error(`comparison exited ${code}`);
  const persisted=JSON.parse(await fs.readFile(path.join(scenes,'source.kaminos.json'),'utf8'));
  if(JSON.stringify(source)!==JSON.stringify(persisted))throw Error('authored source changed');
  report.status='passed';report.phase='complete';
} catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{if(server?.exitCode===null){server.kill('SIGTERM');await exited;}report.serverClosed=true;await write();}
