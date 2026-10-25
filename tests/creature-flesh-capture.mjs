// kaminos-test: node
import assert from 'node:assert/strict';
import {captureContactPage} from '../tools/creature-flesh-capture.mjs';
const png=Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001','hex');
let detached=0;const session={send:async()=>({data:png.toString('base64')}),detach:async()=>{detached++;}};
assert.deepEqual(await captureContactPage(session),png);
for(const response of [{},{data:''},{data:Buffer.from('not a frame').toString('base64')}]){session.send=async()=>response;await assert.rejects(()=>captureContactPage(session),/PNG/);}
console.log('Native screenshot transport refuses missing/blank/non-PNG output; pixel quality is a separate visual observation');
