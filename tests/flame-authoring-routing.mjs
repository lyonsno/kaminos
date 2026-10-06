import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name) { const start=source.indexOf(`async function ${name}(`); const end=source.indexOf('\n}\n',start)+2; return source.slice(start,end); }
test('changing a composition basin uses the shared in-place authoring operation without save/navigation',async()=>{
 const calls=[];
 const context=vm.createContext({withAuthoringAction:fn=>fn(),sceneSaveIsBlocked:()=>false,
  collectSceneComposition:async()=>calls.push('save-current'),buildSceneData:()=>({composition:{}}),
  saveToServer:async()=>{calls.push('save-next');return true;},location:{assign:()=>calls.push('navigate'),origin:'http://test'},compositionRestoreUrl:()=>'',currentSceneFile:'kiln',
  window:{kaminosFlameAuthoring:{applyBasin:async id=>{calls.push(['apply',id]);return true;}}}});
 vm.runInContext(extract('changeCompositionBasin'),context);
 await context.changeCompositionBasin({presetId:'basin-a',label:'A'});
 assert.deepEqual(calls,[['apply','basin-a']]);
});
