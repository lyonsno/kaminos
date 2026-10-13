// The JS T5 tokenizer must produce the token ids of the T5Tokenizer that
// UniMate's T5Conditioner uses, on a corpus of prompts and joint names.
// Inputs (outside the repository, from pack-t5.py --reference): T5_DIR holding
// t5-tokenizer.json and t5-reference.json. Without it the test reports SKIPPED, exit 3.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createT5Tokenizer } from '../unimate-t5-tokenizer.js';

const dir = process.env.T5_DIR;
if (!dir || !fs.existsSync(path.join(dir, 't5-reference.json'))) {
  console.log(`t5 tokenizer contracts: SKIPPED (T5_DIR=${dir ?? ''} lacks t5-reference.json)`);
  process.exit(3);
}
const tok = createT5Tokenizer(JSON.parse(fs.readFileSync(path.join(dir, 't5-tokenizer.json'), 'utf8')));
const ref = JSON.parse(fs.readFileSync(path.join(dir, 't5-reference.json'), 'utf8'));
for (const c of ref.cases) {
  assert.deepEqual(tok.encode(c.text), c.ids, `token ids for ${JSON.stringify(c.text)}`);
}
console.log(`t5 tokenizer contracts: pass (${ref.cases.length} cases)`);
