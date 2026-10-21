// kaminos-test: node
import assert from 'node:assert/strict';
import {createSimulationTransport,mountSimulationTransport} from '../simulation-transport.mjs';
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.value='';}
 append(...nodes){for(const n of nodes){n.remove?.();this.children.push(n);n.parent=this;}}
 remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
 setAttribute(k,v){this.attributes[k]=String(v);}
}
const document={createElement:t=>new Element(t)},root=new Element('div');
let cadence='render_cadence',dt=1/240;
const transport=createSimulationTransport({read:()=>({step:4,dt,paused:true,rate:1,cadence}),cadence:v=>{cadence=v;}});
const ui=mountSimulationTransport({document,root,transport});
try {
 const walk=n=>[n,...n.children.flatMap(walk)];
 const control=walk(root).find(n=>n.attributes['aria-label']==='Playback cadence');
 assert.ok(control,'The composed shared strip must retain the accepted water cadence selector');
 assert.equal(control.value,'render_cadence');
 control.value='wall_time';await control.onchange();
 assert.equal(cadence,'wall_time');assert.equal(dt,1/240,'Cadence changes scheduling, never the physical tick');
 control.value='render_cadence';await control.onchange();assert.equal(cadence,'render_cadence');
 assert.ok(walk(root).some(n=>n.textContent==='ticks / drawn frame'),'Rate meaning must follow effective cadence');
} finally {await ui.dispose();}
console.log('Composed water playback preserves cadence control and effective rate meaning');
