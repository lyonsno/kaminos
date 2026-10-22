// kaminos-test: node
import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
let release,entered;const encoding=new Promise(r=>entered=r);globalThis.__cancelEncode=()=>{entered();return new Promise(r=>release=r);};
const hooks=registerHooks({load(url,context,next){
 if(url.endsWith('/unimate-cooperative.js'))return {format:'module',shortCircuit:true,source:`export class CooperativeUniMateDenoiser {static async create(){return {configure(){}}}};export class UniMateDutyScheduler {stats={history:[]};};export function createCooperativeCfgDrift(){throw Error('solve must not start');}`};
 if(url.endsWith('/unimate-t5.js'))return {format:'module',shortCircuit:true,source:`export class T5Encoder {static async create(){return {encode:()=>globalThis.__cancelEncode()}}}`};
 return next(url,context);
}});
const oldFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,headers:{get:()=>null},json:async()=>({file:'weights.bin',parameterCount:1}),arrayBuffer:async()=>new ArrayBuffer(4)});
try{
 const {createUniMateGenerator}=await import('../models/unimate/unimate-generator.js');let begins=0;
 const gen=await createUniMateGenerator({device:{},session:{},beginRun:()=>{begins++;throw Error('must not begin');},weightsBase:'weights/',t5Base:'t5/',skeletonData:{b:{skeleton:{joints:1,parents:[-1],jointNames:['root'],fps:30,frames:2},prompts:[],outputTimes:[0,1]},a:{restPositions:new Float32Array([0,1,0])}}});
 const promise=gen.generate({text:'Walk',seed:1});await encoding;gen.stop();release({pooled:new Float32Array(768)});
 await assert.rejects(promise,/stopped by user/);assert.equal(begins,0,'stopped encoding cannot admit a new solve');assert.equal(gen.running,false);
 console.log('stop during encoding prevents solve and completion');
}finally{hooks.deregister();globalThis.fetch=oldFetch;delete globalThis.__cancelEncode;}
