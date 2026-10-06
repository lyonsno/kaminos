import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {defaultKilnCues} from '../kiln-cinematic-cues.mjs';
import {createCueTuneEditor} from '../kiln-cue-editor.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../authoring-workspace.mjs',import.meta.url),'utf8');
const observed=JSON.parse(readFileSync(new URL('./fixtures/kiln-cue-flame-r8.json',import.meta.url),'utf8'));
const baseline=observed.tune;

test('leaving Authoring cancels the actual cue draft before hiding its context',()=>{
  let tune=structuredClone(baseline);
  const editor=createCueTuneEditor({readCues:defaultKilnCues,writeCues(){},readTune:()=>tune,
    applyTune:value=>{tune=value;},validateTune:value=>value,loadTune:async()=>baseline});
  editor.begin('work',1);editor.set('volume-physical-exposure',-3);
  const code=workspace.slice(workspace.indexOf('  function setMode(next)'),workspace.indexOf("  header.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener",workspace.indexOf('  function setMode(next)')));
  const switcher=new Function('contexts','document','slots','header',`
    let mode='authoring',currentContext='cues';const beforeSwitch=()=>true;
    ${code};return setMode;
  `)(new Map([['cues',{leave:()=>editor.cancel()}]]),{activeElement:{blur(){}},body:{dataset:{}}},
    {showAuthoring(){},showWorkbench(){}},{querySelectorAll:()=>[]});
  assert.equal(switcher('workbench'),true);assert.equal(editor.active(),false,'hidden workspace must not retain a draft');
  assert.deepEqual(tune,baseline);
});

test('actual flame validation admits legacy cue flow3 and4 without loosening other ranges',()=>{
  const start=html.indexOf('function checkFlameSettingsState('),end=html.indexOf('function writeFlameSettingsState(',start);
  const code=html.slice(start,end);
  const flowTag=html.match(/<input\b[^>]*id="volume-flow-rate"[^>]*>/)[0];
  const bounds={min:flowTag.match(/min="([^"]+)"/)[1],max:flowTag.match(/max="([^"]+)"/)[1]};
  const all={...baseline.domControls,...baseline.rendererControls};
  const check=new Function('flameSettingsState','document','KILN_FLOW_RANGE',`${code};return checkFlameSettingsState;`)(()=>baseline,{
    getElementById:id=>({tagName:all[id]?.tagName||'INPUT',type:all[id]?.type||'range',
      options:[{value:all[id]?.value}],min:id==='volume-flow-rate'?bounds.min:'',max:id==='volume-flow-rate'?bounds.max:''}),
  },{min:0,max:4});
  for(const flow of [3,4]) {
    const state=structuredClone(baseline);state.domControls['volume-flow-rate'].value=flow;
    assert.doesNotThrow(()=>check(state,{cue:true}),`legacy flow${flow} must remain editable`);
  }
  const invalid=structuredClone(baseline);invalid.domControls['volume-flow-rate'].value=4.01;
  assert.throws(()=>check(invalid,{cue:true}),/Out of range/);
});
