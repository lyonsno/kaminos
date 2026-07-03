import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const lotusWrapper = join(root, 'scripts', 'run-lotus-greenroom-adapter.mjs');
const chordWrapper = join(root, 'scripts', 'run-chord-greenroom-adapter.mjs');

const lotusSource = readFileSync(lotusWrapper, 'utf8');
const chordSource = readFileSync(chordWrapper, 'utf8');
assert.match(lotusSource, /lotus_normals/, 'Lotus wrapper must submit the gpu-greenroom lotus_normals job type');
assert.match(chordSource, /chord_materials/, 'CHORD wrapper must submit the gpu-greenroom chord_materials job type');
assert.doesNotMatch(lotusSource, /\/Users\/noahlyons\/dev\/Lotus\/\.venv\/bin\/python/, 'Lotus wrapper must not default to direct model-repo execution');
assert.doesNotMatch(chordSource, /\/Users\/noahlyons\/dev\/ubisoft-laforge-chord\/\.venv\/bin\/python/, 'CHORD wrapper must not default to direct model-repo execution');

const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-greenroom-wrapper-contract-'));
try {
  const fakeGreenroom = join(tempRoot, 'fake-gpu-greenroom.mjs');
  writeFileSync(fakeGreenroom, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let args = process.argv.slice(2);
let queueDir = process.env.GPU_GREENROOM_DIR || '${tempRoot}/queue';
if (args[0] === '--queue-dir') {
  queueDir = args[1];
  args = args.slice(2);
}
const command = args[0];
if (command === 'submit') {
  const jobType = args[1];
  const input = args[2];
  const outputDir = args[3];
  const jobId = jobType + '-job';
  mkdirSync(outputDir, { recursive: true });
  if (jobType === 'lotus_normals') {
    writeFileSync(join(outputDir, 'normal_map.png'), 'PNG MOCK LOTUS NORMAL\\n');
  } else if (jobType === 'chord_materials') {
    writeFileSync(join(outputDir, 'basecolor.png'), 'PNG MOCK BASECOLOR\\n');
    writeFileSync(join(outputDir, 'normal.png'), 'PNG MOCK NORMAL\\n');
    writeFileSync(join(outputDir, 'roughness.png'), 'PNG MOCK ROUGHNESS\\n');
    writeFileSync(join(outputDir, 'metalness.png'), 'PNG MOCK METALNESS\\n');
  } else {
    throw new Error('unexpected job type ' + jobType);
  }
  const doneDir = join(queueDir, 'done', jobId);
  mkdirSync(doneDir, { recursive: true });
  const status = {
    job_id: jobId,
    status: 'done',
    job_type: jobType,
    input_path: input,
    output_dir: outputDir,
    exit_code: 0
  };
  const receipt = {
    job_id: jobId,
    job_type: jobType,
    status: 'done',
    input_path: input,
    output_dir: outputDir,
    effective_route: 'fake gpu-greenroom ' + jobType,
    effective_cwd: '/fake/greenroom',
    exit_code: 0,
    failure_phase: null,
    error_message: null
  };
  writeFileSync(join(doneDir, 'status.json'), JSON.stringify(status, null, 2));
  writeFileSync(join(doneDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log('Submitted job ' + jobId);
  console.log('  Type: ' + jobType);
  console.log('  Input: ' + input);
  console.log('  Output: ' + outputDir);
  console.log('  Dir: ' + join(queueDir, 'pending', jobId));
} else if (command === 'status') {
  const jobId = args[1];
  const jobType = jobId.replace(/-job$/, '');
  console.log(JSON.stringify({
    job_id: jobId,
    status: 'done',
    job_type: jobType,
    input_path: 'source.png',
    output_dir: '${tempRoot}/unused',
    exit_code: 0
  }, null, 2));
} else {
  throw new Error('unexpected command ' + command);
}
`);
  chmodSync(fakeGreenroom, 0o755);
  const input = join(tempRoot, 'source.png');
  writeFileSync(input, 'fake image bytes\\n');
  const env = {
    ...process.env,
    KAMINOS_GPU_GREENROOM_BIN: fakeGreenroom,
    KAMINOS_GREENROOM_QUEUE_DIR: join(tempRoot, 'queue'),
    KAMINOS_GREENROOM_WAIT_MS: '1000',
    KAMINOS_GREENROOM_POLL_MS: '1',
  };

  const lotusOutput = join(tempRoot, 'lotus', 'lotus-normal-map.png');
  const lotusReport = join(tempRoot, 'lotus', 'adapter-report.json');
  const lotus = spawnSync(process.execPath, [
    lotusWrapper,
    '--input', input,
    '--output', lotusOutput,
    '--report', lotusReport,
  ], { encoding: 'utf8', env });
  assert.equal(lotus.status, 0, lotus.stderr || lotus.stdout);
  assert.ok(existsSync(lotusOutput), 'Lotus wrapper must copy a Greenroom normal image to the requested output path');
  assert.match(readFileSync(lotusOutput, 'utf8'), /MOCK LOTUS NORMAL/);
  const lotusDoc = JSON.parse(readFileSync(lotusReport, 'utf8'));
  assert.equal(lotusDoc.ok, true);
  assert.equal(lotusDoc.backend.greenroom.jobType, 'lotus_normals');
  assert.equal(lotusDoc.backend.greenroom.receipt.status, 'done');
  assert.equal(lotusDoc.output.role, 'normal-map');

  const chordOutput = join(tempRoot, 'chord', 'materials.kaminos-material-bundle.json');
  const chordReport = join(tempRoot, 'chord', 'adapter-report.json');
  const chord = spawnSync(process.execPath, [
    chordWrapper,
    '--input', input,
    '--output', chordOutput,
    '--report', chordReport,
  ], { encoding: 'utf8', env });
  assert.equal(chord.status, 0, chord.stderr || chord.stdout);
  assert.ok(existsSync(chordOutput), 'CHORD wrapper must write a requested material bundle output');
  const materialBundle = JSON.parse(readFileSync(chordOutput, 'utf8'));
  assert.equal(materialBundle.schema, 'kaminos.pbr-material-bundle.v0');
  assert.deepEqual(Object.keys(materialBundle.outputs).sort(), ['basecolor', 'metalness', 'normal', 'roughness']);
  const chordDoc = JSON.parse(readFileSync(chordReport, 'utf8'));
  assert.equal(chordDoc.ok, true);
  assert.equal(chordDoc.backend.greenroom.jobType, 'chord_materials');
  assert.equal(chordDoc.backend.greenroom.receipt.status, 'done');
  assert.equal(chordDoc.output.role, 'pbr-material-bundle');
  assert.equal(statSync(chordOutput).size, chordDoc.output.bytes);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
