import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

// CPU-only external-boundary fixture: execute the real smoke-page module with
// simulated kit sessions. Never use this module for native closing evidence.
const failure = process.env.SAM31_BENCHMARK_CPU_FAILURE;
const trace = { launches: 0, residentCreations: 0, closed: false, residentClosed: false };
const save = () => writeFile(process.env.SAM31_BENCHMARK_CPU_TRACE, JSON.stringify(trace));
let context;
let plan;
let runIndex = 0;
let interruptRun;
const sha = async data => `sha256:${Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
export const chromium = {
  async launch(launchOptions) {
    trace.launches += 1; trace.launchOptions = launchOptions; await save();
    if (failure === 'launch') throw new Error('simulated launch failure');
    return {
      version: () => 'CPU fixture, not a browser',
      isConnected: () => !trace.disconnected && !trace.closed,
      on() {}, off() {},
      async newPage() {
        return {
          setDefaultTimeout(value) { trace.pageTimeout = value; },
          setDefaultNavigationTimeout(value) { trace.navigationTimeout = value; },
          on() {},
          async goto(url, gotoOptions) {
            trace.url = new URL(url).origin; trace.gotoOptions = gotoOptions;
            plan = await (await fetch(`${trace.url}/api/benchmark-plan`)).json();
            const html = await (await fetch(url)).text();
            if (failure === 'page-module') throw new Error('simulated module failure');
            const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
            if (!script) throw new Error('actual benchmark page module missing');
            const kit = {
              createSam31BrowserTrackerPackageCache: () => ({ evidence: () => ({ backingStore: { kind: failure === 'opfs' ? 'retained-memory' : 'browser-opfs' } }) }),
              async createSam31BrowserTrackerResidentSession() {
                trace.residentCreations += 1;
                return {
                  packageId: plan.modelPackageId,
                  adapterInfo: { isFallbackAdapter: false, description: 'CPU simulated adapter' },
                  async run(input) {
                    if (failure === 'disconnect') { trace.disconnected = true; await save(); throw new Error('CPU fixture disconnected during execution'); }
                    if (failure === 'signal') {
                      process.stdout.write('CPU fixture holding invocation\n');
                      await new Promise((_accept, reject) => { interruptRun = reject; });
                    }
                    const g = plan.expectedGeometry;
                    const outputValues = {
                      conditionedFeatures: new Float32Array(g.queryTokens * g.channels).fill(failure === 'blank' ? 0 : 1),
                      selectedMasks: new Float32Array(g.multiplexCount * g.maskHeight * g.maskWidth).fill(-1),
                      objectScores: new Float32Array(g.multiplexCount).fill(2),
                      objectPointers: new Float32Array(g.multiplexCount * g.channels).fill(3),
                    };
                    if (failure === 'partial') outputValues.conditionedFeatures = new Float32Array(1).fill(1);
                    const roles = { conditionedFeatures: 'sam31-memory-conditioned-features', selectedMasks: 'sam31-multiplex-selected-masks', objectScores: 'sam31-multiplex-object-scores', objectPointers: 'sam31-multiplex-object-pointers' };
                    const receiptOutputs = await Promise.all(Object.entries(outputValues).map(async ([name, values]) => ({ role: roles[name], status: 'real', sha256: await sha(values) })));
                    const mode = input.memoryAttentionKernel;
                    const stages = Array.from({ length: 4 }, (_, index) => ['Self', 'Cross'].map(kind => ({ name: `layer${index}${kind}Attention`, metadata: { kernelName: `layer${index}${kind}Attention${mode === 'flash' ? 'Flash0' : ''}` }, ms: 2 }))).flat();
                    const routes = Array.from({ length: 19 }, (_, index) => `cpu-route:${index}`);
                    routes[17] = 'sam3.1.memory-attention.phase-program.webgpu-local.v0';
                    const modelId = plan.modelPackageId;
                    const result = {
                      memoryAttentionKernel: failure === 'mode' ? 'wrong' : mode, evidence: { passed: true }, adapterInfo: { isFallbackAdapter: failure === 'fallback' },
                      manifest: { executionGeometry: { ...g, decoderMaskHeight: g.maskHeight, decoderMaskWidth: g.maskWidth } },
                      packageRuntime: { packageId: modelId, invocationId: input.session.sessionId, session: input.session, sourceImageSha256: ['rgba0', 'rgba1'], encodedSourceImageSha256: await Promise.all(input.sourceImages.map(sha)), initialMaskSha256: await sha(input.initialMask), cacheEvidence: { backingStore: { kind: 'browser-opfs' } } },
                      requestedRouteIds: routes, effectiveRouteIds: routes,
                      receipts: routes.map((id, index) => ({ requestedRouteId: id, effectiveRouteId: id, status: 'real', fallbackReason: null, kernel: { commit: failure === 'source' ? 'stale' : plan.commit }, outputs: index === 17 ? [receiptOutputs[0]] : index === 18 ? receiptOutputs.slice(1) : [{ status: 'real', sha256: 'cpu:output' }], timings: { stages: index === 17 && failure !== 'trace' ? stages : [] } })),
                      residentRuntime: { modelPackageId: modelId, residentSessionId: failure === 'device-change' && runIndex > 0 ? 'other-device' : 'cpu-resident', resourceCount: 1007, liveBufferIds: Array.from({ length: 1007 }, (_, index) => `buffer:${index}`), truncated: false, modelAllocationDelta: 0, modelUploadDelta: 0 },
                      timing: { kind: 'host-wall', episodeWallMs: 100, sessionSetupMs: 10, setupMs: 5, backbonePrecomputesBothFrames: true, frame1: { backboneMs: 30, temporalBankMs: 10, memoryAttentionMs: 20, decoderMs: 10, attributedTotalMs: 70, memoryAttentionShare: 20 / 70 } },
                      outputs: { frame1: outputValues, shapes: { frame1: { conditionedFeatures: [1, g.queryTokens, g.channels], selectedMasks: [g.multiplexCount, 1, g.maskHeight, g.maskWidth], objectScores: [g.multiplexCount, 1], objectPointers: [g.multiplexCount, g.channels] } } },
                    };
                    if (failure === 'input-change') result.packageRuntime.initialMaskSha256 = 'wrong-mask';
                    if (failure === 'missing-capture') delete result.outputs;
                    if (failure === 'shape') result.outputs.shapes.frame1.selectedMasks = [1, outputValues.selectedMasks.length];
                    trace.sessionIds = [...(trace.sessionIds || []), input.session.sessionId];
                    runIndex += 1; await save(); return result;
                  },
                  async close() { trace.residentClosed = true; await save(); return { queueDrained: true, modelReleased: true, ownerRouteDetached: true, sessionClosed: true, deviceLossAwaited: true }; },
                };
              },
            };
            const browserFetch = (path, options) => {
              if (failure === 'upload' && options?.method === 'POST') throw new Error('simulated upload failure');
              return fetch(new URL(path, url), options);
            };
            context = createContext({ console, crypto: webcrypto, Float32Array, Uint8Array, Uint32Array, ArrayBuffer, fetch: browserFetch, document: { querySelector: () => ({ textContent: '' }) } });
            context.window = context;
            const module = new SourceTextModule(script, { context });
            await module.link(() => new SyntheticModule(Object.keys(kit), function () { for (const [name, value] of Object.entries(kit)) this.setExport(name, value); }, { context }));
            await module.evaluate();
            await save();
          },
          async evaluate(fn, argument) {
            return await fn.call(null, argument);
          },
        };
      },
      async close() { trace.closed = true; interruptRun?.(new Error('CPU fixture browser closed')); await save(); },
    };
  },
};

// Playwright serializes functions into the page realm; model that operation.
const originalLaunch = chromium.launch;
chromium.launch = async function (...args) {
  const browser = await originalLaunch.apply(this, args);
  const originalNewPage = browser.newPage;
  browser.newPage = async function () {
    const page = await originalNewPage.call(this);
    page.evaluate = async (fn, argument) => {
      if (trace.disconnected) return new Promise(() => {});
      context.__argument = argument;
      const { runInContext } = await import('node:vm');
      return await runInContext(`(${fn.toString()})(__argument)`, context);
    };
    return page;
  };
  return browser;
};
