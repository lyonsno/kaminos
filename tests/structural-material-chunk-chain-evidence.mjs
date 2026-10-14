// kaminos-test: node
import assert from 'node:assert/strict';
import {requireChunkStage} from '../tools/stone-chunk-chain-evidence.mjs';
const status={backend:'webgpu',adapterFallback:false,fixture:{route:'kaminos.stone.axial-chunk-fixture.v1'},motion:{route:'kaminos.stone.detached-translation.webgpu.v1'},runId:'run',submittedSteps:4,model:{points:4,elements:1,bonds:1}};
const state={observation:{kind:'full-diagnostic'},runId:'run',steps:4,model:{...status.model},state:Array(64).fill(0),bonds:[0,1,1,0]};
const motion={route:status.motion.route,runId:'run',steps:4,motion:'translation-only',ownership:Array(16).fill(0)};
const good={status,state,motion};requireChunkStage(good);
for(const change of [x=>x.status.adapterFallback=true,x=>x.status.fixture=null,x=>x.state.steps=3,x=>x.state.bonds=[],x=>x.state.state[0]=NaN,x=>x.motion.steps=3,x=>x.motion.ownership=[],x=>x.motion.ownership[3]=1,x=>x.state.bonds[1]=99]){const x=structuredClone(good);change(x);assert.throws(()=>requireChunkStage(x));}
const unowned=structuredClone(good);unowned.state.state[15]=2;assert.throws(()=>requireChunkStage(unowned),/ownership/,'A complete zero-owner array cannot launder material marked as coherently owned');
requireChunkStage({...good,extra:'additive metadata'});
console.log('Chunk stages reject stale, partial, fallback and conflicting ownership evidence');
