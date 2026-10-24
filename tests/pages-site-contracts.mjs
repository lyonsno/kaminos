import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const repoRoot = process.env.KAMINOS_ROOT ?? path.resolve(import.meta.dirname, "..");

// Each assembled site is a full copy of the published files; remove them when
// the file's tests finish so repeated runs do not fill the temp directory.
const assembledRoots = [];
after(() => {
  for (const root of assembledRoots) fs.rmSync(root, { recursive: true, force: true });
});

async function assembled(options) {
  const { assemblePagesSite } = await import(path.join(repoRoot, "scripts", "assemble-pages-site.mjs"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kaminos-pages-"));
  assembledRoots.push(root);
  const out = path.join(root, "_site");
  assemblePagesSite(out,options);
  return out;
}

function walk(root, dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(root, full) : [path.relative(root, full)];
  });
}

test("Pages site keeps the flame boutique at the root and publishes the model directory, demos and kit source", async () => {
  const site = await assembled();
  const atlas = path.join(repoRoot, "docs", "flame-atlas");
  for (const file of walk(atlas)) {
    assert.ok(fs.readFileSync(path.join(site, file)).equals(fs.readFileSync(path.join(atlas, file))), `${file} differs from docs/flame-atlas`);
  }
  const extra = walk(site).filter(file => !fs.existsSync(path.join(atlas, file)));
  for (const file of extra) {
    assert.match(file, /^(inference-kit\/index\.html|inference-kit\/hand-mesh\/[^/]+\.(html|js|css)|models\/(?:mobrecon|wilor-hand-detector)\/[^/]+\.js|inference-kit\/klein\/(?:[^/]+\.(html|js)|assets\/[^/]+\.(jpg|png))|inference-kit\/unimate\/(index\.html|unimate-[\w-]+\.js|clips\/[\w-]+\.json)|inference-kit\/flux2-klein\/klein-duties\.js|inference-kit\/material-photo\/(?:[^/]+\.(html|js|css|png)|(?:images|examples|icons)\/[^/]+)|webgpu-inference-kit\/src\/.+\.js|models\/supermat\/supermat-[^/]+\.js|lib\/(?:three\.[^/]+\.js|addons\/math\/SimplexNoise\.js|addons\/tsl\/display\/[^/]+\.(js|LICENSE))|assets\/hdr\/[^/]+|scene-gi(?:-(?:settings|history|convergence|source-comparison))?\.mjs|scene-(?:lighting-filter|surface-lighting)\.mjs|annular-burner\.mjs|scene-(?:geometry|liquid-support|edit-session)\.mjs|finger-fluid-webgpu-core\.js|finger-fluid-[^/]+\.mjs|local-liquid-(?:transport|optical-query|inlet-continuity)\.mjs)$/, `${file} is outside the published set`);
  }
  assert.ok(fs.existsSync(path.join(site, "inference-kit", "klein", "index.html")));
  assert.ok(fs.existsSync(path.join(site, "inference-kit", "unimate", "index.html")));
  assert.ok(!fs.existsSync(path.join(site, "serve.py")));
});

test("published model directory routes visitors to existing demos and builder guides", async () => {
  const site = await assembled();
  const page = path.join(site, "inference-kit", "index.html");
  assert.ok(fs.existsSync(page), "assembled site must contain the inference kit directory");
  const html = fs.readFileSync(page, "utf8");
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(links.includes("./klein/"), "FLUX must link to its published demo");
  assert.ok(links.includes("https://lyonsno.github.io/moge-webgpu/"), "MoGe must link to its live demo");
  assert.ok(links.includes("https://github.com/lyonsno/kaminos/tree/main/webgpu-inference-kit/docs/getting-started.md"));
  assert.ok(links.includes("https://www.npmjs.com/package/@kaminos/webgpu-inference-kit"));
  for (const href of links.filter(href => !/^(?:https?:|#)/.test(href))) {
    const target = path.resolve(path.dirname(page), href);
    assert.ok(target.startsWith(site + path.sep), `${href} must stay in the assembled site`);
    assert.ok(fs.existsSync(target), `${href} must resolve in the assembled site`);
  }
  assert.match(html, /tree\/main\/models\/supermat/);
  assert.match(html, /tree\/main\/models\/unimate/);
  assert.doesNotMatch(html, /Development branch/);
});

for(const [label,entry] of [["Hand mesh","inference-kit/hand-mesh/main.js"],["Klein","inference-kit/klein/index.html"],["UniMate","inference-kit/unimate/index.html"],["Material Photograph","inference-kit/material-photo/main.js"]]){
test(`every relative module import in the ${label} demo resolves inside the site`, async () => {
  const site = await assembled();
  const pending = [path.join(site, entry)];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), spec);
      assert.ok(target.startsWith(site + path.sep), `${path.relative(site, file)} imports ${spec}, outside the site`);
      assert.ok(fs.existsSync(target), `${path.relative(site, file)} imports ${spec}, missing from the site`);
      pending.push(target);
    }
  }


  assert.ok([...seen].some(file => file.endsWith(path.join("webgpu-inference-kit", "src", "core.js"))));
});
}

test('hand demo publishes code without model bundles or machine-local routes', async () => {
  const site = await assembled(), page = path.join(site, 'inference-kit/hand-mesh/index.html');
  assert.ok(fs.existsSync(page), 'focused hand demo must be assembled');
  assert.ok(!walk(site).some(file => /(?:mobrecon|hand-detector)\.bin$|\.pkl$/.test(file)), 'restricted model data must not escape into Pages');
  const main = fs.readFileSync(path.join(site, 'inference-kit/hand-mesh/main.js'), 'utf8');
  assert.doesNotMatch(main, /127\.0\.0\.1|\/scratch\/|\/Users\//);
});

test("Pages workflow uploads the assembled site", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "flame-atlas-pages.yml"), "utf8");
  assert.match(workflow, /node scripts\/assemble-pages-site\.mjs _site/);
  assert.match(workflow, /path:\s*_site\s*$/m);
  for (const trigger of ["docs/inference-kit/**", "models/flux2-klein/index.html", "models/flux2-klein/klein-*.js", "models/unimate/index.html", "models/unimate/unimate-*.js",
    "models/unimate/clips/**", "webgpu-inference-kit/src/**", "scripts/assemble-pages-site.mjs"]) {
    assert.ok(workflow.includes(`- ${trigger}`), `workflow does not trigger on ${trigger}`);
  }
});

test("every relative src in the Klein demo page resolves inside the site", async () => {
  const site = await assembled();
  const page = path.join(site, "inference-kit", "klein", "index.html");
  const sources = [...fs.readFileSync(page, "utf8").matchAll(/\ssrc="([^"]+)"/g)].map(match => match[1]).filter(src => !/^[a-z]+:/i.test(src));
  assert.ok(sources.length > 0, "the demo page must reference its example image");
  for (const src of sources) {
    const target = path.resolve(path.dirname(page), src);
    assert.ok(target.startsWith(site + path.sep) && fs.existsSync(target), `index.html src ${src} is missing from the site`);
  }
});

test("the UniMate demo's clip gallery is published with every clip it lists", async () => {
  const site = await assembled();
  const clips = path.join(site, "inference-kit", "unimate", "clips");
  const index = JSON.parse(fs.readFileSync(path.join(clips, "index.json"), "utf8"));
  assert.ok(index.clips.length > 0);
  for (const clip of index.clips) assert.ok(fs.existsSync(path.join(clips, clip.file)), `clip ${clip.file} is missing from the site`);
});

test("Material Photograph publishes real results and renderer assets without local weights", async () => {
  const site=await assembled(),demo=path.join(site,"inference-kit","material-photo");
  assert.ok(fs.existsSync(path.join(demo,"index.html")),"Material Photograph must have a public entry");
  for(const sample of ["orb","celebration","bag"]){
    const source=path.join(repoRoot,"demos","material-photo","examples",sample+".json.gz");
    assert.ok(fs.readFileSync(path.join(demo,"examples",sample+".json.gz")).equals(fs.readFileSync(source)));
  }
  for(const file of ["lib/three.webgpu.js","lib/three.core.js","lib/three.tsl.js","lib/addons/tsl/display/BloomNode.js","lib/addons/tsl/display/BloomNode.LICENSE","scene-gi.mjs","scene-gi-settings.mjs","scene-lighting-filter.mjs","scene-surface-lighting.mjs","finger-fluid-webgpu-core.js","assets/hdr/empty_warehouse_01_1k.hdr"]){
    assert.ok(fs.existsSync(path.join(site,file)),file+" must be served");
  }
  const config=await import(path.join(demo,"deployment.js"));
  assert.equal(config.GENERATION_AVAILABLE,false,"public generation needs hosted weights");
  assert.ok(!fs.existsSync(path.join(site,"scratch")));
  assert.ok(!walk(site).some(file=>/\.py$|(?:^|\/)node_modules\/|(?:^|\/)weights\.bin$/.test(file)));
});

test("a pinned hosted package enables the public own-photo route without publishing local weights",async()=>{
  const supermatWeightsUrl='https://huggingface.co/BasinShapers/supermat-webgpu-weights/resolve/'+ 'a'.repeat(40)+'/f16/';
  const site=await assembled({supermatWeightsUrl});
  const config=await import(path.join(site,'inference-kit','material-photo','deployment.js'));
  assert.equal(config.GENERATION_AVAILABLE,true);
  assert.equal(config.SUPERMAT_WEIGHTS_URL,supermatWeightsUrl);
  assert.ok(!fs.existsSync(path.join(site,'scratch')));
});

test("public generation rejects mutable, local and credential-bearing package URLs",async()=>{
  for(const supermatWeightsUrl of ['/scratch/weights/','https://huggingface.co/owner/model/resolve/main/f16/',
    'https://user:secret@huggingface.co/owner/model/resolve/'+ 'a'.repeat(40)+'/f16/']){
    await assert.rejects(assembled({supermatWeightsUrl}),/pinned.*Hugging Face/i);
  }
});
