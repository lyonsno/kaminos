// Generate motion clips with the browser port itself, for the demo page's gallery.
// Usage: node generate-clips.mjs --chrome <exe> --weights <dir> --t5 <dir> --plan <plan.json> --out <dir>
// plan.json: [{ "animal": "Cat", "bundle": "<bundle dir>", "prompts": ["A cat walks forward."], "seeds": [1, 2, 3] }, ...]
// For each animal, serves its skeleton bundle, loads the page in an independent Chrome for
// Testing, generates every prompt x seed on WebGPU and writes one clip file per run
// (<out>/<animal>-<prompt slug>-s<seed>.json, the format the page's gallery plays).
// report.json names the effective browser, adapter, source revision and every run, and is
// written on failure too, with the phase reached.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sourceIdentity, startServer } from '../flux2-klein/cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const chrome = opt('--chrome'), outDir = path.resolve(opt('--out', ''));
const roots = { weights: path.resolve(opt('--weights', '')), t5: path.resolve(opt('--t5', '')) };
const report = { schema: 'kaminos.unimate.generate-clips.v0', requestedChrome: chrome, roots, plan: opt('--plan'), host: os.hostname(),
  startedAt: new Date().toISOString(), source: sourceIdentity(here), phase: 'launch', runs: [] };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

async function finish(code) {
  report.finishedAt = new Date().toISOString();
  await fsp.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(code);
}

const GENERATE = (text, seed) => `(async () => {
  const demo = window.__unimateDemoInstance;
  const r = await demo.generate({ text: ${JSON.stringify(text)}, seed: ${Number(seed)} });
  const p = Float32Array.from(r.motion.positions), b = new Uint8Array(p.buffer);   // clips store float32
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return { positions: btoa(s), frames: r.motion.frames, evaluations: r.evaluations, wallMs: r.wallMs, steps: r.steps.length,
    frameStats: r.frameStats, textEncoder: r.textEncoder, skeleton: { name: demo.bundle.skeleton.name, parents: demo.bundle.skeleton.parents,
      jointNames: demo.bundle.skeleton.jointNames }, fps: demo.fps };
})()`;

try {
  if (!chrome || !opt('--out') || !opt('--plan')) throw new Error('need --chrome, --plan and --out');
  await fsp.mkdir(outDir, { recursive: true });
  const plan = JSON.parse(await fsp.readFile(opt('--plan'), 'utf8'));
  for (const entry of plan) {
    report.phase = `serve:${entry.animal}`;
    const { server, origin } = await startServer({ '/weights/': roots.weights, '/t5/': roots.t5, '/demo/': path.resolve(entry.bundle), '/': path.resolve(here, '../..') });
    const browserReport = {};
    const browser = await launchChrome(chrome, ['--window-size=1280,800'], browserReport);
    report.effectiveBrowser = browserReport.effectiveBrowser;
    try {
      report.phase = `load:${entry.animal}`;
      await browser.navigate(`${origin}/models/unimate/index.html`, 'Boolean(window.__unimateDemo)');
      const t0 = Date.now();
      for (;;) {
        const page = await browser.evaluate('JSON.parse(JSON.stringify(window.__unimateDemo))', false);
        if (page.phase === 'ready') break;
        if (page.phase === 'failed') throw new Error(`page failed: ${page.error}`);
        if (Date.now() - t0 > 600000) throw new Error('page did not become ready');
        await new Promise(r => setTimeout(r, 500));
      }
      report.adapter ??= await browser.evaluate('navigator.gpu.requestAdapter().then(a => a && `${a.info.vendor} / ${a.info.architecture}`)', true);
      if (!(await browser.evaluate('window.__unimateDemoInstance.hasTextEncoder()', false))) throw new Error('text encoder did not load');
      for (const text of entry.prompts) for (const seed of entry.seeds) {
        report.phase = `generate:${entry.animal}:${text}:${seed}`;
        const r = await browser.evaluate(GENERATE(text, seed), true);
        const id = `${slug(entry.animal)}-${slug(text)}-s${seed}`;
        const clip = { schema: 'kaminos.unimate.clip.v0', id, animal: entry.animal, prompt: text, seed, fps: r.fps, frames: r.frames,
          skeleton: r.skeleton, positions: r.positions,
          generated: { by: 'UniMate WebGPU port (this page), browser seed', evaluations: r.evaluations, wallMs: Math.round(r.wallMs),
            browser: report.effectiveBrowser, adapter: report.adapter, source: report.source } };
        await fsp.writeFile(path.join(outDir, `${id}.json`), JSON.stringify(clip));
        report.runs.push({ id, animal: entry.animal, prompt: text, seed, evaluations: r.evaluations, wallMs: Math.round(r.wallMs), steps: r.steps, scene: r.frameStats });
        console.log(`${id}: ${r.evaluations} evaluations, ${(r.wallMs / 1000).toFixed(1)} s`);
      }
    } finally {
      await browser.close();
      server.close();
    }
  }
  report.phase = 'finished';
  report.verdict = 'COMPLETED';
  await finish(0);
} catch (e) {
  report.error = String(e?.stack ?? e);
  report.verdict = 'ERROR';
  await finish(2);
}
