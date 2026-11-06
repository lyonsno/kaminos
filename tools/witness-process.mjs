import net from 'node:net';
import {spawn} from 'node:child_process';

export async function reserveWitnessPort(){
 const socket=net.createServer();
 await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
 const port=socket.address().port;
 await new Promise((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
 return port;
}

export function spawnWitnessServer(command,args,options,onChild){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,options);onChild(child);
  // Retain an error listener after successful spawn as well, so a later child
  // error cannot terminate the witness outside its terminal reporting path.
  child.on('error',error=>{child.witnessError=error;reject(error);});
  child.once('spawn',()=>resolve(child));
 });
}

export async function finishWitness(report,{browser,server,save}){
 async function cleanup(phase,operation){
  try{await operation();}catch(error){
   (report.cleanupErrors??=[]).push({phase,error:String(error.stack??error)});
   report.failurePhase??=phase;report.status='failed';process.exitCode=1;
  }
 }
 await cleanup('browser-close',async()=>{await browser?.close();report.browserClosed=true;});
 await cleanup('server-stop',async()=>{
  if(server?.pid&&server.exitCode===null&&server.signalCode===null){
   await new Promise((resolve,reject)=>{server.once('exit',resolve);server.once('error',reject);if(!server.kill('SIGTERM'))reject(Error('Witness server refused termination'));});
  }
  report.serverClosed=true;
 });
 // Always save after independently attempting each owned resource's cleanup.
 await save();
}
