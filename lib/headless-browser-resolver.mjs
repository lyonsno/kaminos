import {
  accessSync,
  constants,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const HEADLESS_BROWSER_RESOLUTION_SCHEMA = 'kaminos.headless-browser-resolution.v0';

function normalizedOverride(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function headlessBrowserRequest({ cliExecutable = null, envExecutable = null } = {}) {
  const cli = normalizedOverride(cliExecutable);
  if (cli) return { source: 'cli', executable: cli };
  const environment = normalizedOverride(envExecutable);
  if (environment) return { source: 'environment', executable: environment };
  return { source: 'independent-default', executable: null };
}

function candidatePaths(cacheRoot, entryName, platform, arch) {
  const root = path.join(cacheRoot, entryName);
  if (platform === 'darwin') {
    const macSuffix = arch === 'arm64' ? 'mac-arm64' : 'mac';
    return entryName.startsWith('chromium_headless_shell-') ? [{
      kind: 'playwright-chromium-headless-shell',
      executable: path.join(root, `chrome-headless-shell-${macSuffix}`, 'chrome-headless-shell'),
    }] : [{
      kind: 'playwright-chrome-for-testing',
      executable: path.join(
        root,
        `chrome-${macSuffix}`,
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing',
      ),
    }, {
      kind: 'playwright-chromium',
      executable: path.join(
        root,
        `chrome-${macSuffix}`,
        'Chromium.app',
        'Contents',
        'MacOS',
        'Chromium',
      ),
    }];
  }
  if (platform === 'linux') {
    return entryName.startsWith('chromium_headless_shell-') ? [{
      kind: 'playwright-chromium-headless-shell',
      executable: path.join(root, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    }] : [{
      kind: 'playwright-chrome-for-testing',
      executable: path.join(root, 'chrome-linux64', 'chrome'),
    }];
  }
  return [];
}

export function discoverIndependentHeadlessBrowsers({
  cacheRoot = path.join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  let entries;
  try {
    entries = readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(chromium|chromium_headless_shell)-(\d+)$/);
    if (!match) continue;
    const revision = Number(match[2]);
    for (const candidate of candidatePaths(cacheRoot, entry.name, platform, arch)) {
      candidates.push({ ...candidate, playwrightRevision: revision });
    }
  }
  const kindOrder = new Map([
    ['playwright-chrome-for-testing', 0],
    ['playwright-chromium', 1],
    ['playwright-chromium-headless-shell', 2],
  ]);
  return candidates.sort((left, right) => (
    right.playwrightRevision - left.playwrightRevision
    || (kindOrder.get(left.kind) ?? 99) - (kindOrder.get(right.kind) ?? 99)
    || left.executable.localeCompare(right.executable)
  ));
}

function executableKind(realPath) {
  if (realPath.includes('/Google Chrome.app/Contents/MacOS/Google Chrome')) return 'installed-stable-chrome';
  if (realPath.includes('/Google Chrome for Testing.app/')) return 'playwright-chrome-for-testing';
  if (path.basename(realPath) === 'chrome-headless-shell') return 'playwright-chromium-headless-shell';
  if (realPath.includes('/Chromium.app/')) return 'playwright-chromium';
  return 'explicit-browser';
}

function inspectExecutable(executable, descriptor = {}) {
  let realPath;
  let stats;
  try {
    accessSync(executable, constants.X_OK);
    stats = statSync(executable);
    if (!stats.isFile()) throw new Error('path is not a file');
    realPath = realpathSync(executable);
  } catch (error) {
    throw new Error(`Browser path is not an executable file: ${executable} (${error.message})`);
  }
  const kind = descriptor.kind || executableKind(realPath);
  return {
    executable,
    realPath,
    kind,
    playwrightRevision: descriptor.playwrightRevision ?? null,
    installedStableChrome: kind === 'installed-stable-chrome',
    fileIdentity: {
      device: stats.dev,
      inode: stats.ino,
      sizeBytes: stats.size,
      modifiedMs: stats.mtimeMs,
    },
  };
}

function requireIndependentBrowser(effective) {
  if (effective.installedStableChrome) {
    throw new Error(
      `Installed stable Chrome is forbidden for headless capture: ${effective.realPath}. `
      + 'Use Chrome for Testing, Playwright Chromium, or chrome-headless-shell.',
    );
  }
  return effective;
}

export function resolveHeadlessBrowser({
  cliExecutable = null,
  envExecutable = null,
  candidates = null,
  cacheRoot,
  platform,
  arch,
} = {}) {
  const request = headlessBrowserRequest({ cliExecutable, envExecutable });
  if (request.executable) {
    const effective = requireIndependentBrowser(inspectExecutable(request.executable));
    return {
      schema: HEADLESS_BROWSER_RESOLUTION_SCHEMA,
      request,
      effective,
      fallbackPolicy: 'explicit-independent-override-or-fail-no-stable-chrome',
      rejectedCandidates: [],
    };
  }

  const independentCandidates = candidates || discoverIndependentHeadlessBrowsers({
    cacheRoot,
    platform,
    arch,
  });
  const rejectedCandidates = [];
  for (const candidate of independentCandidates) {
    try {
      const effective = requireIndependentBrowser(inspectExecutable(candidate.executable, candidate));
      return {
        schema: HEADLESS_BROWSER_RESOLUTION_SCHEMA,
        request,
        effective,
        fallbackPolicy: 'independent-artifact-or-fail-no-stable-chrome',
        rejectedCandidates,
      };
    } catch (error) {
      rejectedCandidates.push({ ...candidate, reason: error.message });
    }
  }
  throw new Error(
    'No executable independent headless browser was found; installed stable Chrome fallback is forbidden. '
    + `Candidates: ${JSON.stringify(rejectedCandidates)}`,
  );
}
