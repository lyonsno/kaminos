// kaminos-test: manual — Apple GPU conformance; execute through Greenroom.
import assert from 'node:assert/strict';
import {createGpuTestContext,evalWgslBatch} from '@kaminos/shader-herder';
import {NATIVE_OPTICAL_CAPTURE_WGSL} from '../volume-optical-trace.mjs';
const context=await createGpuTestContext();
try {
  const result=await evalWgslBatch(context,{argTypes:['u32','f32'],returnType:'u32',
    preamble:NATIVE_OPTICAL_CAPTURE_WGSL,
    body:'return select(0u,1u,opticalCaptureKeepsMaterial(arg0,arg1));',
    inputs:[[5,0],[5,.00001],[5,.01],[6,0],[7,0]]});
  assert.deepEqual(result,[0,0,1,1,1],
    'raw native capture retains zero-support material; legacy trace keeps its predicate');
  console.log('production native capture predicate executed on Apple hardware');
} finally {context.destroy();}
