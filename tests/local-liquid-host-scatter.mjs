// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Evaluate the production WGSL component by component: all operations in this
// finite block are componentwise. This checks the shipped expression, not a
// parallel reference implementation of it.
const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
const start=source.indexOf('  let absorptionLoss ='),end=source.indexOf('  let directRoughness =',start);
assert.ok(start>0&&end>start);
const block=source.slice(start,end);
function scatter(absorption,host=true){return [0,1,2].map(channel=>{
 const scalar=block.replace(/vec3<f32>\(([^)]+)\)/g,(_,args)=>{const values=args.split(',');return '('+(values.length===1?values[0]:values[channel])+')';});
 return runInNewContext(scalar+'\nwaterScatter;', {hostTransport:host,absorption:absorption[channel],params:{hostFrameControls:{x:host?1:0}}});
});}
const color=[.055,.30,.42];
assert.deepEqual(scatter([1,1,1]),[0,0,0],'zero optical depth must add no host haze');
for(const absorption of [[.99,.995,.999],[.4,.7,.9],[0,0,0]]){
 const host=scatter(absorption);
 host.forEach((value,i)=>assert.ok(Math.abs(value-color[i]*(1-absorption[i]))<1e-12,'host scatter follows lost transmittance'));
 const legacy=scatter(absorption,false);
 legacy.forEach((value,i)=>assert.ok(Math.abs(value-color[i]*(.42+.58*(1-absorption[i])))<1e-12,'standalone appearance is preserved'));
}
assert.ok(scatter([.999999,.999999,.999999]).every(v=>v<1e-6),'thin water approaches zero continuously');
console.log('host water scatter vanishes at zero optical depth; standalone unchanged');
