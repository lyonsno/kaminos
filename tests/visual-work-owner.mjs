// kaminos-test: node
import assert from 'node:assert/strict';
import {assertSavedResult} from '../visual-work.mjs';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
const document={objects:[],camera:{position:[0,1,2]}},owner={id:'fire-shadow-sampling',inputsText:JSON.stringify({sampling:'complementary'})};
const result={ok:true,filename:'kiln.kaminos.json',document,url:compositionRestoreUrl(null,'kiln.kaminos.json','http://localhost','workbench',owner)};
assertSavedResult(result,document,{workspace:'workbench',owner});
assert.throws(()=>assertSavedResult(result,document,{workspace:'workbench',owner:{...owner,id:'other'}}),/Save URL/);
assert.throws(()=>assertSavedResult({...result,url:compositionRestoreUrl(null,result.filename,'http://localhost','workbench')},document,{workspace:'workbench',owner}),/Save URL/);
console.log('PASS retained visual scene preserves exact owner experiment identity and setup');
