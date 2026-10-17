// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveGridHeight, raymarchDomainBox} from '../volume-grid-shape.mjs';
import {gridShapeAdmission} from '../volume-core.js';
import {syncVolumeGridOptions} from '../volume-grid-options.mjs';

function preview(device) {
  const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
  const start=source.indexOf('    previewGridShape(request = {}) {');
  const end=source.indexOf('    debugState()',start);
  const method=source.slice(start,end).trim().replace(/^previewGridShape/,'function').replace(/,$/,'');
  const controlsSnapshot={resolution:32,gridHeightRatio:2},gridSize=32,gridHeight=64;
  const normalizeGridSize=x=>Number(x);
  return eval('('+method+')');
}
test('grid preview distinguishes unchecked startup from actual GPU limit admission',()=>{
  assert.equal(preview(null)({resolution:160}).limitsChecked,false);
  const checked=preview({limits:{maxStorageBufferBindingSize:134217728,maxBufferSize:268435456,maxTextureDimension3D:2048}});
  assert.equal(checked({resolution:32}).limitsChecked,true);
  assert.equal(checked({resolution:32}).admitted,true);
  assert.equal(checked({resolution:160}).admitted,false);
  assert.match(checked({resolution:160}).admissionReason,/storage-binding/);
});
test('over-limit options stay selectable and recover when another dimension changes',()=>{
  const select={options:[32,160].map(value=>({value:String(value),style:{},dataset:{},disabled:true}))};
  const checked=preview({limits:{maxStorageBufferBindingSize:268435456,maxBufferSize:268435456,maxTextureDimension3D:2048}});
  syncVolumeGridOptions(select,checked,2);
  const large=select.options[1];
  assert.equal(large.dataset.gridAdmission,'refused');
  assert.equal(large.disabled,false);
  assert.equal(large.style.color,'#777');
  assert.match(large.title,/storage-binding/);
  syncVolumeGridOptions(select,checked,1);
  assert.equal(large.dataset.gridAdmission,'within-limits');
  assert.equal(large.style.color,'');
  assert.equal(large.textContent,'160');
  syncVolumeGridOptions(select,preview(null),2);
  assert.equal(large.dataset.gridAdmission,'unchecked');
  assert.equal(large.disabled,false);
});
test('authored inspector receives later admission changes without losing its active selection',()=>{
  const text=readFileSync(new URL('../flame-authoring.mjs',import.meta.url),'utf8');
  const start=text.indexOf('      function syncField(force=false) {');
  const end=text.indexOf("      if(id==='emitter-assay-family')field.title",start);
  const source={value:'32',options:[32,160].map(value=>({value:String(value),style:{},dataset:{}}))};
  const field={value:'160',options:source.options.map(o=>({...o,style:{},dataset:{}}))};
  const id='volume-resolution',document={activeElement:field};
  const readControlBounds=()=>null,flameControlDisplayValue=(_id,value)=>value;
  const syncField=eval('('+text.slice(start,end).trim()+')');
  syncVolumeGridOptions(source,preview(null),2);syncField();
  assert.equal(field.options[1].dataset.gridAdmission,'unchecked');
  const checked=preview({limits:{maxStorageBufferBindingSize:268435456,maxBufferSize:268435456,maxTextureDimension3D:2048}});
  syncVolumeGridOptions(source,checked,2);syncField();
  assert.equal(field.value,'160');
  assert.equal(field.options[1].dataset.gridAdmission,'refused');
  assert.equal(field.options[1].style.color,'#777');
  assert.equal(field.options[1].disabled,false);
  assert.match(field.options[1].textContent,/exceeds GPU limits/);
  assert.match(field.options[1].title,/storage-binding/);
  syncVolumeGridOptions(source,checked,1);syncField();
  assert.equal(field.options[1].dataset.gridAdmission,'within-limits');
  assert.equal(field.options[1].style.color,'');
  assert.equal(field.options[1].textContent,'160');
  syncField(true);assert.equal(field.value,'32');
});

function observedOption(value) {
  let textContent='',title='';const mutations=[];
  const dataset=new Proxy({}, {set(target,key,value){mutations.push(['attribute',key,value]);target[key]=value;return true;},deleteProperty(target,key){mutations.push(['delete',key]);delete target[key];return true;}});
  return {value:String(value),style:{},dataset,disabled:false,mutations,
    get textContent(){return textContent;},set textContent(value){mutations.push(['children',value]);textContent=value;},
    get title(){return title;},set title(value){mutations.push(['attribute','title',value]);title=value;}};
}
test('idle grid admission refresh leaves native option text and attributes untouched',()=>{
  const select={options:[32,160].map(observedOption)};
  const checked=preview({limits:{maxStorageBufferBindingSize:268435456,maxBufferSize:268435456,maxTextureDimension3D:2048}});
  syncVolumeGridOptions(select,checked,2);
  for(const option of select.options)option.mutations.length=0;
  syncVolumeGridOptions(select,checked,2);
  assert.deepEqual(select.options.flatMap(option=>option.mutations),[], 'an unchanged native menu must not have its option contents or attributes rewritten');
});
test('idle inspector refresh leaves the focused grid menu intact while preserving the proposed choice',()=>{
  const text=readFileSync(new URL('../flame-authoring.mjs',import.meta.url),'utf8');
  const start=text.indexOf('      function syncField(force=false) {');
  const end=text.indexOf("      if(id==='emitter-assay-family')field.title",start);
  const source={value:'32',options:[32,160].map(observedOption)};
  const field={value:'160',options:[32,160].map(observedOption)};
  const id='volume-resolution',document={activeElement:field};
  const readControlBounds=()=>null,flameControlDisplayValue=(_id,value)=>value;
  const syncField=eval('('+text.slice(start,end).trim()+')');
  syncVolumeGridOptions(source,preview(null),2);syncField();
  for(const option of field.options)option.mutations.length=0;
  syncField();
  assert.deepEqual(field.options.flatMap(option=>option.mutations),[], 'periodic inspector updates must not rewrite an unchanged open native menu');
  assert.equal(field.value,'160');assert.equal(source.value,'32');
});
