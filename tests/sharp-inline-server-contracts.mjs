import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serve = readFileSync(new URL('../serve.py', import.meta.url), 'utf8');

assert.match(
  serve,
  /KAMINOS_SHARP_WEBGPU_REPO[\s\S]{0,500}SHARP_INLINE_MODULE_PATH[\s\S]{0,300}dist-inline[\s\S]{0,300}sharp-inline\.js/,
  'the server must resolve the inline module from the caller-selected SHARP worktree',
);
assert.match(
  serve,
  /KAMINOS_SHARP_WEBGPU_WEIGHTS[\s\S]{0,500}SHARP_INLINE_WEIGHTS_PATH/,
  'the caller must be able to select canonical weights independently from the reviewed module worktree',
);
assert.match(
  serve,
  /os\.environ\.get\([\s\S]{0,100}"KAMINOS_SHARP_WEBGPU_WEIGHTS"[\s\S]{0,300}KAMINOS_SHARP_WEBGPU_REPO \/ "public" \/ "weights\.bin"/,
  'the independent weights path must retain the selected SHARP repo as its explicit default',
);
assert.match(
  serve,
  /"sharpInline": \{[\s\S]{0,1000}"registered":[\s\S]{0,500}"moduleUrl": "\/sharp-inline\/sharp-inline\.js"[\s\S]{0,500}"weightsUrl": "\/sharp-inline\/weights\.bin"/,
  'runtime config must expose requested/effective inline registration and stable browser URLs',
);
assert.match(
  serve,
  /elif parsed\.path\.startswith\("\/sharp-inline\/"\):[\s\S]{0,200}self\.handle_sharp_inline_file\(parsed\.path\)/,
  'the GET router must dispatch inline assets through a bounded handler',
);
assert.match(
  serve,
  /def handle_sharp_inline_file\(self, request_path\):[\s\S]{0,1600}request_path == "\/sharp-inline\/sharp-inline\.js"[\s\S]{0,600}request_path == "\/sharp-inline\/weights\.bin"[\s\S]{0,600}self\.send_error\(404/,
  'the inline asset handler must allow only the exact module and weights paths',
);
assert.match(
  serve,
  /elif parsed\.path == "\/api\/sharp-inline-run-report":[\s\S]{0,150}self\.handle_sharp_inline_run_report\(\)/,
  'the server must expose one product-owned durable report endpoint for browser-realm SHARP runs',
);
assert.match(
  serve,
  /def handle_sharp_inline_run_report\(self\):[\s\S]{0,3500}KAMINOS_PIPELINE_RUNS_DIR[\s\S]{0,1500}sharp-inline-report\.json[\s\S]{0,1800}report_path\.write_text\(json\.dumps\(document, indent=2\)\)/,
  'the inline report endpoint must persist the complete caller envelope under pipeline-runs',
);
assert.match(
  serve,
  /"schema": "kaminos\.sharp-inline-run-report-receipt\.v0"[\s\S]{0,800}"readUrl"/,
  'the inline report endpoint must return its effective durable read identity',
);
assert.match(
  serve,
  /def ingest_splat_asset\(filename, content\):[\s\S]{0,1800}entry\["sha256"\] = _sha256_file\(target\)[\s\S]{0,500}entry\["bytes"\] = target\.stat\(\)\.st_size[\s\S]{0,500}entry\["status"\] = "real"/,
  'successful splat ingest must receipt the hash, byte count, and real status of the file it wrote',
);

console.log('SHARP inline server contracts passed');
