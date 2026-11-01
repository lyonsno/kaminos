// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
// This tiny shader expression is scalar/component-wise JS-compatible. Execute
// each velocity component's actual expression; this is not GPU conformance.
const start=source.indexOf('fn openWorldAmbient('),bodyStart=source.indexOf('{',start);
let depth=1,end=bodyStart+1;
while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
const body=source.slice(bodyStart+1,end-1).replaceAll(/(\d)u\b/g,'$1');
const component=new Function('p','slot','sample','ghostOutsideAmount','clamp',body);
test('ambient inflow does not recycle the edge momentum as external wind',()=>{
  for(const velocity of [-1.2,.7])for(const outside of [0,.25,1,2]){
    const got=component(null,0,velocity,()=>outside,(x,a,b)=>Math.max(a,Math.min(b,x)));
    assert.equal(got,velocity*(1-Math.min(1,outside)));
  }
});
test('interior and outflow characteristics retain their velocity and material',()=>{
  for(const slot of [0,1,2,3])for(const value of [-.3,0,.9])
    assert.equal(component(null,slot,value,()=>0,(x,a,b)=>Math.max(a,Math.min(b,x))),value);
});
