// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('  claimLoadedSceneFile(file, sceneFile);'),end=source.indexOf('\n}\n',start);
const legacy={version:8,objects:[{type:'flame-emitter'}],custom:'preserved'};
const effective={version:10,objects:[{type:'flame-emitter',emission:{fuel:1}},{type:'simulation-domain'}]};
let retained;
vm.runInNewContext(source.slice(start,end),{data:legacy,file:{},sceneFile:'old.json',claimLoadedSceneFile(){},activeSceneComposition:null,sceneCameras:null,cameraViews:null,sceneNavigation:null,cameraAuthoring:null,sceneSaveBlockedByFailedRestore:true,objectRecords:legacy.objects,localLiquidFailure:null,setInfo(){},restorePlan:{},buildSceneData:()=>effective,retainStartingScene:value=>retained=value});
assert.equal(retained.version,10);assert.deepEqual(retained.objects,effective.objects);assert.equal(retained.custom,'preserved');
console.log('Loaded owner-normalized baseline retained');
