// kaminos-test: manual — explicit local author model; no GPU, resource lifetime only.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {BufferGeometry} from '../lib/three.webgpu.js';
import experiment from '../experiments/neumip.experiment.mjs';
const [modelPath]=process.argv.slice(2);if(!modelPath)throw Error('Local author archive path required');
const bytes=await fs.readFile(modelPath),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
const originalFetch=globalThis.fetch,originalDispose=BufferGeometry.prototype.dispose;
let disposedGeometries=0,closed=false,rejectAttach=true,holdModel=false,releaseModel;
globalThis.fetch=async url=>String(url).endsWith('catalog.json')?{ok:true,json:async()=>({schema:'kaminos.neumip.author-models.v1',materials:{wool2:{filename:'wool2_web.model',sha256}}})}:{ok:true,url:'fixture:author-archive',arrayBuffer:async()=>{if(holdModel)await new Promise(resolve=>releaseModel=resolve);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};
BufferGeometry.prototype.dispose=function(){disposedGeometries++;return originalDispose.call(this);};
const session={readView(){if(closed)throw Error('Scene session is disposed');return {};},redraw(){},async attach(root){if(rejectAttach)throw Error('Fixture rejected attachment');return {id:'fixture',root};},async dispose(){closed=true;}};
const host={scene:{open:async()=>session,renderer:()=>({backend:{isWebGPUBackend:true}}),objects:()=>[],frame(){}}};
try{
 await assert.rejects(experiment.create({host,inputs:{},record(){},updateInputs(){}}),/Fixture rejected attachment/);
 assert.equal(disposedGeometries,1,'Unadopted carrier geometry must be released after attachment failure');
 closed=false;rejectAttach=false;const owner=await experiment.create({host,inputs:{},record(){},updateInputs(){}});
 holdModel=true;const pending=owner.operations.selectMaterial('wool2');while(!releaseModel)await Promise.resolve();await owner.dispose();releaseModel();
 await assert.doesNotReject(pending,'Late ignored-abort result must not read a disposed scene session');
 console.log('NeuMIP failed-attachment cleanup and stale completion after disposal passed');
}finally{globalThis.fetch=originalFetch;BufferGeometry.prototype.dispose=originalDispose;}
