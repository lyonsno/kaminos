// Offline evidence replay; never advances or overwrites the saved trajectory.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateAuthoredPackingExactResidualState as evaluate} from '../../authored-packing-sweep-core.mjs';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('INPUT_DIR OUTPUT_REPORT required');
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(input, file)));
const report = {status:'running', input:path.resolve(input), steps:[], lastTrustworthyEvidence:null};
try {
  const result = read('result.json');
  assert.equal(result.status, 'experiment-completed', 'partial/failed run is not replay evidence');
  assert.equal(result.history.length, result.attemptedSteps);
  for (const [name, expected] of Object.entries(result.artifacts)) {
    assert.equal(sha(fs.readFileSync(path.join(input, name))), expected, `artifact hash: ${name}`);
  }
  report.lastTrustworthyEvidence = 'artifact hashes';
  const problem = read('problem.json');
  const source = result.provenance.sourceFiles;
  for (const [name, expected] of Object.entries(source)) {
    if (name !== 'tools/packing-inequality-subproblem.py') assert.equal(sha(fs.readFileSync(path.join(root,name))), expected);
  }
  assert.equal(sha(fs.readFileSync(new URL('subproblem-at-start.py.txt', import.meta.url))), source['tools/packing-inequality-subproblem.py']);
  report.finalSolverSha256 = sha(fs.readFileSync(path.join(root,'tools/packing-inequality-subproblem.py')));
  assert.equal(report.finalSolverSha256, sha(fs.readFileSync(new URL('subproblem-final.py.txt', import.meta.url))));
  report.provenanceLimit = 'Original run spans a receipt-only source change. Exact per-step load times unrecorded. Replay establishes final-solver proposal equivalence, not uniform original source identity.';
  const families = ['pairwisePenetration','skeletalPenetration','compartmentEscape','endpointDrift','maximumRelativeVolumeError'];
  let previous = read('start.json');
  assert.deepEqual(previous, JSON.parse(fs.readFileSync(path.join(root,'artifacts/packing-source-gap-repair-0915/severe/start.json'))));
  let accepted = 0;
  for (const row of result.history) {
    const name = `step-${String(row.step).padStart(3,'0')}.json`, step = read(name);
    assert.deepEqual(step.start.vector, previous.vector);
    assert.deepEqual(step.start.metrics, previous.metrics);
    const proc = spawnSync(result.provenance.config.python, [path.join(root,'tools/packing-inequality-subproblem.py')], {encoding:'utf8',input:JSON.stringify(step.subproblem)});
    assert.equal(proc.status, 0, proc.stderr + proc.stdout);
    const replay = JSON.parse(proc.stdout);
    for (const key of ['status','direction','directionSource','refinementStatus']) assert.deepEqual(replay[key], step.solver[key], `${name}: ${key}`);
    const actual = evaluate({problem, vector:step.selected.vector});
    assert.deepEqual(actual.metrics, step.selected.metrics, `${name}: selected metrics`);
    assert.equal(actual.carrier.identity.sha256, step.selected.carrier.identity.sha256);
    const regressions = families.filter(k=>actual.metrics[k]>previous.metrics[k]+1e-12);
    assert.deepEqual(regressions, []);
    if (step.status === 'improved') {
      assert.ok(actual.metrics.pairwisePenetration < previous.metrics.pairwisePenetration - 1e-12);
      accepted++;
    } else assert.deepEqual(step.selected.vector, previous.vector);
    report.steps.push({step:row.step, directionSource:replay.directionSource, refinementStatus:replay.refinementStatus, proposalMatches:true, selectedGeometryMatches:true, metrics:actual.metrics});
    previous = step.selected;
    report.lastTrustworthyEvidence = name;
  }
  assert.equal(accepted, result.acceptedSteps);
  assert.deepEqual(previous.vector, read('selected.json').vector);
  assert.deepEqual(previous.metrics, result.selected);
  report.status = 'verified';
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
}
fs.mkdirSync(path.dirname(path.resolve(output)), {recursive:true});
fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,steps:report.steps.length,output}));
