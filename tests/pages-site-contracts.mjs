import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = process.env.KAMINOS_ROOT ?? path.resolve(import.meta.dirname, "..");

async function assembled() {
  const { assemblePagesSite } = await import(path.join(repoRoot, "scripts", "assemble-pages-site.mjs"));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kaminos-pages-")), "_site");
  assemblePagesSite(out);
  return out;
}

function walk(root, dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(root, full) : [path.relative(root, full)];
  });
}

test("Pages site keeps the flame boutique at the root and adds only the Klein demo and kit source", async () => {
  const site = await assembled();
  const atlas = path.join(repoRoot, "docs", "flame-atlas");
  for (const file of walk(atlas)) {
    assert.ok(fs.readFileSync(path.join(site, file)).equals(fs.readFileSync(path.join(atlas, file))), `${file} differs from docs/flame-atlas`);
  }
  const extra = walk(site).filter(file => !fs.existsSync(path.join(atlas, file)));
  for (const file of extra) {
    assert.match(file, /^(inference-kit\/klein\/[^/]+\.(html|js)|inference-kit\/klein\/assets\/[^/]+\.(jpg|png)|webgpu-inference-kit\/src\/.+\.js)$/, `${file} is outside the published set`);
  }
  assert.ok(fs.existsSync(path.join(site, "inference-kit", "klein", "index.html")));
  assert.ok(!fs.existsSync(path.join(site, "serve.py")));
});

test("every relative module import in the Klein demo resolves inside the site", async () => {
  const site = await assembled();
  const pending = [path.join(site, "inference-kit", "klein", "index.html")];
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

test("Pages workflow uploads the assembled site", () => {
  const workflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "flame-atlas-pages.yml"), "utf8");
  assert.match(workflow, /node scripts\/assemble-pages-site\.mjs _site/);
  assert.match(workflow, /path:\s*_site\s*$/m);
  for (const trigger of ["models/flux2-klein/index.html", "models/flux2-klein/klein-*.js", "webgpu-inference-kit/src/**", "scripts/assemble-pages-site.mjs"]) {
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
