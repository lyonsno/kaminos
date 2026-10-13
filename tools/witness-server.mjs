import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createWriteStream} from 'node:fs';
import path from 'node:path';

export async function startWitnessServer({repoRoot,output,python='python3',requestedUrl}) {
  const reservation=createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const target=new URL(requestedUrl||'/index.html?workspace=workbench&experiment=live-log-heat&volume_resolution=48','http://127.0.0.1');
  target.hostname='127.0.0.1';target.port=String(port);target.protocol='http:';
  const stdout=createWriteStream(path.join(output,'server.stdout.log')),stderr=createWriteStream(path.join(output,'server.stderr.log'));
  const child=spawn(python,['-u','serve.py',String(port)],{cwd:repoRoot,env:{...process.env,KAMINOS_VOLUME_COCKPIT_LAYOUT_STORE:path.join(output,'layout-store')},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);
  let ended=false,launchError=null;const closed=new Promise(resolve=>{child.once('error',error=>{launchError=error;ended=true;resolve();});child.once('close',()=>{ended=true;resolve();});});
  const evidence={repoRoot,python,pid:child.pid,port,url:target.href,ownership:'exact-child-for-this-capture'};
  async function stop(){if(!ended){child.kill('SIGTERM');await closed;}await Promise.all([new Promise(resolve=>stdout.end(resolve)),new Promise(resolve=>stderr.end(resolve))]);}
  try {
    while(!ended){
      try{const response=await fetch(target);if(response.ok){if(ended)break;return {url:target.href,evidence,stop};}}catch{}
      await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,50))]);
    }
    throw Error('Witness server exited before HTTP availability: '+(launchError?.message||`exit ${child.exitCode}`));
  }catch(error){await stop();throw error;}
}
