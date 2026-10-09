import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

test('bench exposes actual lifecycle generation, pause and available step without changing them', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const accessor = source.match(/window\.kaminosFingerFluidBenchSessionState = (\(\) => \(\{[\s\S]*?\}\));/);
  assert.ok(accessor, 'Bench lacks the public continuity read needed to distinguish reset water');
  const context = vm.createContext({fingerFluidBenchStartGeneration: 7,
    fingerFluidBenchSimulationPaused: true, fingerFluidBenchRunning: true,
    fingerFluidBenchSolver: {available: true, getDebugState: () => ({stepCount: 31})}});
  const read = vm.runInContext(accessor[1], context);
  assert.deepEqual(JSON.parse(JSON.stringify(read())), {generation: 7, paused: true, running: true, available: true, step: 31});
  context.fingerFluidBenchStartGeneration = 9;
  context.fingerFluidBenchSolver = null;
  assert.equal(read().generation, 9);
  assert.equal(read().available, false);
  assert.equal(read().step, null);
});
