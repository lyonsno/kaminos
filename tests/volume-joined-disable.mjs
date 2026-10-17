// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('    setJoinedExterior(config = null) {');
const end=source.indexOf('    async probeJoinedExterior()',start);
assert.ok(start>=0&&end>start);
for(const config of [null,{enabled:false}]){
 const events=[];
 const sandbox={events,config,device:{},state:{joinedExterior:{},joinedBoundary:{admitted:true},joinedGhosts:{bound:true,generation:10}},
  joinedExterior:{destroy(){events.push('destroy');}},
  applyJoinedGhostGeometry(g){assert.equal(g,null);sandbox.state.joinedGhosts={bound:false,generation:-1};events.push('clear-ghosts');},
  refreshJoinedBoundary(on){assert.equal(on,false);sandbox.state.joinedBoundary={requested:false,admitted:false};events.push('standalone');},
  syncJoinedRender(){events.push('render');},
 };
 vm.createContext(sandbox);
 vm.runInContext('const api={'+source.slice(start,end)+'}; api.setJoinedExterior(config);',sandbox);
 assert.equal(sandbox.state.joinedBoundary.admitted,false,'removing the shared solver must restore fine projection');
 assert.equal(sandbox.state.joinedGhosts.bound,false,'removed exterior must not leave stale transport ghosts');
 assert.ok(events.indexOf('clear-ghosts')<events.indexOf('render'),'detach textures before rebinding rendering');
}
console.log('joined disable restores standalone projection and transport');
