// kaminos-test: node
import assert from 'node:assert/strict';
import {packMicroField,decodeMicroField} from '../neural-microstructure-field.mjs';
import {fieldFixture} from './fixtures/microstructure-field.mjs';
import {fieldComputeSource,decodeFieldGpu} from '../tools/microstructure-field-gpu.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
const {meta,arrays}=fieldFixture(),model=packMicroField(meta,arrays);
const positions=[[0,0,0],[1,1,1],[.5,.5,.5],[1,0,0],[.125,.375,.625]];
const points=Float32Array.from(positions.flatMap(p=>[...p,0]));
const verify=values=>positions.forEach((p,i)=>decodeMicroField(model,0,p).forEach((expected,j)=>assert.ok(Math.abs(expected-values[i*9+j])<1e-5,`query${i} channel${j}: ${values[i*9+j]} != ${expected}`)));
await withKaminosGpu(async ctx=>{
  verify(await decodeFieldGpu(ctx,model,points));
  const erased=packMicroField(meta,{...arrays,grid:new Float32Array(8)});
  const faulty=await decodeFieldGpu(ctx,erased,points);assert.throws(()=>verify(faulty),/query1 channel0/,'A valid shader with erased features must fail the decoder oracle');
  await assert.rejects(decodeFieldGpu(ctx,model,new Float32Array([0,0,0,1])),/carrier/);
  console.log('Production field WGSL matches CPU trilinear/MLP decode; erased-feature fault rejected');
},{wgslSources:[{code:fieldComputeSource(model),entryPoint:'main',label:'microstructure-field'}]});
