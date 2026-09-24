#!/usr/bin/env node

// Transport arm capture: loads one saved basin on the live Apple WebGPU route,
// applies a sequence of control arms through the cockpit DOM (persistent history,
// not paired resets), settles each arm, records the renderer receipt (transport,
// pressure solver, divergence residual, pass ledger, browser errors) and captures
// one frame per arm. Usage:
//   node volume-transport-arm-capture.mjs <url> <outDir> "<arm>;<arm>;..." [settleMs]
// where an arm is name[,controlId=value,...]. Frames are admission and
// attribution evidence for the implementer; the operator judges motion live.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
const [url, outDir, armsArg, settleArg] = process.argv.slice(2);
const arms = armsArg.split(';').map(a => { const [name, ...pairs] = a.split(','); return { name, set: pairs.map(p => p.split('=')) }; });
const settleMs = Number(settleArg || 12000);
mkdirSync(outDir, { recursive: true });
const port = 45141; const profile = `/tmp/kaminos-scheme-capture-${port}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new','--enable-unsafe-webgpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1400,900','about:blank'], { stdio: ['ignore','pipe','pipe'] });
chrome.stdout.on('data', () => {}); chrome.stderr.on('data', () => {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pages = null; for (let i = 0; i < 100 && !pages; i++) { try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); } }
const page = pages.find(p => p.type === 'page'); const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(res => ws.addEventListener('open', res, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300)); });
const call = (method, params = {}) => new Promise((res, rej) => { const myId = ++id; pending.set(myId, res); setTimeout(() => { pending.delete(myId); rej(new Error('timeout ' + method)); }, 60000); ws.send(JSON.stringify({ id: myId, method, params })); });
const evaluate = async expr => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed'); return r.result?.result?.value; };
const op = body => `(() => { const f = document.querySelector('#basin'); const w = f?.contentWindow || window; const d = w.document; return (${body}); })()`;
const stateExpr = op(`(() => { const s = w.__kaminosVolumePrototype?.debugState?.(); if (!s) return null; return { backend: s.backend, error: s.error, simStepCount: s.simStepCount, frameCount: s.frameCount, transport: s.transport?.effective ?? null, transportUniform: s.transport?.uniform ?? null, predictorPasses: s.transportPredictorPasses, breakdownTotal: s.fullGridPassBreakdown?.total, residual: s.pressureSolver?.residual ? { step: s.pressureSolver.residual.step, compactBefore: s.pressureSolver.residual.compact.before, compactAfter: s.pressureSolver.residual.compact.after } : null, solver: s.pressureSolver?.effective ?? null, forces: { fine: d.getElementById('volume-force-fine-breakup')?.checked, shred: d.getElementById('volume-force-interface-shred')?.checked, micro: d.getElementById('volume-force-micro-carrier')?.checked }, schemeDom: d.getElementById('volume-advection-scheme')?.value, schemeLabel: d.getElementById('volume-advection-scheme-val')?.textContent, commonLabel: d.getElementById('volume-common-gas-transport-val')?.textContent, projection: d.getElementById('volume-projection')?.value }; })()`);
const setControl = (cid, value) => evaluate(op(`(() => { const e = d.getElementById(${JSON.stringify(cid)}); if (!e) throw new Error('missing ' + ${JSON.stringify(cid)}); if (e.type === 'checkbox') { e.checked = ${JSON.stringify(value)} === 'true'; } else { e.value = ${JSON.stringify(value)}; } e.dispatchEvent(new w.Event('input', { bubbles: true })); e.dispatchEvent(new w.Event('change', { bubbles: true })); return e.type === 'checkbox' ? e.checked : e.value; })()`));
await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable'); await call('Page.navigate', { url });
let admitted = null;
for (let i = 0; i < 60 && !admitted; i++) { await sleep(1000); const s = await evaluate(stateExpr); if (s && (s.error || (s.backend && /^WebGPU:/.test(s.backend) && s.simStepCount > 10))) admitted = s; }
const report = { url, admitted, arms: [], errors };
if (!admitted || admitted.error) { console.log(JSON.stringify(report, null, 2)); ws.close(); chrome.kill('SIGKILL'); process.exit(1); }
for (const arm of arms) {
  for (const [cid, value] of arm.set) await setControl(cid, value);
  await sleep(1500);
  const after = await evaluate(stateExpr);
  const t0 = Date.now(); const s0 = after.simStepCount;
  await sleep(settleMs);
  const end = await evaluate(stateExpr);
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const file = `${outDir}/${arm.name}.png`; writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  report.arms.push({ arm: arm.name, set: arm.set, afterSwitch: after, end, stepsPerSecond: (end.simStepCount - s0) / ((Date.now() - t0) / 1000), screenshot: file, errorsSoFar: errors.length });
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  if (end.error) break;
}
console.log(JSON.stringify(report.arms.map(a => ({ arm: a.arm, scheme: a.end.transport?.scheme, predictor: a.end.transport?.predictorPass, backend: a.end.backend, error: a.end.error, steps: a.end.simStepCount, sps: Number(a.stepsPerSecond.toFixed(1)), label: a.end.schemeLabel, forces: a.end.forces, total: a.end.breakdownTotal })), null, 1));
console.log('errors:', errors.slice(0, 5));
ws.close(); chrome.kill('SIGKILL'); await sleep(500); rmSync(profile, { recursive: true, force: true }); process.exit(0);
