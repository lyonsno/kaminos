// Assemble the Kaminos GitHub Pages site into a new directory: the flame boutique at the root,
// the model directory at inference-kit/, the FLUX.2 [klein] demo at inference-kit/klein/, and the kit source the
// demo imports (../../webgpu-inference-kit/src/ from the demo page). Nothing else from the
// repository is published.
// Usage: node scripts/assemble-pages-site.mjs <out-dir>   (the directory must not exist)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function assemblePagesSite(out) {
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
  fs.cpSync(path.join(repoRoot, "webgpu-inference-kit", "src"), path.join(out, "webgpu-inference-kit", "src"), {
    recursive: true,
    filter: source => fs.statSync(source).isDirectory() || source.endsWith(".js"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("usage: node scripts/assemble-pages-site.mjs <out-dir>");
  assemblePagesSite(path.resolve(process.argv[2]));
}
