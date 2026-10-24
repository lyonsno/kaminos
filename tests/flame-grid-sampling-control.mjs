// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const body=html.slice(html.indexOf('function installAuthoringParameterEditing()'));
const source=body.slice(body.indexOf('const check=state=>{'),body.indexOf('const id=`@parameter:'));
// Exercise the actual authoring parameter admission function. The runtime owns
// numerical admission; this boundary must consult it before dispatching edits.
for(const [id,key,valid,invalid] of [
  ['volume-velocity-staggering','velocityStaggering','staggered','collocated'],
  ['volume-pressure-solver','pressureSolver','converged-open-top','weighted-jacobi'],
]) test(`${id} refuses an inadmissible layout before the edit`,()=>{
  let independent=true;const calls=[];
  const check=vm.runInNewContext(source+';check',{
    control:{id,tagName:'SELECT',options:[{value:valid},{value:invalid}]},
    volumePrototype:{validateGridControls:patch=>{
      calls.push({...patch});if(independent&&patch[key]===invalid)throw Error('Independent fine velocity prerequisite');
    }},
  });
  assert.throws(()=>check({value:invalid}),/Independent fine velocity prerequisite/);
  assert.deepEqual(calls,[{[key]:invalid}]);
  assert.equal(check({value:valid}).value,valid);
  independent=false;
  assert.equal(check({value:invalid}).value,invalid,'supported equal-width layout remains selectable');
});

const previewSource=body.slice(body.indexOf("    if(['volume-velocity-staggering','volume-pressure-solver'].includes(control.id))"),body.indexOf("    if(['volume-immersed-radius','volume-emitter-source-law','volume-optical-tolerance'].includes(control.id))",body.indexOf('controls:[control,')));
for(const focused of [false,true]) test(`rejected DOM choice restores source and focused alias; gesture=${focused}`,()=>{
  const listeners=new Map();let value='collocated',alias='collocated',active=focused?{id:'@flame-settings'}:null;
  let cancelled=0,stopped=0,warning='',labelUpdates=0;
  vm.runInNewContext(previewSource,{
    control:{id:'volume-velocity-staggering',addEventListener:(type,fn,capture)=>{assert.equal(capture,true);listeners.set(type,fn);}},
    check:()=>{if(value==='collocated')throw Error('Independent fine velocity requires staggered face forces');},read:()=>({value}),
    volumePrototype:{debugState:()=>({controls:{velocityStaggering:'staggered'}})},
    setVolumeControlValue:(id,next)=>{assert.equal(id,'volume-velocity-staggering');value=next;},
    edits:{state:()=>({active}),cancel:()=>{cancelled++;active=null;}},
    updateVolumeControlLabels:()=>labelUpdates++,flameInspector:{sync:force=>{assert.equal(force,true);alias=value;}},
    showFlameEditRefused:error=>warning=error.message,
  });
  assert.deepEqual([...listeners.keys()],['input','change']);
  listeners.get('change')({stopImmediatePropagation:()=>stopped++});
  assert.equal(stopped,1,'invalid request cannot reach the live mutation handler');
  assert.equal(value,'staggered');assert.equal(alias,'staggered');assert.equal(cancelled,focused?1:0);
  assert.match(warning,/requires staggered face forces/);assert.equal(labelUpdates,1);
  listeners.get('change')({stopImmediatePropagation:()=>stopped++});
  assert.equal(stopped,1,'valid selection still reaches live mutation');
});
