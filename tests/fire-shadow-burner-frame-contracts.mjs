import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const source=process.argv[2]
  ? execFileSync('git',['show',`${process.argv[2]}:index.html`],{encoding:'utf8'})
  : readFileSync(new URL('../index.html',import.meta.url),'utf8');
const body=source.match(/function renderSceneFrame\(\) \{([\s\S]*?)\n  \}/)[1];
const calls=[];let mounted=false;
const render=new Function('performance','updateAnnularBurnerFrame','fireLightFieldPass','renderPipeline','fpsEl',
  `let fpsFrames=0,fpsLast=0; return function(){${body}};`)(
  {now:()=>100},()=>{mounted=true;calls.push('burner');},
  {renderShadows(){assert.equal(mounted,true,'shadow draw must see current burner placement');calls.push('shadows');}},
  {render(){calls.push('visible');}},{});
render();
assert.deepEqual(calls,['burner','shadows','visible']);
console.log('burner placement precedes shadow draw and visible composition');
