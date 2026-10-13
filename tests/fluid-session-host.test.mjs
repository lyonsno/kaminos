import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

test('bench exposes actual lifecycle generation, pause and available step without changing them', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const accessor = source.match(/window\.kaminosFingerFluidBenchSessionState = (\(\) => \(\{[\s\S]*?\}\));/);
  assert.ok(accessor, 'Bench lacks the public continuity read needed to distinguish reset water');
  const context = vm.createContext({fingerFluidFiniteRoute:null,KAMINOS_FINGER_FLUID_FIXED_STEP_SECONDS:1/60,fingerFluidBenchStartGeneration: 7,
    fingerFluidBenchSimulationPaused: true, fingerFluidBenchRunning: true,
    fingerFluidBenchSolver: {available: true, getDebugState: () => ({stepCount: 31})}});
  const read = vm.runInContext(accessor[1], context);
  const state=read();for(const [key,value]of Object.entries({generation:7,paused:true,running:true,available:true,step:31}))assert.equal(state[key],value);
  assert.equal(state.physicsTimestepSeconds,1/60);
  context.fingerFluidBenchStartGeneration = 9;
  context.fingerFluidBenchSolver = null;
  assert.equal(read().generation, 9);
  assert.equal(read().available, false);
  assert.equal(read().step, null);
});
