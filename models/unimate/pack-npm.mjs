// Build the @kaminos/unimate-webgpu npm package from this directory's runtime modules.
// Usage: node pack-npm.mjs --out <dir>      (then: npm pack <dir>, or npm publish <dir>)
// Copies every runtime module (unimate-*.js) and the package template (package/: entry,
// package.json, README, LICENSE) into <dir>. Imports of the in-repo inference kit become imports of
// the published kit (@kaminos/webgpu-inference-kit/core); any other import outside this directory
// fails the build, so the package cannot ship a path that only resolves inside the repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : null;
if (!out) { console.error('usage: node pack-npm.mjs --out <dir>'); process.exit(2); }
const KIT = /(['"])\.\.\/\.\.\/webgpu-inference-kit\/src\/(core|command-duty-scheduler)\.js\1/g;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const modules = fs.readdirSync(here).filter(f => /^unimate-[\w-]+\.js$/.test(f)).sort();
const problems = [];
for (const f of modules) {
  const src = fs.readFileSync(path.join(here, f), 'utf8').replace(KIT, '$1@kaminos/webgpu-inference-kit/core$1');
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith('../') || (spec.startsWith('./') && !fs.existsSync(path.join(here, spec)))) problems.push(`${f} imports ${spec}`);
  }
  fs.writeFileSync(path.join(out, f), src);
}
for (const f of fs.readdirSync(path.join(here, 'package'))) fs.copyFileSync(path.join(here, 'package', f), path.join(out, f));
if (problems.length) { console.error(`pack-npm: imports that only resolve inside the repository:\n  ${problems.join('\n  ')}`); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
console.log(`${pkg.name}@${pkg.version}: ${modules.length} modules -> ${out}`);
