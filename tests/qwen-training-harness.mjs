// kaminos-test: node
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const cwd=new URL('../webgpu-inference-kit/experiments/jax-gated-delta/',import.meta.url);
const result=spawnSync(process.execPath,['--test','training-test.mjs','training-runner-test.mjs'],{cwd,encoding:'utf8',env:process.env});
assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
console.log(result.stdout);
const supervisor=spawnSync(process.env.KAMINOS_PYTHON??'python3',['training-supervisor-test.py'],{cwd,encoding:'utf8',env:process.env});
assert.equal(supervisor.status,0,supervisor.stdout+'\n'+supervisor.stderr);
console.log(supervisor.stdout+supervisor.stderr);
