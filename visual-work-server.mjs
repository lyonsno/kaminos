import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { verifyAuthoringServer } from './scene-authoring-witness-identity.mjs';

// The invocation owns the process; authored stores remain caller-owned.
export function visualWorkServer({repoRoot, sceneStore, basinStore, assets, generatedMeshes, out, python='python3', signal}) {
  const receipt = {owned:true, started:false, closed:false, repoRoot:path.resolve(repoRoot),
    sceneStore:path.resolve(sceneStore), basinStore:path.resolve(basinStore || path.join(out,'basins'))};
  let child, exited, spawnError, closing;
  const close = () => closing ??= (async () => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (exited) await exited;
    receipt.closed = true;
  })();
  const start = async () => {
    const home = path.join(out,'runtime-home');
    for (const dir of [home, receipt.sceneStore, receipt.basinStore]) await fs.mkdir(dir,{recursive:true});
    signal?.throwIfAborted();
    const port = await new Promise((resolve,reject) => {
      const socket = net.createServer();
      socket.once('error',reject);
      socket.listen(0,'127.0.0.1',() => {const port=socket.address().port;socket.close(error=>error?reject(error):resolve(port));});
    });
    receipt.origin = `http://127.0.0.1:${port}`;
    receipt.command = [python,'-u','serve.py',String(port),'--volume-settings-store',receipt.basinStore,'--no-shared-basin-store',
      '--volume-basin-session-store',path.join(out,'basin-sessions'),'--volume-cockpit-layout-store',path.join(out,'layouts')];
    receipt.environment = {HOME:home, KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:receipt.sceneStore};
    if (assets) receipt.environment.KAMINOS_ASSETS_DIR=path.resolve(assets);
    if (generatedMeshes) receipt.environment.KAMINOS_GENERATED_MESH_DIR=path.resolve(generatedMeshes);
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('KAMINOS_')));
    signal?.throwIfAborted();
    const log = openSync(path.join(out,'server.log'),'a');
    try {
      child=spawn(python,receipt.command.slice(1),{cwd:receipt.repoRoot,env:{...inherited,...receipt.environment},stdio:['ignore',log,log]});
    } finally { closeSync(log); }
    exited=new Promise(resolve=>{
      child.once('error',error=>{spawnError=error;resolve();});
      child.once('exit',(code,signal)=>{receipt.exitCode=code;receipt.signal=signal;resolve();});
    });
    child.once('spawn',()=>{receipt.started=true;receipt.pid=child.pid;});
    for (;;) {
      signal?.throwIfAborted();
      if (spawnError) throw spawnError;
      if (child.exitCode!==null || child.signalCode!==null) throw Error(`Owned server exited before use; see ${path.join(out,'server.log')}`);
      let response;
      try { response=await fetch(`${receipt.origin}/api/runtime-config`,{signal}); } catch(error) { if(signal?.aborted)throw error; }
      if (response?.ok) break;
      await setTimeout(100,undefined,{signal});
    }
    receipt.serving=await verifyAuthoringServer({origin:receipt.origin,repoRoot:receipt.repoRoot,
      fetch:(url,options)=>fetch(url,{...options,signal})});
    if (spawnError || child.exitCode!==null || child.signalCode!==null) throw Error('Owned server exited during identity verification');
    return receipt.origin;
  };
  return {receipt,start,close};
}
