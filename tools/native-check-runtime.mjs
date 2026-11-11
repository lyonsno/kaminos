import net from 'node:net';
import {spawn} from 'node:child_process';
export async function nativeCheckPort(createServer=()=>net.createServer()){
 const socket=createServer();
 try{
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
  const port=socket.address().port;
  await new Promise((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
  return port;
 }finally{if(socket.listening)await new Promise(resolve=>socket.close(resolve));}
}
export async function nativeCheckSpawn(command,args,options,spawnChild=spawn){
 const child=spawnChild(command,args,options);
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});
 return child;
}
