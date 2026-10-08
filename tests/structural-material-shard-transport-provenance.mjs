import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {inspectShardWitness} from '../structural-material-shard-evidence.mjs';
import {applyComponentTransport} from '../structural-material-component-transport.mjs';
import {materialComponents} from '../structural-material-solid-surface.mjs';
const [file]=process.argv.slice(2);if(!file)throw new Error('Observed native transport witness required');const original=JSON.parse(fs.readFileSync(file));assert.deepEqual(inspectShardWitness(original),[]);
const current=Array.from({length:original.state.model.points},(_,i)=>original.state.state.slice(i*16+4,i*16+7)),components=materialComponents(current.length,original.state.bonds);
for(const kind of ['frame-weights','surface-weights','radius']){
 const w=structuredClone(original),p=w.pieces.find(p=>p.binding.frame.ids.length>4),b=p.binding;
 if(kind==='frame-weights')b.frame.weights=b.frame.ids.map((_,i)=>i===0?1-(b.frame.ids.length-1)*1e-8:1e-8);
 if(kind==='surface-weights'){const rest=new Map(b.frame.ids.map((id,i)=>[id,b.frame.rest[i]]));for(const e of b.entries){e.weights=e.ids.map((_,i)=>i===0?1-(e.ids.length-1)*1e-8:1e-8);e.offset=e.point.map((x,k)=>x-e.ids.reduce((s,id,i)=>s+e.weights[i]*rest.get(id)[k],0));}}
 if(kind==='radius')for(const e of b.entries)e.effectiveRadius=-1;
 const field=applyComponentTransport(b,current,{components});p.renderedPositions=p.geometry.indices.flatMap(i=>field[i]);
 assert.ok(inspectShardWitness(w).some(e=>/construction law/.test(e)),`${kind}: internally consistent forged correspondence must fail its effective construction law`);
}
const helper=await import('../structural-material-shard-spur-evidence.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
let summarize=helper?.summarizeShardReplay;
if(!summarize){const source=fs.readFileSync(new URL('../structural-material-shard-spur-replay.mjs',import.meta.url),'utf8'),start=source.indexOf('const determinant='),end=source.indexOf('\ntry{',start);summarize=vm.runInNewContext(source.slice(start,end)+';summarize');}
for(const kind of ['empty','short','nonfinite']){const w=structuredClone(original);if(kind==='empty')w.pieces[0].renderedPositions=[];if(kind==='short')w.pieces[0].renderedPositions.pop();if(kind==='nonfinite')w.pieces[0].renderedPositions[0]=NaN;assert.throws(()=>summarize(w),/Rendered skin|Incomplete/,`${kind}: missing surface evidence must not become zero travel`);}
console.log('Observed native forged correspondence and absent/partial/nonfinite replay surfaces fail admission');
