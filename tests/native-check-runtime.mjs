// kaminos-test: node
import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {nativeCheckPort,nativeCheckSpawn} from '../tools/native-check-runtime.mjs';
const denied=new Error('listen EPERM');const socket=Object.assign(new EventEmitter(),{listening:false,listen(){queueMicrotask(()=>this.emit('error',denied));},close(){throw Error('Cannot close unbound socket');}});
await assert.rejects(nativeCheckPort(()=>socket),e=>e===denied);
const missing=new Error('spawn ENOENT');await assert.rejects(nativeCheckSpawn('missing',[],{},()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',missing));return child;}),e=>e===missing);
let closes=0;const available=Object.assign(new EventEmitter(),{listening:false,listen(_port,_host,done){this.listening=true;done();},address:()=>({port:1234}),close(done){closes++;this.listening=false;done();}});
assert.equal(await nativeCheckPort(()=>available),1234);assert.equal(closes,1);
console.log('Native checker launch errors reject into terminal reporting');
