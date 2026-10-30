import assert from 'node:assert/strict';
import {validateCast} from './receipt.mjs';
const request={sourceSha256:'source',preparedSha256:'pixels',seed:42};
const good={sourceSha256:'source',preparedSha256:'pixels',seed:42,pipelineType:'512',samplingSteps:8,meshResolution:512,decoderActivationStorage:'f16',route:'trellis2.image-generation.webgpu.v0',appHost:true,receiptValidation:{ok:true,checks:['route-released','glb-magic']},postprocess:{requestedMode:'mlx-surface-preserving',effectiveRoute:'Trellis2MLX/surface-preserving/browser-port-of-fast-simplify-first'},raw:{vertices:100,triangles:150},output:{bytes:1024,glbMagic:0x46546c67},noiseSeeds:[42,42,42]};
for(const [label,patch] of Object.entries({wrongSource:{sourceSha256:'shoe'},stalePixels:{preparedSha256:'shoe'},seedDefault:{seed:43},fallback:{appHost:false},partial:{receiptValidation:{ok:false}},blank:{raw:{vertices:0,triangles:0}},wrongSkin:{postprocess:{requestedMode:'remesh'}},missingNoise:{noiseSeeds:[]},wrongNoise:{noiseSeeds:[1]}}))assert.throws(()=>validateCast({...good,...patch},request),undefined,label);
validateCast(good,request);
console.log('cast receipt rejects substituted source, stale pixels, wrong seed/host, partial/blank mesh and finishing changes');
