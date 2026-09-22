import { createSam3BrowserImageRuntime } from '../src/sam3-browser-image-runtime.js';

const runtime = createSam3BrowserImageRuntime({
  baseUrl: window.location.href,
  search: window.location.search,
  verificationMode: document.body.dataset.runtimeMode === 'serving' ? 'execution-only' : 'reference-parity',
  inferenceSession: window.sam3InferenceSession,
  get yield() { return window.sam3CooperativeYield; },
  onExecutionContext: context => window.sam3OnExecutionContext?.(context),
  foregroundEvidence: () => window.sam3ForegroundEvidence?.(),
  elements: {
    statusEl: document.getElementById('status'), summaryEl: document.getElementById('summary'),
    reportEl: document.getElementById('report'), canvas: document.getElementById('sam-mask-parity-canvas'),
    sourceImageEl: document.getElementById('sam-source-image'),
  },
});
window.runSam3Invocation = runtime.run;
window.samMaskIslandParitySmokeState = runtime.evidence;
window.samMaskIslandProgress = runtime.progress;
window.samMaskIslandVisualOutput = runtime.output;
window.samMaskIslandDiagnosticReadback = runtime.diagnostic;
window.addEventListener('pagehide', () => void runtime.close(), { once: true });
const params = new URLSearchParams(window.location.search);
if (params.get('autorun') !== '0') runtime.run(params.get('manifest') || '/oracle/tensor-manifest.json');
