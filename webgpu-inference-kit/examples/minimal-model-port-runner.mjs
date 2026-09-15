import { runMinimalModelPort } from '@kaminos/webgpu-inference-kit/examples/minimal-model-port';

const output = document.querySelector('#output');

try {
  const report = await runMinimalModelPort({ gpu: navigator.gpu });
  output.textContent = JSON.stringify(report, null, 2);
} catch (error) {
  output.textContent = error.stack || String(error);
}
