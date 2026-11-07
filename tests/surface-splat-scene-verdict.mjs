// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSurfaceSceneResult} from '../tools/surface-splat-scene-verdict.mjs';
const good=()=>({backend:'webgpu',gi:{mode:'combined',frames:3,sourcePasses:1,receivingPasses:1},bright:[1,0,0,1],dark:[0,0,0,1],normal:[0,0,1,1],receipt:{backend:'gpu',triangleCount:12},gpu:Array(4096).fill(1),cpu:Array(4096).fill(1),reference:Array(12).fill([[0,0,0],[1,0,0],[0,1,0]]),ashTriangles:Array(12).fill([[0,0,0],[1,0,0],[0,1,0]]),independent:true,flame:{identity:"hybrid-distributed-smoke-point-surfaces-v0",evaluatedPointCount:1,capturedPointCount:1,cached:{mounted:true},on:[1,0,0,1],off:[0,0,0,1]},errors:[]});
test('native scene verdict rejects fallback, partial, blank and dishonest equal inputs',()=>{
 assert.doesNotThrow(()=>assertSurfaceSceneResult(good()));
 for(const mutate of [r=>r.backend='fallback',r=>r.gpu=[],r=>{r.gpu=[1];r.cpu=[1];},r=>{r.gpu.fill(0);r.cpu.fill(0);},r=>r.gpu[0]=0,r=>r.receipt.triangleCount=14,r=>r.ashTriangles=[],r=>r.gi.frames=0,r=>r.gi.mode='gtao',r=>r.errors.push('GPU error')]){const r=good();mutate(r);assert.throws(()=>assertSurfaceSceneResult(r));}
 assert.throws(()=>assertSurfaceSceneResult(good(),{materialFixture:true}));
});
