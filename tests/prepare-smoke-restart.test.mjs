// kaminos-test: node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../tools/prepare-smoke-restart.mjs', import.meta.url));
const envelope = outputDir => ({ schema: 'gpu-greenroom.smoke-restart-input.v1',
  action_id: 'action-one', requestId: 'c87664d0-b492-4bff-93f6-d069327e7cb2',
  outputDir, inputs: { seed: 17, camera: [1, 2, 3], label: 'keep exact' }, future: true });

async function run(input, body) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kaminos-restart-test-'));
  const producer = path.join(dir, 'producer with spaces.mjs');
  await writeFile(producer, body);
  const child = spawn(process.execPath, [cli, '--producer', producer], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', s => { stdout += s; });
  child.stderr.setEncoding('utf8').on('data', s => { stderr += s; });
  child.stdin.on('error', () => {});
  child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  return { code, stdout, stderr, dir };
}

const producer = `console.log('loading producer');
export async function prepareAttempt({requestId, outputDir, inputs}) {
  console.info('preparing producer');
  return { id: requestId, operator_command: {output_dir: outputDir}, inputs,
    extension: {preserve: true} };
}`;

test('calls the named producer once with exact inputs and emits one result', async () => {
  const outputDir = path.join(tmpdir(), 'new attempt with spaces');
  const input = envelope(outputDir);
  const r = await run(input, producer);
  assert.equal(r.code, 0, r.stderr);
  const value = JSON.parse(r.stdout);
  assert.equal(value.schema, 'gpu-greenroom.smoke-restart-result.v1');
  assert.equal(value.action_id, input.action_id);
  assert.equal(value.request.id, input.requestId);
  assert.equal(value.request.operator_command.output_dir, outputDir);
  assert.deepEqual(value.request.inputs, input.inputs);
  assert.deepEqual(value.request.extension, {preserve: true});
  assert.match(r.stderr, /loading producer/);
  assert.match(r.stderr, /preparing producer/);
  assert.deepEqual(await readdir(r.dir), ['producer with spaces.mjs']);
});

test('invalid input refuses before importing producer, preserving prior files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kaminos-restart-prior-'));
  const prior = path.join(dir, 'retained.json');
  await writeFile(prior, 'old observation');
  for (const input of ['{', {...envelope(dir), schema:'other'}, {...envelope(dir), outputDir:'relative'},
    {...envelope(dir), inputs:null}, {...envelope(dir), action_id:''}, {...envelope(dir), requestId:42}]) {
    const r = await run(input, `throw new Error('producer must not load');`);
    assert.notEqual(r.code, 0);
    assert.equal(r.stdout, '');
    assert.doesNotMatch(r.stderr, /producer must not load/);
    const error = JSON.parse(r.stderr);
    assert.equal(error.phase, 'read-input');
  }
  assert.equal(await readFile(prior, 'utf8'), 'old observation');
});

test('producer absence, exceptions, partial results and stale identity fail visibly', async () => {
  for (const [body, phase] of [
    ['export const irrelevant = 1;', 'load-producer'],
    ["export function prepareAttempt(){throw new Error('source unavailable')}", 'prepare'],
    ['export function prepareAttempt(){return null}', 'validate-result'],
    ['export function prepareAttempt(){return {id:"old-request"}}', 'validate-result'],
    ['export function prepareAttempt({requestId}){return {id:requestId, lost:undefined}}', 'serialize-result'],
    ['export function prepareAttempt({requestId}){return {id:requestId, value:NaN}}', 'serialize-result'],
  ]) {
    const r = await run(envelope(tmpdir()), body);
    assert.notEqual(r.code, 0);
    assert.equal(r.stdout, '');
    assert.equal(JSON.parse(r.stderr).phase, phase, r.stderr);
  }
});

test('preparation has no fixture output size cap or second callback invocation', async () => {
  const r = await run(envelope(tmpdir()), `let calls = 0;
    export function prepareAttempt({requestId}) { return {id:requestId,calls:++calls,payload:'x'.repeat(1100000)}; }`);
  assert.equal(r.code, 0, r.stderr);
  const request = JSON.parse(r.stdout).request;
  assert.equal(request.calls, 1);
  assert.equal(request.payload.length, 1100000);
});

test('wire result conforms to the actual Greenroom request and command validators',
  {skip: !process.env.GREENROOM_REPO && 'set GREENROOM_REPO for cross-repo conformance'}, async () => {
    const repo = fileURLToPath(new URL('../', import.meta.url));
    const input = {...envelope(tmpdir()), inputs:{repo, owner:'cpu-fixture-owner'}};
    const r = await run(input, `export {prepareAttempt} from ${JSON.stringify(new URL('./fixtures/smoke-restart-producer.mjs', import.meta.url).href)};`);
    assert.equal(r.code, 0, r.stderr);
    const child = spawn(process.env.GREENROOM_PYTHON || 'python3', ['-c',
      'import json,sys; from gpu_queue.smoke_requests import validate_request; from gpu_queue.admission import normalize_manifest; r=validate_request(json.load(sys.stdin)["request"]); m=normalize_manifest(r["operator_command"]); print(json.dumps({"id":r["id"],"output_dir":m["output_dir"],"owner":r["source"]["agent_id"]}))'],
      {cwd: process.env.GREENROOM_REPO, stdio:['pipe','pipe','pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', b => {stdout += b;}); child.stderr.on('data', b => {stderr += b;});
    child.stdin.on('error', () => {}); child.stdin.end(r.stdout);
    const code = await new Promise((resolve,reject) => {child.on('error',reject);child.on('close',resolve);});
    assert.equal(code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {id:input.requestId,output_dir:tmpdir(),owner:input.inputs.owner});
  });
