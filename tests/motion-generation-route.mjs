// kaminos-test: node
import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {createHash} from 'node:crypto';
const schema='unimate.text-to-motion.webgpu-local.v0',uuid='12345678-1234-4234-8234-123456789abc',bytes=new ArrayBuffer(0),sha=createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
const skeleton={name:'Fixture',fps:30,jointNames:['root'],parents:[-1]},reference={skeleton,assetCondSha256:'d'.repeat(64)};
let routeId=schema+':'+uuid;
globalThis.__routeConsumer=host=>({async run({onPartial}){await host.beginRun('observed-run',{routeId});if(onPartial)await onPartial({textEncoder:'browser T5',skeleton,motion:{frames:1,joints:1,positions:[0,0,0],localRotations:[1,0,0,0]},t:.5,index:1,evaluations:4});return {report:{textEncoder:'browser T5',prompt:'Walk',seed:1},skeleton,motion:{frames:1,joints:1,positions:[0,0,0],localRotations:[1,0,0,0]}};},stop(){}});
const hooks=registerHooks({load(url,context,next){if(url.endsWith('/models/unimate/unimate-consumer.js'))return {format:'module',shortCircuit:true,source:'export const createUniMateConsumer = host => globalThis.__routeConsumer(host);'};return next(url,context);}});
const previousFetch=globalThis.fetch;globalThis.fetch=async url=>new Response(String(url).endsWith('demo.json')?JSON.stringify({sha256:sha,assetCondSha256:reference.assetCondSha256,skeleton,arrays:[]}):bytes);
try{
 const {generateSkeletonMotion}=await import('../experiments/creature-motion/motion-generation.mjs');const input={spec:{bundle:'http://fixture/',sha256:sha},reference,prompt:'Walk',seed:1,getHost:()=>({beginRun:async()=>({})})};
 const partials=[];input.onPartial=p=>partials.push(p);const m=await generateSkeletonMotion(input);assert.equal(partials.length,1,'Forward decoded samples before generation completes');assert.equal(partials[0].status,'partial');assert.equal(partials[0].generation.route.routeId,routeId);assert.equal(m.route,schema,'Motion family stays compatible with retained motion admission');assert.equal(m.generation.route.routeId,routeId,'Preserve the actual observed runtime route');
 routeId='fallback:'+uuid;await assert.rejects(generateSkeletonMotion(input),/requested motion route/);
 routeId=schema+':not-a-runtime-uuid';await assert.rejects(generateSkeletonMotion(input),/requested motion route/);
}finally{hooks.deregister();globalThis.fetch=previousFetch;delete globalThis.__routeConsumer;}
console.log('Observed generator runtime route namespaces are admitted; unrelated and malformed routes are refused');
