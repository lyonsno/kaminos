// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const reader=html.slice(html.indexOf('function readVolumeControls('));
const fields=reader.slice(reader.indexOf('    raySteps:'),reader.indexOf('    detailScale:'));
test('live occupancy threshold enters the actual cockpit control snapshot',()=>{
 const inputs={'volume-steps':{value:'24'},'volume-occupancy-skip':{value:'.7'},'volume-occupancy-threshold':{value:'.125'}};
 const document={getElementById:id=>{assert.ok(inputs[id],id);return inputs[id];}};
 const read=()=>vm.runInNewContext('({'+fields+'})',{document});
 assert.equal(read().occupancySkip,.7);assert.equal(read().occupancyThreshold,.125,'occupancy threshold knob is disconnected');
 inputs['volume-occupancy-threshold'].value='.25';assert.equal(read().occupancyThreshold,.25);
 assert.equal(read().fireScale,1,'main fixed fire scale is retained');
});
