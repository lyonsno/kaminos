import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { installSceneControlHistory } from '../scene-control-history.mjs';
import { installRelativeNumberDrag } from '../scene-control-history.mjs';

class Control extends EventTarget {
  constructor(){super();this.style={};}
  fire(type, init = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { configurable: true, value });
    this.dispatchEvent(event);
    return event;
  }
}

function boundedNumber({min,max,step,value}) {
  const f=fixture();globalThis.document=new Control();globalThis.window=new Control();
  const input=f.control;input.type='number';input.min=String(min);input.max=String(max);input.value=String(value);
  f.value.flow=value;input.setPointerCapture=()=>{};input.hasPointerCapture=()=>false;
  input.addEventListener('input',()=>{f.value.flow=Number(input.value);});
  installRelativeNumberDrag({input,step});
  input.fire('pointerdown',{button:0,pointerId:1,clientX:100,clientY:50});
  return{...f,get value(){return f.value;},input,move:x=>input.fire('pointermove',{pointerId:1,clientX:x,clientY:50}),close(){input.fire('pointercancel');delete globalThis.document;delete globalThis.window;}};
}

test('bounded scrub reverses immediately after either limit without repaying excess motion',()=>{
  const f=boundedNumber({min:0,max:1,step:.01,value:.5});
  try{
    f.move(1100);assert.equal(Number(f.input.value),1);f.move(1097);assert.ok(Number(f.input.value)<1,'outward motion at max must not accumulate reversal debt');
    f.move(-1000);assert.equal(Number(f.input.value),0);f.move(-997);assert.ok(Number(f.input.value)>0,'outward motion at min must not accumulate reversal debt');
  }finally{f.close();}
});

test('bounded scrubs traverse the same fraction of their range despite different source steps',()=>{
  for(const [min,max,step] of [[0,1,.001],[-20,80,1],[100,10100,100]]){
    const f=boundedNumber({min,max,step,value:min});
    try{f.move(175);assert.ok(Math.abs((Number(f.input.value)-min)/(max-min)-.25)<1e-10,'75px should traverse a quarter of the bounded range');}
    finally{f.close();}
  }
});

test('fine dragging scales range speed and still makes one reversible history gesture',()=>{
  const f=boundedNumber({min:0,max:1,step:.01,value:.5});
  try{
    f.input.fire('pointermove',{pointerId:1,clientX:175,clientY:50,shiftKey:true});assert.ok(Math.abs(Number(f.input.value)-.525)<1e-10);
    f.move(250);assert.ok(Math.abs(Number(f.input.value)-.775)<1e-10);f.input.fire('pointerup');assert.equal(f.edits.state().undoCount,1);
    f.edits.undo();assert.equal(f.value.flow,.5);assert.equal(f.edits.state().active,null);f.edits.redo();assert.ok(Math.abs(f.value.flow-.775)<1e-10);assert.equal(f.edits.state().undoCount,1);
  }finally{f.close();}
});

function fixture(admit = () => {}, onError = () => {}) {
  let value = { recipe: { enabled: true, outerRadius: 0.8 }, radius: 0.24, flow: 0.8 };
  const control = new Control();
  control.type = 'range';
  const edits = createSceneEdits({ read: () => null, write() {}, admit });
  edits.register('@burner', {
    read: () => structuredClone(value),
    write: next => { value = structuredClone(next); },
    check: next => {
      if (!Number.isFinite(next?.radius) || !Number.isFinite(next?.flow) || !Number.isFinite(next?.recipe?.outerRadius)) {
        throw new Error('burner history values must be finite');
      }
      return structuredClone(next);
    },
  });
  const history = installSceneControlHistory({
    controls: [control], edits, id: '@burner', label: 'Adjust Burner',
    read: () => structuredClone(value), write: next => { value = structuredClone(next); },
    onError,
  });
  return { control, edits, history, get value() { return value; }, set value(next) { value = structuredClone(next); } };
}

test('one continuous control gesture records once and undo/redo restore the whole burner state', () => {
  const f = fixture();
  const before = structuredClone(f.value);
  f.control.fire('pointerdown', { button: 0 });
  f.value.radius = 0.31;
  f.control.fire('input');
  f.value.radius = 0.39;
  f.control.fire('input');
  f.value.flow = 1.2;
  f.control.fire('change');

  assert.equal(f.edits.state().undoCount, 1);
  assert.equal(f.edits.undo(), true);
  assert.deepEqual(f.value, before);
  assert.equal(f.edits.redo(), true);
  assert.deepEqual(f.value, { ...before, radius: 0.39, flow: 1.2 });
});

test('unchanged controls add no entry and cancel restores the pre-gesture value', () => {
  const f = fixture();
  const before = structuredClone(f.value);
  f.control.fire('focusin');
  f.control.fire('change');
  assert.equal(f.edits.state().undoCount, 0);

  f.control.fire('pointerdown', { button: 0 });
  f.value.flow = 2;
  f.control.fire('input');
  f.control.fire('pointercancel');
  assert.deepEqual(f.value, before);
  assert.equal(f.edits.state().undoCount, 0);
});

test('keyboard slider steps each commit cleanly and Escape restores an uncommitted gesture', () => {
  const f = fixture();
  const before = structuredClone(f.value);
  f.control.fire('focusin');
  f.control.fire('keydown', { key: 'ArrowRight' });
  f.value.radius = 0.25;
  f.control.fire('input');
  f.control.fire('keyup', { key: 'ArrowRight' });
  assert.equal(f.edits.state().undoCount, 1);
  assert.equal(f.edits.undo(), true);
  assert.deepEqual(f.value, before);

  f.control.fire('keydown', { key: 'ArrowRight' });
  f.value.radius = 0.4;
  f.control.fire('keydown', { key: 'Escape' });
  assert.deepEqual(f.value, before);
  assert.equal(f.edits.state().undoCount, 0);
});

test('a change rejected by the shared edit gate is rolled back and reported', () => {
  let admitted = true, failure;
  const f = fixture(() => { if (!admitted) throw new Error('authoring action is busy'); }, error => { failure = error; });
  const before = structuredClone(f.value);
  f.control.fire('pointerdown', { button: 0 });
  f.value.radius = 0.5;
  admitted = false;
  f.control.fire('change');
  assert.deepEqual(f.value, before);
  assert.match(failure.message, /busy/);
  assert.equal(f.edits.state().undoCount, 0);
});

test('parameter preview occupies the shared edit session until commit and repeated typing starts a new gesture', () => {
  const f = fixture();
  f.control.fire('pointerdown', {button:0});
  f.value.flow=1.1;
  assert.equal(f.edits.state().active?.id, '@burner');
  assert.throws(()=>f.edits.undo(), /Finish the active/);
  f.control.fire('change');
  f.control.fire('beforeinput');
  f.value.flow=1.7;
  f.control.fire('change');
  assert.equal(f.edits.state().undoCount,2);
  f.edits.undo();assert.equal(f.value.flow,1.1);
});

test('a relative label drag suppresses the label click that would open a second empty edit',async()=>{
 const {installRelativeNumberDrag}=await import('../scene-control-history.mjs');
 const f=fixture(),grip=new Control();grip.style={};grip.setPointerCapture=()=>{};grip.hasPointerCapture=()=>false;
 f.control.setPointerCapture=()=>{};f.control.hasPointerCapture=()=>false;f.control.value='1';globalThis.window=new Control();globalThis.document=new Control();
 try {
  installRelativeNumberDrag({grip,input:f.control,step:1});
  grip.fire('pointerdown',{button:0,pointerId:1,clientX:10});
  f.value.flow=2;grip.fire('pointermove',{clientX:14});grip.fire('pointerup');
  const click=grip.fire('click');
  if(!click.defaultPrevented)f.control.fire('focusin'); // browser label activation
  assert.equal(f.edits.state().active,null);
  assert.equal(f.edits.undo(),true);
 }finally{delete globalThis.window;delete globalThis.document;}
});


test('number body drags from its starting value, while a click enters typing',async()=>{
 const {installRelativeNumberDrag}=await import('../scene-control-history.mjs');
 const f=fixture(),grip=new Control();
 globalThis.window=new Control();globalThis.document=new Control();
 for(const el of [grip,f.control]) {el.style={};el.classList={add(){},remove(){}};el.dataset={};el.setPointerCapture=()=>{};el.hasPointerCapture=()=>false;}
 f.control.value='1';f.control.focus=()=>{document.activeElement=f.control;f.control.fire('focusin');};f.control.select=()=>{f.control.selected=true;};f.control.blur=()=>{document.activeElement=null;f.control.fire('blur');};
 f.control.addEventListener('input',()=>{f.value.flow=Number(f.control.value);});
 try {
  installRelativeNumberDrag({grip,input:f.control,step:.1});
  f.control.fire('pointerdown',{button:0,pointerId:1,clientX:200});
  assert.equal(f.control.value,'1','press position must not change the value');
  f.control.fire('pointermove',{pointerId:1,clientX:210});f.control.fire('pointerup',{pointerId:1});f.control.fire('click');
  assert.equal(f.value.flow,2);assert.equal(f.edits.state().undoCount,1);assert.equal(f.edits.state().active,null);
  f.edits.undo();assert.equal(f.value.flow,.8);
  f.control.fire('pointerdown',{button:0,pointerId:2,clientX:203});f.control.fire('pointerup',{pointerId:2});f.control.fire('click');
  assert.equal(f.control.selected,true);assert.equal(f.control.readOnly,false);assert.equal(document.activeElement,f.control);
 } finally{delete globalThis.window;delete globalThis.document;}
});

test('locked scrub uses movement deltas when screen coordinates stop changing', async () => {
 const {installRelativeNumberDrag}=await import('../scene-control-history.mjs');
 const input=new Control(),doc=new Control();globalThis.document=doc;globalThis.window=new Control();
 input.ownerDocument=doc;input.value='1';input.setPointerCapture=()=>{};input.hasPointerCapture=()=>false;
 input.requestPointerLock=()=>{doc.pointerLockElement=input;doc.fire('pointerlockchange');};
 doc.exitPointerLock=()=>{doc.pointerLockElement=null;doc.fire('pointerlockchange');};
 try {
  installRelativeNumberDrag({input,step:.1});
  input.fire('pointerdown',{button:0,pointerId:1,clientX:100,clientY:50});
  input.fire('pointermove',{pointerId:1,clientX:104,clientY:50});
  doc.fire('mousemove',{clientX:104,clientY:50,movementX:20,movementY:0});
  assert.equal(Number(input.value),3.4);
  doc.fire('mouseup',{button:0});
  assert.equal(doc.pointerLockElement,null);
 }finally{delete globalThis.document;delete globalThis.window;}
});

test('compact numeric presentation retains useful scale without trailing noise',async()=>{
 const module=await import('../scene-control-history.mjs');
 assert.equal(typeof module.formatAuthoringNumber,'function');
 assert.equal(module.formatAuthoringNumber('0.123456789'),'0.123');
 assert.equal(module.formatAuthoringNumber('1234.56789'),'1230');
 assert.equal(module.formatAuthoringNumber('0.0000123456'),'0.0000123');
 assert.equal(module.formatAuthoringNumber('1.0000000000000002'),'1');
});

test('late pointer-lock acquisition is released after the gesture already ended',async()=>{
 const {beginContinuousPointer}=await import('../continuous-pointer.mjs');
 const doc=new Control(),target={ownerDocument:doc};doc.defaultView={};let complete,exits=0;
 target.requestPointerLock=()=>new Promise(resolve=>complete=resolve);
 doc.exitPointerLock=()=>{exits++;doc.pointerLockElement=null;doc.fire('pointerlockchange');};
 const pointer=beginContinuousPointer(target,{x:0,y:0},{move(){assert.fail('ended gesture moved');}});
 pointer.request();pointer.stop();doc.pointerLockElement=target;doc.fire('pointerlockchange');complete();
 await Promise.resolve();assert.equal(exits,1);assert.equal(doc.pointerLockElement,null);
});

test('browser unlock cancels once and a denied lock leaves bounded dragging available',async()=>{
 const {beginContinuousPointer}=await import('../continuous-pointer.mjs');
 const doc=new Control(),target={ownerDocument:doc};doc.defaultView={};let lost=0,unavailable=0;
 target.requestPointerLock=()=>{doc.pointerLockElement=target;doc.fire('pointerlockchange');};doc.exitPointerLock=()=>{doc.pointerLockElement=null;doc.fire('pointerlockchange');};
 const p=beginContinuousPointer(target,{x:0,y:0},{move(){},lost(){lost++;}});p.request();doc.exitPointerLock();p.stop();assert.equal(lost,1);
 target.requestPointerLock=()=>Promise.reject(Error('denied'));
 const denied=beginContinuousPointer(target,{x:0,y:0},{move(){},unavailable(){unavailable++;}});denied.request();await new Promise(resolve=>setImmediate(resolve));assert.equal(denied.locked,false);assert.equal(unavailable,1);denied.stop();
});

test('Escape from typed parameter cancels before blur can commit it',async()=>{
 const {installRelativeNumberDrag}=await import('../scene-control-history.mjs');
 const f=fixture(),doc=new Control();globalThis.document=doc;globalThis.window=new Control();
 f.control.ownerDocument=doc;f.control.value='1';f.control.blur=()=>{doc.activeElement=null;f.control.fire('blur');};
 try {
  installRelativeNumberDrag({input:f.control,step:.1});
  doc.activeElement=f.control;f.control.readOnly=false;f.control.fire('focusin');
  const before=structuredClone(f.value);f.value.flow=2;f.control.value='2';f.control.fire('input');
  doc.fire('keydown',{key:'Escape'});
  assert.deepEqual(f.value,before);assert.equal(f.edits.state().undoCount,0);assert.equal(f.edits.state().active,null);
 }finally{delete globalThis.document;delete globalThis.window;}
});

test('one data control can select per-object targets without merging their histories',()=>{
 const input=new Control();let current='a',active=null,values={a:1,b:2},past=[];
 const edits={state:()=>({active}),begin(id){active={id,before:values[id]};},commit(){past.push({...active,after:values[active.id]});active=null;},cancel(){values[active.id]=active.before;active=null;}};
 installSceneControlHistory({controls:[input],edits,id:()=>current});
 input.fire('focusin');values.a=3;input.fire('change');current='b';input.fire('focusin');values.b=4;input.fire('pointercancel');
 assert.deepEqual(values,{a:3,b:2});assert.deepEqual(past,[{id:'a',before:1,after:3}]);assert.equal(active,null);
});
