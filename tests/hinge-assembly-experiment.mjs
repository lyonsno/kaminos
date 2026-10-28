// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {Group} from '../lib/three.core.js';
import definition from '../experiments/hinge-assembly.experiment.mjs';
import {installRelativeNumberDrag} from '../scene-control-history.mjs';

class Target extends EventTarget {
  registrations=new Map();
  addEventListener(type,fn,options){if(!this.registrations.has(type))this.registrations.set(type,new Set());this.registrations.get(type).add(fn);super.addEventListener(type,fn,options);}
  removeEventListener(type,fn,options){this.registrations.get(type)?.delete(fn);super.removeEventListener(type,fn,options);}
  count(){return [...this.registrations.values()].reduce((n,s)=>n+s.size,0);}
}
class Element extends Target {
  constructor(tag,doc){super();this.tagName=tag;this.ownerDocument=doc;this.children=[];this.style={};this.classList={add(){},remove(){}};this.captures=new Set();this.value='';}
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
  setAttribute(k,v){this[k]=String(v);}
  setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}releasePointerCapture(id){this.captures.delete(id);}
  focus(){this.ownerDocument.activeElement=this;this.dispatchEvent(new Event('focus'));}
  blur(){this.ownerDocument.activeElement=null;this.dispatchEvent(new Event('blur'));}
  select(){}
}
async function fixture(){
  const doc=new Target(),win=new Target();doc.defaultView=win;doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');
  const roles=['fixed-fork','rotating-hub','axle-pin'],rows=roles.map((role,i)=>({role,url:'asset:'+role,home:[[-3.4,0,3.2][i],1.25,0],exploded:[[-3.4,0,3.2][i],0,0],sha256:'fixture'}));
  const manifest={schema:'kaminos.known-hinge-assembly.v1',joint:{origin:[0,1.25,0],axis:[1,0,0]},source:rows,variants:{supplied:rows}};
  const oldFetch=globalThis.fetch,oldWindow=globalThis.window;
  globalThis.fetch=async()=>({ok:true,json:async()=>manifest});
  let selected=null,callback=null,disposals=0,id=0;const fresh=[],loaded=[];
  globalThis.window={kaminosSelection:{read:()=>({activeId:selected,memberIds:selected?[selected]:[]})}};
  const session={loadAsset:async()=>{const asset={id:'p'+id++,root:new Group()};loaded.push(asset);return asset;},setView(){},readView:()=>({}),redraw(){},onFrame:fn=>{callback=fn;return()=>{callback=null;};},dispose:async()=>{disposals++;}};
  const host={controls:{document:doc,installNumberDrag:installRelativeNumberDrag},scene:{open:async()=>session,refreshPresentation:asset=>{fresh.push({id:asset.id,position:asset.root.position.toArray(),quaternion:asset.root.quaternion.toArray()});}}};
  try{
    const instance=await definition.create({host,inputs:{manifest:'fixture'},record(){}});
    return {doc,win,instance,loaded,fresh,select:id=>{selected=id;},tick:seconds=>callback?.({deltaSeconds:seconds}),get disposals(){return disposals;},restore(){globalThis.fetch=oldFetch;globalThis.window=oldWindow;}};
  }catch(error){globalThis.fetch=oldFetch;globalThis.window=oldWindow;throw error;}
}
test('selected native presentation follows angle, separation, playback and pause',async()=>{
  const f=await fixture();
  try{
    const hub=f.instance.read().parts.find(p=>p.kind==='generated'&&p.role==='rotating-hub');f.select(hub.id);f.fresh.length=0;
    f.instance.operations.angle({degrees:60});
    assert.deepEqual(f.fresh.at(-1).quaternion,f.loaded.find(p=>p.id===hub.id).root.quaternion.toArray(),'native inspector must receive the new angle');
    const pin=f.instance.read().parts.find(p=>p.kind==='generated'&&p.role==='axle-pin');f.select(pin.id);f.fresh.length=0;
    f.instance.operations.separate({amount:.28});
    assert.equal(f.fresh.at(-1)?.id,pin.id,'manual pose application refreshes current selection');
    assert.deepEqual(f.fresh.at(-1).position,f.loaded.find(p=>p.id===pin.id).root.position.toArray(),'selected pin presentation receives its separated position');
    f.select(hub.id);f.fresh.length=0;f.instance.operations.play();f.tick(.2);
    assert.equal(f.fresh.at(-1)?.id,hub.id);assert.ok(f.fresh.every(p=>p.id===hub.id),'unselected objects need no native refresh on a playback tick');
    assert.deepEqual(f.fresh.at(-1).quaternion,f.loaded.find(p=>p.id===hub.id).root.quaternion.toArray());f.instance.operations.pause();
  }finally{await f.instance.dispose();f.restore();}
});
test('closing and reopening releases number-control global listeners and an active scrub',async()=>{
  for(let cycle=0;cycle<2;cycle++){
    const f=await fixture();try{
      const panel=f.doc.createElement('div');f.instance.mount({root:panel,document:f.doc,invoke:(name,args)=>Promise.resolve(f.instance.operations[name](args))});
      assert.equal(f.doc.count(),8);assert.equal(f.win.count(),4);
      const findInput=node=>node.tagName==='input'?node:node.children.map(findInput).find(Boolean),input=findInput(panel);
      let cancelled=0;input.addEventListener('pointercancel',()=>cancelled++);
      const down=new Event('pointerdown',{cancelable:true});for(const [key,value]of Object.entries({button:0,pointerId:9,clientX:100,clientY:50}))Object.defineProperty(down,key,{value});input.dispatchEvent(down);
      assert.equal(input.hasPointerCapture(9),true);await f.instance.dispose();
      assert.equal(f.doc.count(),0,'document listeners must return to baseline');assert.equal(f.win.count(),0,'window listeners must return to baseline');
      assert.equal(input.hasPointerCapture(9),false);assert.equal(cancelled,1);assert.equal(f.disposals,1);
    }finally{f.restore();}
  }
});
