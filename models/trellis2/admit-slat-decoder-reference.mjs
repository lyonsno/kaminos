// Internal file-in/JSON-out admission bridge for Python source captures.
// It validates metadata only; callers authenticate every consumed tensor.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateSLatDecoderFixture,validateSLatProjectionFixture} from './slat-decoder-witness-checks.js';
if(![3,4].includes(process.argv.length))throw Error('one decoder manifest path and optional projection manifest path required');
const bytes=await fs.readFile(process.argv[2]),manifest=JSON.parse(bytes),plan=validateSLatDecoderFixture(manifest);
const result={manifestSha256:createHash('sha256').update(bytes).digest('hex'),plan};
if(process.argv[3]){
  const projectionBytes=await fs.readFile(process.argv[3]);
  validateSLatProjectionFixture(JSON.parse(projectionBytes),manifest);
  result.projectionSha256=createHash('sha256').update(projectionBytes).digest('hex');
}
console.log(JSON.stringify(result));
