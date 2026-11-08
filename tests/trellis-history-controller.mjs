// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as format from '../models/trellis2/voxel-history.js';
import {buildOccupancyCoordinatesPlan,createTrellisOccupancyPreview} from '../models/trellis2/occupancy-coordinates.js';

const implementation=readFileSync(new URL('../authoring-trellis-history.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function');
function setup({postFailure=false}={}){
 let fail=postFailure,gets=0,copies=0,remote;
 const posts=[],attached=[];
 const device={createCommandEncoder(){const work=[];return {copyBufferToBuffer(a,ao,b,bo,size){work.push(()=>{new Uint8Array(b.data,bo,size).set(new Uint8Array(a.data,ao,size));copies++;});},finish(){return work;}};},createBuffer({size}){return {data:new ArrayBuffer(size),async mapAsync(){},getMappedRange(offset,size){return this.data.slice(offset,offset+size);},unmap(){},destroy(){}};}};
 const foreground={request({run}){return {completion:Promise.resolve().then(()=>({result:run({submit(commands){for(const command of commands)for(const copy of command)copy();}})}))};}};
 const scene={async open(){return {async attach(root){root.parent={};attached.push(root);return {root};},onFrame(){return ()=>{};},redraw(){},readView(){return {};},setView(){},async dispose(){}};}};
 const fetcher=async(url,options)=>{
  if(options?.method==='POST'){const body=JSON.parse(options.body);posts.push(body);if(fail&&body.frame){fail=false;return {ok:false,json:async()=>({error:'Disk temporarily unavailable'})};}return {ok:true,json:async()=>({runId:body.runId,frameId:body.frame?.id??null})};}
  gets++;return {ok:true,json:async()=>structuredClone(remote)};
 };
 const element=tag=>({tagName:tag,children:[],textContent:'',append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){},remove(){}}),document={createElement:element},root=element('main');
 const context=vm.createContext({...format,console,crypto:webcrypto,performance,Int32Array,Map,Set,Promise,structuredClone,fetch:fetcher,
  createTrellisVoxelVisual({frame,coordinates}){const root={visible:false,parent:null},buffer={data:coordinates?.buffer.slice(0)??new ArrayBuffer(frame.count*12)};return {root,buffer:()=>buffer,read:()=>({count:frame.count,registered:!!root.parent,visible:root.visible}),dispose(){root.parent=null;}};},mountPlaybackControls(){return {update(){},dispose(){}};}});
 const create=vm.runInContext(implementation+';createAuthoringTrellisHistory',context);
 const rows=new Int32Array([0,0,0,1,2,3]),coordinates={buffer:{data:rows.buffer},shape:[2,3],dtype:'i32',usage:140,byteLength:24};
 const preview=current=>createTrellisOccupancyPreview({runtime:{device},coordinates,plan:buildOccupancyCoordinatesPlan({resolution:8}),runId:'test-run',routeId:'trellis2.actual',steps:12,invocation:{jobId:'job',invocationId:'invocation'},isCurrent:()=>current});
 const text=node=>node.textContent+' '+node.children.map(text).join(' ');
 return {create:()=>create({renderer:{backend:{isWebGPUBackend:true,device}},scene,foreground,document,fetcher}),root,text:()=>text(root),preview,rows,posts,attached,get copies(){return copies;},get gets(){return gets;},get remote(){return remote;},set remote(value){remote=value;}};
}
test('failed persistence keeps captured rows retryable without inventing a capture gap or rerunning the GPU copy',async()=>{
 const h=setup({postFailure:true}),c=await h.create();c.start({runId:'test-run',label:'Shoe',source:{routeId:'trellis2.actual'}});
 assert.equal(c.capture(h.preview(true)),undefined,'optional capture returns immediately');await c.watch();await c.finish('test-run');
 assert.equal(c.read().frames.length,1);assert.equal(c.read().gaps.length,0,'save failure is not a missing emitted snapshot');assert.equal(c.read().status,'incomplete');
 assert.equal(typeof c.operations.retrySaving,'function');const copies=h.copies;await c.operations.retrySaving();
 assert.equal(c.read().status,'completed');assert.equal(c.read().retention.failed,0);assert.equal(h.copies,copies,'retry uses complete retained CPU rows');
 const successful=h.posts.filter(x=>x.frame).at(-1);assert.deepEqual([...new Int32Array(Uint8Array.from(atob(successful.coordinatesBase64),x=>x.charCodeAt(0)).buffer)],[...h.rows]);await c.dispose();
});
test('expired source remains an explicit missing snapshot with no invented completed history',async()=>{
 const h=setup(),c=await h.create();c.start({runId:'test-run',label:'Shoe',source:{routeId:'trellis2.actual'}});c.capture(h.preview(false));await c.watch();await c.finish('test-run');
 assert.equal(c.read().status,'incomplete');assert.equal(c.read().frames.length,0);assert.equal(c.read().gaps.length,1);assert.match(c.read().gaps[0].reason,/retired/);assert.equal(h.copies,0);assert.equal(h.attached.length,0);await c.dispose();
});
test('reopening remote history refreshes additions and preserves its incomplete status and cause',async()=>{
 const h=setup(),c=await h.create();h.remote={schema:format.VOXEL_HISTORY_SCHEMA,runId:'saved',label:'Shoe',source:{kind:'retained-reference-replay'},status:'incomplete',error:'A snapshot was missed',gaps:[{id:'missed',stage:'occupancy-coordinates',reason:'Source retired'}],frames:[]};
 await c.open({runId:'saved'});assert.equal(c.read().status,'incomplete');assert.equal(c.read().error,'A snapshot was missed');assert.equal(c.read().retention.failed,1);
 h.remote={...h.remote,error:'Updated saved cause'};await c.open({runId:'saved'});assert.equal(h.gets,2);assert.equal(c.read().error,'Updated saved cause');await c.dispose();
});
test('terminal empty histories name their outcome instead of promising a grid that cannot arrive',async()=>{
 for(const status of ['failed','stopped','completed']){
  const h=setup(),c=await h.create();c.mount({root:h.root});c.start({runId:'test-run',label:'Shoe',source:{routeId:'trellis2.actual'}});await c.watch();assert.match(h.text(),/Waiting for the first/);
  await c.finish('test-run',status);assert.doesNotMatch(h.text(),/Waiting for the first/);assert.match(h.text(),status==='failed'?/Failed/:status==='stopped'?/Stopped/:/No snapshots retained/);await c.dispose();
 }
});
test('a terminal failed run keeps the earlier snapshot usable and names the failed outcome',async()=>{
 const h=setup(),c=await h.create();c.mount({root:h.root});c.start({runId:'test-run',label:'Shoe',source:{routeId:'trellis2.actual'}});c.capture(h.preview(true));await c.watch();await c.finish('test-run','failed');
 assert.equal(c.read().presentation.count,2);assert.match(h.text(),/Failed/);assert.match(h.text(),/2 occupied voxels/);await c.dispose();
});
