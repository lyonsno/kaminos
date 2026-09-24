import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const retiredHarnessUrl = new URL('../volume-dynamic-texture-proof.mjs', import.meta.url);
const broadContracts = readFileSync(new URL('./volume-contracts.mjs', import.meta.url), 'utf8');
const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const TOP_LEVEL_PERIODIC_INVENTORY_SOURCE = /^volume.*\.(?:html|cjs|js|mjs|py|ts|tsx)$/;

function separatelyInventoriedExecutablePath(path) {
  return !path.includes('/')
    && (TOP_LEVEL_PERIODIC_INVENTORY_SOURCE.test(path) || path === 'selective-head-live-runtime.mjs');
}

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

function importedSpecifiers(source, fromPath) {
  const specifiers = [...source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)['"]([^'"]+)['"]/gm,
  )].map(match => ({ kind: 'javascript', value: match[1] }));
  if (!fromPath.endsWith('.py')) return specifiers;
  for (const match of source.matchAll(/^\s*from\s+([.A-Za-z_]\w*(?:\.\w+)*)\s+import\s+/gm)) {
    specifiers.push({ kind: 'python', value: match[1] });
  }
  for (const match of source.matchAll(/^\s*import\s+([^#\n]+)/gm)) {
    for (const imported of match[1].split(',')) {
      const moduleName = imported.trim().split(/\s+as\s+/)[0];
      if (/^[.A-Za-z_]\w*(?:\.\w+)*$/.test(moduleName)) {
        specifiers.push({ kind: 'python', value: moduleName });
      }
    }
  }
  return specifiers;
}

function resolveLocalImport(fromPath, specifier, sources) {
  if (specifier.kind === 'python') {
    const leadingDots = specifier.value.match(/^\.+/)?.[0].length || 0;
    let baseDirectory = leadingDots > 0 ? posix.dirname(fromPath) : '';
    for (let level = 1; level < leadingDots; level += 1) {
      baseDirectory = posix.dirname(baseDirectory);
    }
    const moduleName = specifier.value.slice(leadingDots).replaceAll('.', '/');
    const base = posix.normalize(posix.join(baseDirectory, moduleName));
    for (const candidate of [`${base}.py`, posix.join(base, '__init__.py')]) {
      if (sources.has(candidate)) return candidate;
    }
    return null;
  }
  if (!specifier.value.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier.value));
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
    for (const specifier of importedSpecifiers(executableSources.get(path), path)) {
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
    if (separatelyInventoriedExecutablePath(path)) continue;
    assert.doesNotMatch(
      executableSources.get(path),
      /\b(?:Math|np|numpy|math)\s*(?:\.\s*(?:sin|cos|tan)\b|\[[^\]]+\])|(?<![\w.])(?:sin|cos|tan)\s*\(/,
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

const acceptedCrossLanguageFalseClosures = [];
if (!separatelyInventoriedExecutablePath('volume-restored-painter.ts')) {
  acceptedCrossLanguageFalseClosures.push('top-level TypeScript omitted from the separate periodicity inventory');
}
try {
  assertDynamicTextureProofRetired({
    exactHarnessExists: false,
    contractSource: broadContracts,
    packageSource: '{}',
    executableSources: new Map([
      ['volume-proof-wrapper.py', 'from tools.dynamic_texture_evidence import plume'],
      ['tools/dynamic_texture_evidence.py', 'plume = np.sin(y * 8)'],
    ]),
  });
  acceptedCrossLanguageFalseClosures.push('nested Python periodic producer imported by top-level Volume wrapper');
} catch {
  // The executable reachability boundary must reject the nested producer.
}
assert.deepEqual(
  acceptedCrossLanguageFalseClosures,
  [],
  'the composed executable-source boundary must own TypeScript entries and local Python import reachability',
);

console.log('volume dynamic texture proof retirement contracts passed');
