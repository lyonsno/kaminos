import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const retiredHarnessUrl = new URL('../volume-dynamic-texture-proof.mjs', import.meta.url);
const broadContracts = readFileSync(new URL('./volume-contracts.mjs', import.meta.url), 'utf8');
const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function executableSourceMap() {
  const sources = new Map();
  const excludedDirectories = new Set(['.git', 'artifacts', 'lib', 'node_modules', 'reviews', 'tests']);
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (/\.(?:cjs|js|mjs|py|ts|tsx)$/.test(entry.name)) {
        sources.set(relative(root, absolute).split('\\').join('/'), readFileSync(absolute, 'utf8'));
      }
    }
  };
  visit(root);
  return sources;
}

function importedSpecifiers(source) {
  return [...source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)['"]([^'"]+)['"]/gm,
  )].map(match => match[1]);
}

function resolveLocalImport(fromPath, specifier, sources) {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}.tsx`, `${base}.py`]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

function liveExecutablePaths({ packageSource: packageText, executableSources }) {
  const pending = [];
  for (const path of executableSources.keys()) {
    const isTopLevelVolumeEntry = !path.includes('/')
      && (/^volume.*\.(?:js|mjs|py|ts|tsx)$/.test(path) || path === 'selective-head-live-runtime.mjs');
    if (isTopLevelVolumeEntry || packageText.includes(path)) pending.push(path);
  }
  const live = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (live.has(path)) continue;
    live.add(path);
    for (const specifier of importedSpecifiers(executableSources.get(path))) {
      const imported = resolveLocalImport(path, specifier, executableSources);
      if (imported && !live.has(imported)) pending.push(imported);
    }
  }
  return live;
}

function assertDynamicTextureProofRetired({ exactHarnessExists, contractSource, packageSource: packageText, executableSources }) {
  assert.equal(
    exactHarnessExists,
    false,
    'the sine-painted dynamic-texture proof harness must remain retired instead of impersonating live simulator evidence',
  );
  assert.doesNotMatch(
    contractSource,
    /volume-dynamic-texture-proof|kaminos\.volume\.dynamic-texture-proof|pyro-cellular-detail-memory-deterministic-ca-v0/,
    'broad contracts must not require or advertise the retired synthetic proof identity',
  );
  for (const path of liveExecutablePaths({ packageSource: packageText, executableSources })) {
    const separatelyInventoried = !path.includes('/')
      && (/^volume.*\.(?:js|mjs|py|ts|tsx)$/.test(path) || path === 'selective-head-live-runtime.mjs');
    if (separatelyInventoried) continue;
    assert.doesNotMatch(
      executableSources.get(path),
      /\b(?:Math|np)\s*(?:\.\s*(?:sin|cos|tan)\b|\[[^\]]+\])|(?<![\w.])(?:sin|cos|tan)\s*\(/,
      `live executable synthetic texture producer ${path} must not restore unclassified periodic authorship`,
    );
  }
}

assertDynamicTextureProofRetired({
  exactHarnessExists: existsSync(retiredHarnessUrl),
  contractSource: broadContracts,
  packageSource,
  executableSources: executableSourceMap(),
});

assert.throws(
  () => assertDynamicTextureProofRetired({
    exactHarnessExists: false,
    contractSource: broadContracts,
    packageSource: '{"scripts":{"proof:relocated":"node tools/dynamic-texture-evidence.mjs"}}',
    executableSources: new Map([[
      'tools/dynamic-texture-evidence.mjs',
      'const plume = Math.sin(y * 8); export function renderDynamicTextureEvidence() { return plume; }',
    ]]),
  }),
  /live executable synthetic texture producer/,
  'the retirement barrier rejects a renamed nested periodic producer with a real package consumer',
);

assert.throws(
  () => assertDynamicTextureProofRetired({
    exactHarnessExists: false,
    contractSource: broadContracts,
    packageSource: '{}',
    executableSources: new Map([
      ['volume-proof-wrapper.mjs', "import './tools/dynamic-texture-evidence.mjs';"],
      [
        'tools/dynamic-texture-evidence.mjs',
        'const plume = Math.sin(y * 8); export function renderDynamicTextureEvidence() { return plume; }',
      ],
    ]),
  }),
  /live executable synthetic texture producer/,
  'the retirement barrier follows a product-owned import to a relocated periodic producer',
);

console.log('volume dynamic texture proof retirement contracts passed');
