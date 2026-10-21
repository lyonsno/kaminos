import fs from 'node:fs/promises';
import path from 'node:path';
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
await write();
try {
  const scenes=path.join(out,'scenes');
  await fs.mkdir(scenes,{recursive:true});
  const source=buildSceneDocument({objects:[{id:'box',type:'procedural-mesh',source:'kaminos:geometry',
    geometry:{kind:'box',parameters:{width:1,height:1,depth:1}},surface:{color:'#b84c62',roughness:.6,metalness:0},
    transform:{position:[0,.5,0],rotation:[0,.3,0],scale:[1,1,1]}}],activeObjectId:'box',
    camera:{position:[3,2,4],target:[0,.5,0],fov:40},editorDisplay:{quality:'full'},
    environment:{name:'studio',exposure:1.2,intensity:.6,rotation:0,showBackground:false,ground:{visible:true,height:0}}});
  await fs.writeFile(path.join(scenes,'source.kaminos.json'),JSON.stringify(source));
  report.phase='comparison';await write();
  const args=['visual-work-run.mjs','--repo',root,'--scene','source.kaminos.json','--scenes',scenes,
    '--out',path.join(out,'comparison'),'--example',path.join(root,'examples/visual-work/pose-comparison.mjs'),'--browser',values.browser,'--playwright',values.playwright];
  if(values.python)args.push('--python',values.python);
  const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const launch=JSON.parse(await fs.readFile(path.join(out,'comparison','launch.json'),'utf8'));
  report.server=launch.server;report.serverClosed=launch.server?.closed===true;
  if(code!==0){report.phase=launch.phase;throw Error(launch.failure||`comparison exited ${code}`);}
  const persisted=JSON.parse(await fs.readFile(path.join(scenes,'source.kaminos.json'),'utf8'));
  if(JSON.stringify(source)!==JSON.stringify(persisted))throw Error('authored source changed');
  report.status='passed';report.phase='complete';
} catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{
  await write();
}
