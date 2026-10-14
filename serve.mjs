#!/usr/bin/env node
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {mkdir, writeFile} from 'node:fs/promises';
import {createKaminosAppHost, appSourceIdentity} from './node-app-host.mjs';

export function parseAppHostArgs(args) {
  const options={host:'127.0.0.1',port:8100,stateRoot:resolve(homedir(),'.local/state/kaminos/node-app'),
    sam3PacketRoot:process.env.KAMINOS_SAM3_PACKET_ROOT||null,
    kleinWeightsRoot:process.env.KAMINOS_KLEIN_WEIGHTS_ROOT||null,
    trellisCheckpointRoot:process.env.KAMINOS_TRELLIS_CHECKPOINT_ROOT||null,roots:{}};
  const names={'--repo-root':'repoRoot','--state-root':'stateRoot','--sam3-packet-root':'sam3PacketRoot',
    '--klein-weights-root':'kleinWeightsRoot','--trellis-checkpoint-root':'trellisCheckpointRoot',
    '--host':'host','--port':'port','--startup-report':'startupReport'};
  for(let i=0;i<args.length;i++) {
    const flag=args[i];if(flag==='--help'){options.help=true;continue;}
    if(!names[flag]&&flag!=='--root')throw Error(`Unknown option: ${flag}`);
    const value=args[++i];if(!value||value.startsWith('--'))throw Error(`Value required for ${flag}`);
    if(flag==='--root') {
      const split=value.indexOf('=');if(split<1||split===value.length-1)throw Error('--root requires id=path');
      const id=value.slice(0,split);if(!/^[a-z0-9-]+$/.test(id))throw Error('Invalid browse root id');
      options.roots[id]=resolve(value.slice(split+1));
    }else options[names[flag]]=value;
  }
  if(options.help)return options;
  if(!options.repoRoot)throw Error('--repo-root is required; use the owning checkout');
  options.repoRoot=resolve(options.repoRoot);options.stateRoot=resolve(options.stateRoot);
  for(const key of ['sam3PacketRoot','kleinWeightsRoot','trellisCheckpointRoot'])if(options[key])options[key]=resolve(options[key]);
  options.port=Number(options.port);
  if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw Error('--port must be an integer from 0 to 65535');
  return options;
}

export async function runAppHost(args=process.argv.slice(2)) {
  let host,report,phase='configuration';
  const requestedReport=args.indexOf('--startup-report');
  const reportPath=requestedReport>=0?args[requestedReport+1]:null;
  const publish=async value=>{
    if(reportPath){await mkdir(dirname(resolve(reportPath)),{recursive:true});await writeFile(resolve(reportPath),JSON.stringify(value,null,2)+'\n');}
    process.stdout.write(JSON.stringify(value)+'\n');
  };
  try {
    const options=parseAppHostArgs(args);
    if(options.help){process.stdout.write('Usage: node serve.mjs --repo-root <checkout> [--state-root <directory>] [--sam3-packet-root <directory>] [--klein-weights-root <directory>] [--trellis-checkpoint-root <directory>] [--root id=directory] [--host 127.0.0.1] [--port 8100] [--startup-report <file>]\n');return null;}
    host=await createKaminosAppHost(options);phase='listen';
    await host.listen(options.port,options.host);
    report={schema:'kaminos.node-app-host.v0',status:'listening',pid:process.pid,
      url:`http://${options.host.includes(':')?'['+options.host+']':options.host}:${host.server.address().port}`,configuration:host.config,
      source:appSourceIdentity(host.config.repoRoot),implementation:appSourceIdentity(dirname(fileURLToPath(import.meta.url)))};
    await publish(report);
    const stop=async()=>{await host.close();await publish({...report,status:'stopped',stoppedAt:new Date().toISOString()});};
    process.once('SIGTERM',()=>stop().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;}));
    process.once('SIGINT',()=>stop().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;}));
    return host;
  }catch(error) {
    if(host?.server.listening)await host.close();
    await publish({schema:'kaminos.node-app-host.v0',status:'failed',failurePhase:phase,error:error.message,requested:args});
    process.exitCode=1;return null;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await runAppHost();
