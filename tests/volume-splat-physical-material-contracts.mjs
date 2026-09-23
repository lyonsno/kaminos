#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const producerStart = core.indexOf('function encodeLiveCompleteFlameOpticalCoefficients(encoder) {');
const producerEnd = core.indexOf('async function sampleLiveCompleteFlameOpticalCoefficientStats', producerStart);
assert.ok(producerStart >= 0 && producerEnd > producerStart, 'live coefficient producer boundary exists');
const producer = core.slice(producerStart, producerEnd);
const opticalShaderStart = core.indexOf('const BOUNDARY_SPLAT_OPTICAL_PRESENTATION_WGSL = `');
const opticalShaderEnd = core.indexOf('\n`;\n', opticalShaderStart);
assert.ok(opticalShaderStart >= 0 && opticalShaderEnd > opticalShaderStart, 'optical presentation shader boundary exists');
const opticalShader = core.slice(opticalShaderStart, opticalShaderEnd);

assert.match(
  producer,
  /const physicalMaterialEffective = physicalColorMode === 2[\s\S]*if \(physicalMaterialEffective\) coefficientUniforms\[368\] = 2;/,
  'the isolated coefficient pass must opt into the requested physical material without changing visible raymarch uniforms',
);
assert.match(
  producer,
  /coefficientMaterialEffective:\s*physicalMaterialEffective[\s\S]*transported-heat-soot-v1/,
  'the producer receipt must say which physical material law its coefficients actually use',
);
assert.match(
  opticalShader,
  /emissive_white_r[\s\S]*physical_display[\s\S]*emissiveExposed[\s\S]*emissiveLinear/,
  'physical splat output must apply the authored fixed white balance, exposure, and knee after optical resolve',
);
assert.match(
  opticalShader,
  /var current = pow\([\s\S]*if \(presentationControls\.physical_display\.x > 1\.5\)/,
  'the optical resolve must retain its current legacy transform when no physical material is requested',
);

console.log('splat physical-material source and display contracts passed');
