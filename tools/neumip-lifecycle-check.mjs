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
let catalog={schema:'kaminos.neumip.author-models.v1',materials:{wool2:{filename:'wool2_web.model',sha256}}};
globalThis.fetch=async url=>String(url).endsWith('catalog.json')?{ok:true,json:async()=>catalog}:{ok:true,url:'fixture:author-archive',arrayBuffer:async()=>{if(holdModel)await new Promise(resolve=>releaseModel=resolve);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};
BufferGeometry.prototype.dispose=function(){disposedGeometries++;return originalDispose.call(this);};
const session={readView(){if(closed)throw Error('Scene session is disposed');return {};},redraw(){},async attach(root){if(rejectAttach)throw Error('Fixture rejected attachment');return {id:'fixture',root};},async dispose(){closed=true;}};
const host={scene:{open:async()=>session,renderer:()=>({backend:{isWebGPUBackend:true}}),objects:()=>[],frame(){}}};
try{
 await assert.rejects(experiment.create({host,inputs:{},record(){},updateInputs(){}}),/Fixture rejected attachment/);
 assert.equal(disposedGeometries,1,'Unadopted carrier geometry must be released after attachment failure');
 closed=false;rejectAttach=false;const owner=await experiment.create({host,inputs:{},record(){},updateInputs(){}});
 holdModel=true;const pending=owner.operations.selectMaterial('wool2');while(!releaseModel)await Promise.resolve();await owner.dispose();releaseModel();
 await assert.doesNotReject(pending,'Late ignored-abort result must not read a disposed scene session');
 closed=false;holdModel=false;catalog={schema:'kaminos.neumip.models.v1',materials:{student:{url:'fixture:student-archive',sha256}}};
 let custom;await assert.doesNotReject(async()=>{custom=await experiment.create({host,inputs:{catalogURL:'/fixture/catalog.json'},record(){},updateInputs(){}});},'Custom catalogs choose an installed material when none is specified');
 assert.equal(custom.read().material,'student');
 // A superseded load is ordinary latest-selection behavior; real current
 // failures still reject so the operator sees them.
 const normalFetch=globalThis.fetch;
 catalog.materials.slow={url:'fixture:held-archive',sha256};catalog.materials.broken={url:'fixture:failed-archive',sha256};
 const fakeDocument={activeElement:null,createElement(tag){return {tag,ownerDocument:this,children:[],value:'',append(...children){this.children.push(...children);},addEventListener(){}};}};
 const root=fakeDocument.createElement('root');host.controls={installNumberDrag(){return {dispose(){}};}};
 custom.mount({root,document:fakeDocument,invoke:(operation,input)=>custom.operations[operation](input)});
 const materialPicker=root.children[0].children[1];
 let heldStarted;const heldReady=new Promise(resolve=>heldStarted=resolve);
 globalThis.fetch=(url,options={})=>{
   if(url==='fixture:held-archive')return new Promise((resolve,reject)=>{heldStarted();options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
   if(url==='fixture:failed-archive')return Promise.resolve({ok:false,status:503});
   return normalFetch(url,options);
 };
 const obsolete=custom.operations.selectMaterial('slow'),settled=obsolete.then(()=>null,error=>error);await heldReady;
 assert.equal(materialPicker.value,'slow','Picker must retain the requested option while loading so the operator can switch back');
 await custom.operations.selectMaterial('student');
 assert.equal(await settled,null,'Superseded load cancellation must not become a material-selection error');
 assert.equal(custom.read().material,'student');assert.equal(materialPicker.value,'student');
 await assert.rejects(custom.operations.selectMaterial('broken'),/HTTP 503/,'Current load failure must remain visible');
 globalThis.fetch=normalFetch;
 await custom.dispose();closed=false;
 catalog.materials.student={sha256};
 await assert.rejects(experiment.create({host,inputs:{catalogURL:'/fixture/catalog.json',material:'student'},record(){},updateInputs(){}}),/source URL|filename/);
 console.log('NeuMIP lifecycle, custom-catalog selection and invalid source checks passed');
}finally{globalThis.fetch=originalFetch;BufferGeometry.prototype.dispose=originalDispose;}
