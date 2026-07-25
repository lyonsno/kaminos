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
  /"sharpInline": \{[\s\S]{0,1000}"registered":[\s\S]{0,1000}"moduleUrl": "\/sharp-inline\/sharp-inline\.js"[\s\S]{0,500}"weightsUrl": "\/sharp-inline\/weights\.bin"/,
  'runtime config must expose requested/effective inline registration and stable browser URLs',
);
assert.match(
  serve,
  /KAMINOS_SHARP_WEBGPU_EXPECTED_REVISION[\s\S]{0,3000}"expectedRevision":[\s\S]{0,500}"revisionMatchesExpectation":[\s\S]{0,500}"revisionContractStatus":/,
  'runtime config must expose and enforce an optional exact SHARP source revision contract',
);
assert.match(
  serve,
  /def _sharp_inline_revision\(\):[\s\S]{0,1200}git[\s\S]{0,300}rev-parse[\s\S]{0,300}HEAD[\s\S]{0,1200}sharp_revision = _sharp_inline_revision\(\)[\s\S]{0,2400}"revision": sharp_revision/,
  'runtime config must expose the effective SHARP source revision rather than only its checkout path',
);
assert.match(
  serve,
  /elif parsed\.path\.startswith\("\/sharp-inline\/"\):[\s\S]{0,200}self\.handle_sharp_inline_file\(parsed\.path\)/,
  'the GET router must dispatch inline assets through a bounded handler',
);
assert.match(
  serve,
  /SHARP_INLINE_ASSETS_PATH[\s\S]{0,300}dist-inline[\s\S]{0,100}assets/,
  'the server must resolve emitted inline chunks from the selected SHARP worktree',
);
assert.match(
  serve,
  /def handle_sharp_inline_file\(self, request_path\):[\s\S]{0,2200}request_path == "\/sharp-inline\/sharp-inline\.js"[\s\S]{0,600}request_path == "\/sharp-inline\/weights\.bin"[\s\S]{0,1000}request_path\.startswith\("\/sharp-inline\/assets\/"\)[\s\S]{0,1000}self\.send_error\(404/,
  'the inline asset handler must allow the exact module and weights plus bounded emitted chunks',
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
for (const action of ['start', 'chunk', 'finish', 'abort']) {
  assert.ok(
    serve.includes(`parsed.path == "/api/sharp-inline-run-report/${action}"`),
    `the server must expose the ${action} phase of nonblocking SHARP report persistence`,
  );
}
assert.match(
  serve,
  /"status": "receiving"[\s\S]{0,1800}write_sharp_inline_report_state\(run_dir, state\)/,
  'report start must durably write receiving state before accepting trace chunks',
);
assert.match(
  serve,
  /"mediaType": "application\/x-ndjson"[\s\S]{0,8000}expectedStart[\s\S]{0,2200}receivedCount/,
  'trace chunks must append exact-count NDJSON with contiguous start validation',
);
assert.match(
  serve,
  /receivedCount[\s\S]{0,1500}expectedCount[\s\S]{0,2200}sharp-inline-report\.json/,
  'report finish must reject partial collections before writing the compact final report',
);
assert.doesNotMatch(
  serve,
  /"schema": "kaminos\.sharp-inline-run-report-receipt\.v0"[\s\S]{0,900}"document": document/,
  'the report receipt must not echo the complete document back to the renderer',
);
assert.match(
  serve,
  /durable_size > committed_bytes[\s\S]{0,1200}stream\.truncate\(committed_bytes\)[\s\S]{0,1800}"committedBytes"/,
  'chunk retries must reconcile any uncommitted crash tail before appending',
);
assert.match(
  serve,
  /_inspect_ndjson_file\(trace_path\)[\s\S]{0,1800}"rows"[\s\S]{0,1000}"sha256"/,
  'finish must inspect the durable NDJSON bytes and exact row count before completion',
);
assert.match(
  serve,
  /state\.get\("status"\) == "complete"[\s\S]{0,300}_sharp_inline_complete_receipt/,
  'finish and late abort handling must preserve already-complete session truth',
);
assert.match(
  serve,
  /"lastTrustworthyOutput":\s*payload\.get\("lastTrustworthyOutput"\)[\s\S]{0,18000}"lastTrustworthyOutput":\s*state\.get\("lastTrustworthyOutput"\)/,
  'start and abort failure reports must preserve the last trustworthy PLY identity',
);
assert.match(
  serve,
  /"\.ndjson": "application\/x-ndjson"/,
  'trace artifact read URLs must serve first-class NDJSON media',
);
assert.match(
  serve,
  /def ingest_splat_asset\(filename, content\):[\s\S]{0,1800}entry\["sha256"\] = _sha256_file\(target\)[\s\S]{0,500}entry\["bytes"\] = target\.stat\(\)\.st_size[\s\S]{0,500}entry\["status"\] = "real"/,
  'successful splat ingest must receipt the hash, byte count, and real status of the file it wrote',
);

console.log('SHARP inline server contracts passed');
