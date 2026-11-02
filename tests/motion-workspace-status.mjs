// kaminos-test: node
import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
import {Element,controlDocument} from './helpers/control-document.mjs';
Element.prototype.replaceChildren=function(...nodes){this.children=[];this.append(...nodes);};
const all=n=>[n,...n.children.flatMap(all)],document=controlDocument();
const create=document.createElement;document.createElement=tag=>{const n=create();n.tagName=tag;return n;};
let rejectGeneration,progress,partial;globalThis.__workspaceStatusGenerate=options=>{progress=options.onProgress;partial=options.onPartial;return new Promise((_r,reject)=>{rejectGeneration=reject;});};
const hooks=registerHooks({load(url,ctx,next){if(url.endsWith('/motion-generation.mjs'))return {format:'module',shortCircuit:true,source:'export const generateSkeletonMotion=options=>globalThis.__workspaceStatusGenerate(options);export const stopSkeletonMotion=()=>{};'};return next(url,ctx);}});
try{
const {sessionMotions}=await import('../experiments/creature-motion/motion-collection.mjs');
const {mountMotionWorkspace}=await import('../experiments/creature-motion/motion-workspace.mjs');
const motion={status:'completed',route:'unimate.text-to-motion.webgpu-local.v0',textEncoder:'browser T5',cooperative:true,controllerNorm:'valid-joints',assetCondSha256:'a'.repeat(64),prompt:'retained walk',seed:1,frames:2,joints:2,skeleton:{jointNames:['root','foot'],parents:[-1,0],fps:30},positions:Array(12).fill(0),localRotations:[0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1]};await sessionMotions.add(motion);
for(const name of ['Preview','Use on creature','Restore assigned motion'])for(const beginsBeforeStop of [false,true]){
 let releaseAction;const action=()=>new Promise(resolve=>{releaseAction=resolve;});
 const workspace=mountMotionWorkspace({document,reference:motion,spec:{bundle:'test'},options:{},onPreview:action,onApply:action,onRestore:action,onFrame:()=>()=>{}});
 const pending=workspace.generate({prompt:'new attempt',seed:1});const nodes=()=>all(workspace.node),button=()=>nodes().find(n=>n.tagName==='button'&&n.textContent===name),status=()=>nodes().find(n=>n.role==='status').textContent;
 await partial({...motion,status:'partial',refinement:{t:.2,index:1,evaluations:8}});assert(nodes().some(n=>n.className==='motion-active'));assert(nodes().some(n=>n.tagName==='canvas'));
 let clicked;if(beginsBeforeStop)clicked=button().onclick();workspace.stop();if(!beginsBeforeStop)clicked=button().onclick();releaseAction({});await clicked;
 progress({phase:'running',stage:'solve',progress:{evaluations:50,acceptedT:.2,acceptedSteps:2,rejectedSteps:6}});
 assert.match(status(),/Stopping/,`${name} must preserve outstanding cancellation (beganBeforeStop=${beginsBeforeStop})`);assert(workspace.read().pending);assert(nodes().find(n=>n.tagName==='button'&&n.textContent==='Make motion').disabled);await assert.rejects(workspace.generate({prompt:'overlap',seed:2}),/already running/);
 rejectGeneration(Error('stopped'));assert.equal((await pending).status,'stopped');assert.match(status(),/Stopped/);workspace.dispose();
}
console.log('Stop status survives preview, assignment and restore actions before/after cancellation');
}finally{hooks.deregister();delete globalThis.__workspaceStatusGenerate;}
