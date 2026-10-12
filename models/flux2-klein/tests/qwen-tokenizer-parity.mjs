// Browser Qwen tokenizer vs the pinned Hugging Face tokenizer on recorded fixtures.
// Usage: node tests/qwen-tokenizer-parity.mjs <tokenizer.json> [fixtures.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QwenTokenizer } from '../qwen-tokenizer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tokPath = process.argv[2];
const fixPath = process.argv[3] ?? path.join(here, 'fixtures', 'qwen-tokenizer.json');
const tok = new QwenTokenizer(JSON.parse(fs.readFileSync(tokPath, 'utf8')));
const { cases } = JSON.parse(fs.readFileSync(fixPath, 'utf8'));
let failed = 0;
for (const c of cases) {
  const mine = tok.kleinPromptIds(c.prompt);
  const textOk = mine.text === c.text;
  const idsOk = mine.inputIds.length === c.input_ids.length && mine.inputIds.every((v, i) => v === c.input_ids[i]);
  const maskOk = mine.attentionMask.every((v, i) => v === c.attention_mask[i]);
  if (!(textOk && idsOk && maskOk)) {
    failed++;
    const at = [...mine.inputIds].findIndex((v, i) => v !== c.input_ids[i]);
    console.log(`FAIL ${JSON.stringify(c.prompt.slice(0, 60))} text=${textOk} ids=${idsOk} mask=${maskOk} firstDiff=${at} mine=${[...mine.inputIds.slice(Math.max(0, at - 2), at + 4)]} ref=${c.input_ids.slice(Math.max(0, at - 2), at + 4)}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} cases match`);
process.exit(failed ? 1 : 0);
