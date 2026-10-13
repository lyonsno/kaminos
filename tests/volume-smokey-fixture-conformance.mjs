import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {smokeyVariants} from '../volume-smokey-heldout.mjs';

assert.ok(process.argv[2],'usage: volume-smokey-fixture-conformance.mjs OBSERVED_BASIN_JSON');
const artifact=JSON.parse(readFileSync(process.argv[2]));
const variants=smokeyVariants(artifact.preset);
// Replay the pinned serving implementation against the actual saved source.
execFileSync('python3',['-c',
  'import json,sys,serve; rows=json.load(sys.stdin); [serve.validate_volume_settings_preset_payload(v["preset"]) for v in rows]; print(len(rows))'],
  {cwd:new URL('..',import.meta.url),input:JSON.stringify(variants),stdio:['pipe','inherit','inherit']});
console.log('all nine derived fixtures conform to the pinned server');
