import assert from 'node:assert/strict';
import {bindSceneLightEditInteraction,lightingEditStatus} from '../scene-light-edit-interaction.mjs';
class Events {
  handlers=new Map();
  addEventListener(name,fn){const rows=this.handlers.get(name)||[];rows.push(fn);this.handlers.set(name,rows);}
  removeEventListener(name,fn){this.handlers.set(name,this.handlers.get(name).filter(x=>x!==fn));}
  send(name,e={}){for(const f of this.handlers.get(name)||[])f(e);}
}
const document=new Events(),window=new Events(),active=new Set();
const target={matches:()=>true};
const dispose=bindSceneLightEditInteraction({document,window,getLighting:()=>({setEditing(k,on){on?active.add(k):active.delete(k);}})});
document.send('pointerdown',{target,pointerId:7});document.send('input',{target});
assert.deepEqual([...active],['input-pointer:7']);
window.send('pointerup',{pointerId:7});assert.equal(active.size,0);
document.send('keydown',{target,key:'ArrowRight'});document.send('input',{target});document.send('change',{target});
assert.equal(active.size,1,'range change while keyboard held cannot commit geometry');
window.send('keyup',{key:'ArrowRight'});assert.equal(active.size,0);
document.send('input',{target});assert.ok(active.has(target));document.send('change',{target});assert.equal(active.size,0);
document.send('input',{target});window.send('blur');assert.equal(active.size,0,'lost focus cannot strand edit state');
document.send('pointerdown',{target,pointerId:8});window.send('pointercancel',{pointerId:8});assert.equal(active.size,0);
assert.match(lightingEditStatus({previewStale:true}),/previous geometry/);
assert.match(lightingEditStatus({status:'rebuild-pending'}),/Rebuilding/);
assert.equal(lightingEditStatus({status:'submitted-awaiting-presentation',previewStale:false}),'');
dispose();assert.equal(active.size,0);
console.log('lighting input transaction and status contracts passed');
