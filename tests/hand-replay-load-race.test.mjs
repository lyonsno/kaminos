// kaminos-test: node
import assert from 'node:assert/strict';
import experiment from '../experiments/hand-replay.experiment.mjs';
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const models=[{id:'local-policy-fixture',label:'fixture',checkpointSha256:'a'.repeat(64),faces:[]}];
const makeSequence=label=>JSON.stringify({schema:'hand-state.teacher-replay.v1',generation:'test',label,models,frames:[{captureId:label,timeMs:0,image:`/${label}.jpg`,hands:[{status:'observed',vertices:Array.from({length:778},()=>[0,0,0]),joints:Array.from({length:21},()=>[0,0,0])}]}]});
const first=makeSequence('first'),second=makeSequence('second');
const catalog=JSON.stringify({generation:'test',models,sequences:[{url:'/first',sha256:await hash(first)},{url:'/second',sha256:await hash(second)}]});
const receipt=JSON.stringify({status:'observed',generation:'test',catalogSha256:await hash(catalog)});
const response=text=>({ok:true,text:async()=>text});
let rejectOlder,notifyOlder,delay=false;
const held=new Promise(resolve=>notifyOlder=resolve);
globalThis.fetch=async url=>{
 const path=new URL(url,'http://fixture/').pathname;
 if(path==='/second'&&delay){notifyOlder();return new Promise((_,reject)=>rejectOlder=reject);}
 return response({'/catalog.json':catalog,'/first':first,'/second':second,'/export-report.json':receipt}[path]);
};
globalThis.Image=class{set src(value){this._src=value;queueMicrotask(()=>this.onload());}get src(){return this._src;}};
class Element{
 style={};dataset={};children=[];
 append(...children){this.children.push(...children);}
 setAttribute(name,value){this[name]=value;}
 removeAttribute(name){delete this[name];}
 getContext(){return {fillRect(){},fillText(){}};}
}
const document={baseURI:'http://fixture/',defaultView:{},createElement:()=>new Element()};
const attached=[];const scene={attach:async root=>attached.push(root),readView:()=>({}),redraw(){},setView(){},onFrame:()=>()=>{},async dispose(){}};
const instance=await experiment.create({host:{controls:{document},scene:{open:async()=>scene}},inputs:{manifest:'/catalog.json'},record(){}});
const root=new Element();instance.mount({root,document,invoke:(op,value)=>instance.operations[op](value)});
const preview=root.children.find(e=>e.alt==='Exact recorded camera frame');const status=root.children.find(e=>e.role==='status');
delay=true;const older=instance.operations.load(1).catch(e=>e);await held;
const newer=await instance.operations.load(0);const savedPreview=preview.src,savedStatus=status.textContent;
rejectOlder(Error('obsolete-source-failure'));await older;
const survived=instance.read();
assert.equal(survived.sequence,newer.sequence);assert.equal(survived.captureId,newer.captureId);assert.deepEqual(survived.displayed,newer.displayed);assert.equal(survived.error,null);
assert.equal(preview.src,savedPreview);assert.equal(status.textContent,savedStatus);assert.equal(attached[0].children[0].visible,true);
await instance.dispose();console.log('hand replay stale-load rejection passed');
