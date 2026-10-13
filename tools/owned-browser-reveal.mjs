import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export async function commandJson(executable,args) {
  const child=spawn(executable,args,{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  if(exit!==0)throw Error(`${executable} exited ${exit}: ${stderr}`);
  return JSON.parse(stdout);
}

export function greenroomProcessStarts(python,pids) {
  return commandJson(python,['-c','import json,sys; from gpu_queue.queue import GPUQueue; print(json.dumps([GPUQueue._process_start_identity(int(p)) for p in sys.argv[1:]]))',...pids.map(String)]);
}

export function greenroomRevealBinding(python,queueDir,requestId,url) {
  return commandJson(python,['-c','import json,sys; from pathlib import Path; from gpu_queue.smoke_requests import SmokeRequests; r=SmokeRequests(Path(sys.argv[1])/"smoke-requests").get(sys.argv[2]); print(json.dumps(dict(request_id=sys.argv[2],request_digest=r["request_digest"],job_id=r["activation"]["job_id"],url=sys.argv[3])))',queueDir,requestId,url]);
}

export function macBrowserForeground(pid,reveal=false) {
  if(process.platform!=='darwin')throw Error('Native browser reveal currently requires macOS');
  const script=`ObjC.import('AppKit'); function run(argv) { var pid=Number(argv[0]); var app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(pid); if(!app || app.isTerminated) throw Error('Owned browser process is gone'); var activated=false; if(argv[1]==='reveal') activated=Boolean(app.activateWithOptions(3)); var front=$.NSWorkspace.sharedWorkspace.frontmostApplication; return JSON.stringify({pid:pid,activated:activated,foreground:front.processIdentifier===pid,foregroundPid:Number(front.processIdentifier)}); }`;
  return commandJson('/usr/bin/osascript',['-l','JavaScript','-e',script,String(pid),reveal?'reveal':'inspect']);
}

// The service holds only the page the runner already owns. It cannot navigate
// or create a page, and successful reveal includes actual OS foreground state.
export async function createOwnedBrowserReveal({page,browser,browserPid,binding,readStarts,nativeForeground=macBrowserForeground,socketPath=null,record=()=>{}}) {
  let directory=null,closed=false,serial=Promise.resolve();
  if(!socketPath){directory=await fs.mkdtemp(path.join(os.tmpdir(),'kbr-'));socketPath=path.join(directory,'r.sock');}
  if(!path.isAbsolute(socketPath)||Buffer.byteLength(socketPath)>=104)throw Error('Reveal socket needs a short absolute path');
  const cdp=await page.context().newCDPSession(page);
  const target=async()=>{if(closed||page.isClosed()||!browser.isConnected())throw Error('Owned browser session ended');return (await cdp.send('Target.getTargetInfo')).targetInfo;};
  const initial=await target();
  const starts=await readStarts([process.pid,browserPid]);
  if(!starts.every(value=>typeof value==='string'&&value))throw Error('Owned process start identity unavailable');
  const identity={schema:'gpu-greenroom.application-reveal.v1',socket_path:socketPath,session_id:randomUUID(),
    owner_pid:process.pid,owner_start_identity:starts[0],browser_pid:browserPid,browser_start_identity:starts[1],page_id:initial.targetId};
  async function verify(){
    const current=await target();
    if(current.targetId!==identity.page_id||page.url()!==binding.url||current.url!==binding.url)throw Error('Owned page changed');
    const now=await readStarts([identity.owner_pid,identity.browser_pid]);
    if(now[0]!==identity.owner_start_identity||now[1]!==identity.browser_start_identity)throw Error('Owned process expired or changed');
  }
  async function handle(request){
    const receipt={...request,schema:'gpu-greenroom.application-reveal-receipt.v1'};
    try{
      if(request?.schema!=='gpu-greenroom.application-reveal-request.v1'||!['inspect','reveal'].includes(request.action)
        ||typeof request.call_id!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(request.call_id))throw Error('Unsupported reveal request');
      for(const key of ['request_id','request_digest','job_id','url'])if(request[key]!==binding[key])throw Error(`Reveal ${key} changed`);
      for(const [key,value] of Object.entries(identity))if(request.reveal?.[key]!==value)throw Error(`Reveal identity ${key} changed`);
      await verify();
      if(request.action==='reveal')await page.bringToFront();
      const native=await nativeForeground(browserPid,request.action==='reveal');
      await verify();receipt.native=native;
      if(request.action==='reveal'){
        if(native.pid!==browserPid||native.foreground!==true)throw Error('Owned browser foreground not observed');
        receipt.foreground=true;
      }
    }catch(error){delete receipt.foreground;receipt.error=String(error.message||error);}
    await record(receipt);return receipt;
  }
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let buffer='',received=false;
    socket.on('data',chunk=>{
      if(received)return;buffer+=chunk;
      const newline=buffer.indexOf('\n');if(newline<0)return;received=true;
      let request;
      try{request=JSON.parse(buffer.slice(0,newline));}catch(error){socket.end(JSON.stringify({schema:'gpu-greenroom.application-reveal-receipt.v1',error:'Invalid reveal JSON'})+'\n');return;}
      serial=serial.then(()=>handle(request)).then(receipt=>{socket.end(JSON.stringify(receipt)+'\n');}).catch(error=>{socket.end(JSON.stringify({schema:'gpu-greenroom.application-reveal-receipt.v1',error:String(error)})+'\n');});
    });
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
    await fs.chmod(socketPath,0o600);
  }catch(error){await cdp.detach();if(directory)await fs.rmdir(directory);throw error;}
  const inode=(await fs.lstat(socketPath)).ino;
  return {identity,handle,
    async dispose(){if(closed)return;closed=true;for(const socket of sockets)socket.destroy();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await serial;
      await cdp.detach().catch(()=>{});
      try{if((await fs.lstat(socketPath)).ino===inode)await fs.unlink(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(directory)await fs.rmdir(directory);
    }};
}
