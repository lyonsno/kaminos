// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../local-liquid-host.mjs',import.meta.url),'utf8');
const acquire=source.slice(source.indexOf('  const releaseOutputTransform='),source.indexOf('  const environmentRotation='));
const release=source.slice(source.indexOf('      releaseOutputTransform();'),source.indexOf('\n    }};',source.indexOf('      releaseOutputTransform();')));
const ctx=vm.createContext({pipeline:{outputColorTransform:true}});
vm.runInContext(source.slice(source.indexOf('const pipelineOutputTransforms='),source.indexOf('function supportMesh()')),ctx);
const make=vm.runInContext('(function(){'+acquire+';return ()=>{'+release+'};})',ctx);
const a=make(),b=make();a();ctx.pipeline.outputColorTransform=false;b();
assert.equal(ctx.pipeline.outputColorTransform,true,'Replay then Reset restores ordinary scene display transform');
const c=make(),failed=make();failed();assert.equal(ctx.pipeline.outputColorTransform,false,'Failed replacement leaves admitted host in linear mode');c();assert.equal(ctx.pipeline.outputColorTransform,true);
console.log('Continuous replacement, failed candidate and Reset retain ordinary output transform');

ctx.pipeline.outputColorTransform=false;const d=make();d();d();assert.equal(ctx.pipeline.outputColorTransform,false,'An initially linear pipeline and repeated disposal retain its actual original mode');
