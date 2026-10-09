import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),source=text.slice(text.indexOf('function draw()'),text.indexOf('\ntry{',text.indexOf('function draw()')));
let rendered=0,advanced=0;
vm.runInNewContext(source+';draw()',{requestAnimationFrame(){},controls:{update(){}},renderer:{render(){rendered++;}},scene:{},camera:{},cameraState:()=>({position:[1,2,3]}),frames:0,paused:false,resident:{},busy:true,pendingPick:false,finishing:false,failure:null,advance(){advanced++;return Promise.resolve();}});
assert.equal(rendered,1,'GPU material work must not suspend operator camera rendering');
assert.equal(advanced,0,'Rendering must not submit a concurrent material step');
console.log('Actual draw loop preserves camera rendering while one material step is busy.');
