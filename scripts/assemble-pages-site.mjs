// Assemble the Kaminos GitHub Pages site into a new directory: the flame boutique at the root,
// the FLUX.2 [klein] browser demo (with its example images) at inference-kit/klein/, the UniMate
// motion demo (with its clip gallery) at inference-kit/unimate/, and the inference kit source the
// demos import (../../webgpu-inference-kit/src/ from each demo page). Nothing else from the
// repository is published; model weights load from Hugging Face.
// Usage: node scripts/assemble-pages-site.mjs <out-dir>   (the directory must not exist)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function assemblePagesSite(out) {
  if (fs.existsSync(out)) throw new Error(`${out} already exists`);
  fs.cpSync(path.join(repoRoot, "docs", "flame-atlas"), out, { recursive: true });

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
  // UniMate schedules its GPU work with Klein's duty scheduler, imported as ../flux2-klein/.
  fs.mkdirSync(path.join(out, "inference-kit", "flux2-klein"));
  fs.copyFileSync(path.join(klein, "klein-duties.js"), path.join(out, "inference-kit", "flux2-klein", "klein-duties.js"));
  for (const file of fs.readdirSync(path.join(unimate, "clips"))) {
    if (/^[\w-]+\.json$/.test(file)) fs.copyFileSync(path.join(unimate, "clips", file), path.join(motion, "clips", file));
  }
  fs.cpSync(path.join(repoRoot, "webgpu-inference-kit", "src"), path.join(out, "webgpu-inference-kit", "src"), {
    recursive: true,
    filter: source => fs.statSync(source).isDirectory() || source.endsWith(".js"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("usage: node scripts/assemble-pages-site.mjs <out-dir>");
  assemblePagesSite(path.resolve(process.argv[2]));
}
