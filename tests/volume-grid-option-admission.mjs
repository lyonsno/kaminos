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
