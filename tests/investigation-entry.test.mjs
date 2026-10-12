import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const file=new URL('../investigation-entry.mjs',import.meta.url);
const entry=fs.existsSync(file)?await import(file):{};
class Element {
  children=[];hidden=false;disabled=false;value='';
  constructor(tag){this.tagName=tag;this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(key,value){this.attributes[key]=value;}
}
const document={createElement:tag=>new Element(tag)};
const saved={id:'water-edge',title:'Inspect the water edge',guide:{question:'Why beads?',tryThis:'Orbit',whyThisMatters:'View dependence'},note:'Keep this thought',captures:[{id:'capture1',url:'/capture/1',note:'Edge looks round'}]};
function create(actions={}){
  assert.equal(typeof entry.createInvestigationEntry,'function','Kaminos lacks a link-addressed investigation entry component');
  return entry.createInvestigationEntry({document,investigation:structuredClone(saved),url:'http://localhost/index.html?investigation=water-edge',actions});
}
test('first open shows the investigation and retained note without starting new water',()=>{
  let starts=0;const ui=create({start:()=>starts++});
  assert.equal(starts,0);assert.equal(ui.nodes.link.href,'http://localhost/index.html?investigation=water-edge');
  assert.equal(ui.nodes.note.value,'Keep this thought');assert.equal(ui.nodes.history.children.length,1);
  assert.equal(ui.nodes.capture.disabled,true);assert.equal(ui.nodes.start.disabled,false);
});
test('live attempt return is offered without silently starting a replacement',async()=>{
  let starts=0,returns=0;const ui=create({start:()=>starts++,returnToLive:async()=>{returns++;}});
  ui.setAttempt({id:'existing',state:'live',owned:false});
  assert.equal(ui.nodes.capture.disabled,true);assert.equal(ui.nodes.returnToLive.hidden,false);
  await ui.nodes.returnToLive.onclick();assert.equal(returns,1);assert.equal(starts,0);
  assert.equal(ui.nodes.start.disabled,true,'existing water must not be replaced by the ordinary entry action');
  ui.setAttempt({id:'existing',state:'lost',owned:false});
  assert.match(ui.nodes.status.textContent,/ended|unavailable|lost/i);
  assert.equal(ui.nodes.start.disabled,false);assert.equal(ui.nodes.capture.disabled,true);
});
test('capture retains the entered note; a failed save preserves it and enables retry',async()=>{
  const notes=[];let fail=true;const ui=create({capture:async note=>{notes.push(note);if(fail)throw Error('disk unavailable');return {message:'Capture retained'};}});
  ui.setAttempt({id:'own',state:'live',owned:true});ui.nodes.note.value='New detour';
  await ui.nodes.capture.onclick();assert.equal(ui.nodes.note.value,'New detour');assert.match(ui.nodes.status.textContent,/disk unavailable/);
  assert.equal(ui.nodes.capture.disabled,false);fail=false;await ui.nodes.capture.onclick();
  assert.deepEqual(notes,['New detour','New detour']);
});
test('only a fulfilled finish disables recording controls; failed finish remains recoverable',async()=>{
  let fail=true;const ui=create({finish:async()=>{if(fail)throw Error('save rejected');return {message:'Saved'};}});
  ui.setAttempt({id:'own',state:'live',owned:true});await ui.nodes.finish.onclick();
  assert.equal(ui.nodes.finish.disabled,false);fail=false;await ui.nodes.finish.onclick();assert.equal(ui.nodes.finish.disabled,true);assert.equal(ui.nodes.capture.disabled,true);
});
