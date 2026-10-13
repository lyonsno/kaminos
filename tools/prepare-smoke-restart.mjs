import { Console } from 'node:console';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
let phase = 'read-input';
let actionId;

// The process owns stdout as its wire channel, including during producer import.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--producer' || !isAbsolute(args[1])) {
    throw new Error('Usage: node tools/prepare-smoke-restart.mjs --producer /absolute/producer.mjs');
  }
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  if (!object(input) || input.schema !== 'gpu-greenroom.smoke-restart-input.v1') {
    throw new Error('Expected gpu-greenroom.smoke-restart-input.v1');
  }
  if (!text(input.action_id) || !text(input.requestId) ||
      !text(input.outputDir) || !isAbsolute(input.outputDir) || !object(input.inputs)) {
    throw new Error('Expected action_id, requestId, absolute outputDir and object inputs');
  }
  actionId = input.action_id;
  const { requestId, outputDir, inputs } = input;
  phase = 'load-producer';
  const producer = await import(pathToFileURL(args[1]).href);
  if (typeof producer.prepareAttempt !== 'function') {
    throw new Error('Producer must export prepareAttempt({requestId, outputDir, inputs})');
  }
  phase = 'prepare';
  const request = await producer.prepareAttempt({ requestId, outputDir, inputs });
  phase = 'validate-result';
  if (!object(request) || request.id !== requestId) {
    throw new Error('Producer must return a request object with the supplied requestId as id');
  }
  phase = 'serialize-result';
  const result = JSON.stringify({ schema: 'gpu-greenroom.smoke-restart-result.v1',
    action_id: actionId, request }, (_key, value) => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' ||
        (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('Producer result must contain JSON values without silent field loss');
    }
    return value;
  });
  phase = 'write-result';
  await new Promise((resolve, reject) => process.stdout.write(`${result}\n`, error => error ? reject(error) : resolve()));
} catch (error) {
  process.stderr.write(`${JSON.stringify({ schema: 'kaminos.smoke-restart-error.v1',
    phase, ...(actionId ? { action_id: actionId } : {}), error: String(error?.message ?? error) })}\n`);
  process.exitCode = 1;
}
