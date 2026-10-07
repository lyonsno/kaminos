import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lightingDirections} from '../scene-volume-gather.mjs';
import {progressiveSourcePoint} from '../scene-source-aware.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const select=html.match(/<select id="rendering-angular-samples">([\s\S]*?)<\/select>/);
assert(select,'live direction selector must exist');
const options=[...select[1].matchAll(/<option([^>]*)>(\d+)<\/option>/g)].map(m=>({value:Number(m[2]),selected:/\bselected\b/.test(m[1])}));
for(const count of [8,10]){
 assert(options.some(x=>x.value===count),`live lighting controls must offer ${count} directions`);
 assert.equal(lightingDirections(count).length,count);
 const points=Array.from({length:count},(_,i)=>progressiveSourcePoint(i));
 assert.deepEqual(points,Array.from({length:12},(_,i)=>progressiveSourcePoint(i)).slice(0,count),'low source-aware counts remain exact progressive prefixes');
}
assert.deepEqual(options.filter(x=>x.selected).map(x=>x.value),[24],'experimental lower counts must not change the existing default');
for(const count of [12,16,24,48,96])assert(options.some(x=>x.value===count),'existing comparison count must remain offered');
console.log('8/10 live selector, progressive prefixes and unchanged default contracts passed');
