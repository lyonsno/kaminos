import {createMechanismController} from '../link-workshop.experiment.mjs';
import {emptyMechanism,checkedMechanism} from './model.mjs';
import {mechanismObject,MECHANISM_SOURCE} from './record.mjs';
export function installMechanisms({host,addRecord,onFrame,onError}){
 const runtimes=new Map(),pending=new Map();
 async function ensure(root){
  if(runtimes.has(root))return runtimes.get(root);if(pending.has(root))return pending.get(root);
  const job=createMechanismController({host,inputs:{root}}).then(async runtime=>{
   if(!host.scene.objects().some(e=>e.object===root)){await runtime.dispose();return null;}
   runtime.mount({root:host.controls.document.createElement('div'),document:host.controls.document,invoke:(name,arg)=>Promise.resolve().then(()=>runtime.operations[name](arg))});runtimes.set(root,runtime);return runtime;
  }).finally(()=>pending.delete(root));pending.set(root,job);return job;
 }
 onFrame(()=>{const entries=host.scene.objects(),roots=new Set(entries.filter(e=>e.object?.userData.linkMechanism).map(e=>e.object));
  for(const [root,runtime]of runtimes)if(!roots.has(root)){runtimes.delete(root);void runtime.dispose().catch(onError);}else runtime.tick();
  for(const root of roots)if(!runtimes.has(root)&&!pending.has(root))void ensure(root).catch(onError);
 });
 return {ensure,async add(recipe=emptyMechanism()){
  const root=mechanismObject(checkedMechanism(recipe));const id=await addRecord(root,{type:'pbr',source:MECHANISM_SOURCE,mechanism:recipe,label:'Mechanism',fileName:'Mechanism'});const runtime=await ensure(root);host.scene.select(id);return runtime;
 },read:()=>[...runtimes.values()].map(r=>r.read()),async invoke(id,name,arg){const entry=host.scene.objects().find(e=>e.id===id&&e.object.userData.linkMechanism);if(!entry)throw Error('Choose a mechanism');const runtime=await ensure(entry.object);if(typeof runtime.operations[name]!=='function')throw Error('Unknown mechanism operation');return runtime.operations[name](arg);}};
}
