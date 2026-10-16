// Assemble the Kaminos GitHub Pages site into a new directory: the flame boutique at the root,
// model directory, Klein generation, UniMate motion and Material Photograph exploration with
// their browser modules and assets. Local weight packages are not published.
// Usage: node scripts/assemble-pages-site.mjs <out-dir>   (the directory must not exist)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function assemblePagesSite(out, { supermatWeightsUrl = null } = {}) {
  if (supermatWeightsUrl) {
    let url;
    try { url = new URL(supermatWeightsUrl); } catch {}
    if (!url || url.protocol !== 'https:' || url.hostname !== 'huggingface.co' || url.port || url.username || url.password || url.search || url.hash ||
        !/^\/[^/]+\/[^/]+\/resolve\/[a-f0-9]{40}\/(?:[^/]+\/)*$/.test(url.pathname)) {
      throw new Error('Public SuperMat weights must use a pinned, anonymous Hugging Face package URL');
    }
    supermatWeightsUrl = url.href;
  }
  if (fs.existsSync(out)) throw new Error(`${out} already exists`);
  fs.cpSync(path.join(repoRoot, "docs", "flame-atlas"), out, { recursive: true });
  fs.mkdirSync(path.join(out, "inference-kit"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "docs", "inference-kit", "index.html"), path.join(out, "inference-kit", "index.html"));

  const klein = path.join(repoRoot, "models", "flux2-klein");
  const demo = path.join(out, "inference-kit", "klein");
  fs.mkdirSync(demo, { recursive: true });
  for (const file of fs.readdirSync(klein)) {
    if (file === "index.html" || file === "qwen-tokenizer.js" || /^klein-[\w-]+\.js$/.test(file)) {
      fs.copyFileSync(path.join(klein, file), path.join(demo, file));
    }
  }
  fs.mkdirSync(path.join(demo, "assets"));
  for (const file of fs.readdirSync(path.join(klein, "assets"))) {
    if (/\.(jpg|png)$/.test(file)) fs.copyFileSync(path.join(klein, "assets", file), path.join(demo, "assets", file));
  }
  const unimate = path.join(repoRoot, "models", "unimate");
  const motion = path.join(out, "inference-kit", "unimate");
  fs.mkdirSync(path.join(motion, "clips"), { recursive: true });
  for (const file of fs.readdirSync(unimate)) {
    if (file === "index.html" || /^unimate-[\w-]+\.js$/.test(file)) fs.copyFileSync(path.join(unimate, file), path.join(motion, file));
  }
  for (const file of fs.readdirSync(path.join(unimate, "clips"))) {
    if (/^[\w-]+\.json$/.test(file)) fs.copyFileSync(path.join(unimate, "clips", file), path.join(motion, "clips", file));
  }
  fs.cpSync(path.join(repoRoot, "webgpu-inference-kit", "src"), path.join(out, "webgpu-inference-kit", "src"), {
    recursive: true,
    filter: source => fs.statSync(source).isDirectory() || source.endsWith(".js"),
  });

  const photograph=path.join(out,"inference-kit","material-photo");
  fs.mkdirSync(photograph,{recursive:true});
  for(const file of ["index.html","style.css","main.js","demo-defaults.js","comparison.png","comparison-viewer.js","viewer.js","environment.js","emission.js","material-contrast.js","effects.js","layout.js","photo-contracts.js","photo-surface.js","inference-cache.js","included-examples.js","sample-cutouts.js","moge-producer.js"]){
    fs.copyFileSync(path.join(repoRoot,"demos","material-photo",file),path.join(photograph,file));
  }
  for(const dir of ["images","examples","icons"])fs.cpSync(path.join(repoRoot,"demos","material-photo",dir),path.join(photograph,dir),{recursive:true});
  fs.writeFileSync(path.join(photograph,"deployment.js"),`export const GENERATION_AVAILABLE=${!!supermatWeightsUrl};\nexport const SUPERMAT_WEIGHTS_URL=${JSON.stringify(supermatWeightsUrl)};\n`);
  for(const file of ["finger-fluid-webgpu-core.js","scene-gi.mjs","scene-gi-settings.mjs","scene-gi-history.mjs",
    "lib/three.webgpu.js","lib/three.core.js","lib/three.tsl.js",
    "lib/addons/tsl/display/BloomNode.js","lib/addons/tsl/display/BloomNode.LICENSE",
    "lib/addons/tsl/display/SSGINode.js","lib/addons/tsl/display/SSGINode.LICENSE","lib/addons/tsl/display/DenoiseNode.js","lib/addons/math/SimplexNoise.js",
    "models/supermat/supermat-route.js","models/supermat/supermat-ops.js","models/supermat/supermat-model.js",
    "models/supermat/supermat-kernels.js","models/supermat/supermat-preprocess.js","models/supermat/supermat-maps.js","models/supermat/supermat-cpu-worker.js"]){
    const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repoRoot,file),target);
  }
  fs.cpSync(path.join(repoRoot,"assets","hdr"),path.join(out,"assets","hdr"),{recursive:true});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values,positionals}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:{'supermat-weights':{type:'string'}}});
  if (positionals.length!==1) throw new Error("usage: node scripts/assemble-pages-site.mjs <out-dir> [--supermat-weights <pinned-url>]");
  assemblePagesSite(path.resolve(positionals[0]),{supermatWeightsUrl:values['supermat-weights']||null});
}
