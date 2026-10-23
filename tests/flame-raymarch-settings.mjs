// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';
import {opticalSteppingConfig,resolveOpticalStepping} from '../volume-optical-native.mjs';

test('Quality exposes the marcher, continuous tolerance and optional GPU telemetry once',()=>{
  const fields=FLAME_PROPERTY_GROUPS.find(group=>group.name==='Quality').fields;
  for(const id of ['volume-raymarch-mode','volume-optical-tolerance','volume-ray-step-telemetry'])
    assert.equal(fields.filter(([field])=>field===id).length,1,id+' has a contextual control');
});
test('marcher settings persist as additive renderer controls, preserving the numerical default',()=>{
  const schema=JSON.parse(fs.readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
  const controls=new Map(schema.rendererControls.map(control=>[control.key,control]));
  assert.deepEqual(controls.get('volume-raymarch-mode')?.allowedValues,['current','numerical','fixed']);
  assert.equal(controls.get('volume-raymarch-mode').additiveDefault,'numerical');
  assert.equal(controls.get('volume-optical-tolerance')?.additiveDefault,0.001);
  assert.equal(controls.get('volume-ray-step-telemetry')?.additiveDefault,false);
});
test('a joined exterior reports and executes the requested numerical integration',()=>{
  const effective=resolveOpticalStepping(opticalSteppingConfig(),{emissive:true,exterior:true});
  assert.equal(effective.mode,'numerical');assert.equal(effective.requested,'numerical');
  assert.equal(effective.reason,null);
  assert.equal(resolveOpticalStepping(opticalSteppingConfig(),{emissive:true,exterior:true,explicit:true}).mode,'numerical');
});
test('editable tolerance rejects values that cannot remain positive finite GPU coefficients',()=>{
  for(const tolerance of [1e-100,1e100])assert.throws(()=>opticalSteppingConfig({tolerance}),/GPU/);
  assert.equal(opticalSteppingConfig({tolerance:0.0025}).tolerance,0.0025);
});
test('parameter validation edits the renderer axis rather than inventing a basin control',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const body=html.slice(html.indexOf('function installAuthoringParameterEditing()'));
  const source=body.slice(body.indexOf('const check=state=>{'),body.indexOf('const id=`@parameter:'));
  let checked;
  const check=vm.runInNewContext(source+';check',{
    control:{id:'volume-optical-tolerance',tagName:'INPUT',type:'number',min:'0',max:''},
    flameSettingsState:()=>({domControls:{},rendererControls:{'volume-optical-tolerance':{value:.001}}}),
    checkFlameSettingsState:state=>{checked=state;opticalSteppingConfig({tolerance:state.rendererControls['volume-optical-tolerance'].value});},
  });
  check({value:.0025});assert.equal(checked.rendererControls['volume-optical-tolerance'].value,.0025);
  assert.deepEqual(Object.keys(checked.domControls),[]);
  assert.throws(()=>check({value:0}),/positive finite/);
});
