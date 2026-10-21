// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountLightingDebugView} from '../scene-light-debug-view.mjs';

test('retired captured inspections are not displayed as a new lighting session',()=>{
  class Element extends EventTarget {
    constructor(){super();this.children=[];this.textContent='';this.hidden=false;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
  }
  const elements=new Map(),document=new Element();
  document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  document.createElement=()=>new Element();
  const before=Object.fromEntries(['window','addEventListener','removeEventListener'].map(key=>[key,globalThis[key]]));
  globalThis.window={};globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
  try{
    const mount=()=>mountLightingDebugView({document});
    const first=mount(),record={status:'captured',metadata:{generation:1,directions:24,angularPattern:'fixed',receiverSampling:{spacing:1}},
      inputs:{rows:[{id:1,front:[1,1,1],back:[0,0,0]}]},replay:{status:'unavailable',reason:'lifecycle fixture',rows:[]}};
    first.session.records.push(record);first.renderRecord(record);
    const select=document.getElementById('rendering-light-debug-sample');assert.equal(typeof select.onchange,'function');
    first.dispose();first.dispose();
    assert.equal(select.onchange,null,'retired record selection must not retain authority over the next panel');
    assert.equal(select.children.length,0);assert.equal(document.getElementById('rendering-light-debug-rays').children.length,0);
    const next=mount();assert.equal(next.session.records.length,0);
    assert.equal(select.children.length,0);assert.match(document.getElementById('rendering-light-debug-status').textContent,/No inspection/);
    assert.equal(next.session.retiredSessions.length,1,'unexported evidence is retained once, separately from current records');
    assert.equal(next.session.retiredSessions[0].records[0],record);
    assert.doesNotThrow(()=>JSON.stringify(next.session),'retired session retention must remain exportable');
    first.renderRecord(record);assert.equal(select.children.length,0,'a delayed old capture cannot repopulate the current display');
    next.dispose();
  }finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
