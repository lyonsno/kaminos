// Internal file-in/JSON-out admission bridge for Python source captures.
// It validates metadata only; callers authenticate every consumed tensor.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateSLatDecoderFixture} from './slat-decoder-witness-checks.js';
if(process.argv.length!==3)throw Error('one decoder manifest path required');
const bytes=await fs.readFile(process.argv[2]),manifest=JSON.parse(bytes),plan=validateSLatDecoderFixture(manifest);
console.log(JSON.stringify({manifestSha256:createHash('sha256').update(bytes).digest('hex'),plan}));
