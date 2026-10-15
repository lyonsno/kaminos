// kaminos-test: node
import assert from 'node:assert/strict';
import {assertSavedResult} from '../visual-work.mjs';
const document={objects:[]};
const saved={ok:true,document,filename:'kiln.kaminos.json',url:'http://localhost/#workspace=authoring&authoring=1&scene=kiln.kaminos.json'};
assertSavedResult(saved,document,{workspace:'authoring'});
assert.throws(()=>assertSavedResult({...saved,url:saved.url.replace('workspace=authoring','workspace=experiment')},document,{workspace:'authoring'}),/Save URL differs/);
assert.throws(()=>assertSavedResult({...saved,url:saved.url.replace('kiln.kaminos.json','other.kaminos.json')},document,{workspace:'authoring'}),/Save URL differs/);
assert.throws(()=>assertSavedResult(saved,{objects:[{id:'missing'}]},{workspace:'authoring'}),/Persisted document differs/);
assertSavedResult({...saved,url:'http://localhost/#authoring=1&scene=kiln.kaminos.json'},document);
assert.throws(()=>assertSavedResult(saved,document),/Save URL differs/);
console.log('PASS visual witness verifies explicitly requested workspace and exact saved scene');
