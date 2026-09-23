import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';

function git(root, args, { encoding = 'utf8', maxBuffer = 1024 * 1024 } = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding, maxBuffer });
}

export function assertCleanGitCheckout(root, expectedRevision) {
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (expectedRevision && expectedRevision !== head) {
    throw new Error(`source revision mismatch: requested ${expectedRevision}, effective HEAD ${head}`);
  }
  if (status.length !== 0) {
    throw new Error(`source checkout is dirty; refusal to label the run with HEAD ${head}: ${JSON.stringify(status)}`);
  }
  return { head, clean: true, porcelain: status };
}

export function createSourceByteReceipt({ root, sourceRevision, repoPath, servedBytes }) {
  if (!sourceRevision || !/^[0-9a-f]{40,64}$/i.test(sourceRevision)) {
    throw new Error(`source revision must be a full Git object id, got ${sourceRevision || 'missing'}`);
  }
  if (typeof repoPath !== 'string' || repoPath.startsWith('/') || repoPath.split('/').includes('..')) {
    throw new Error(`source path must be a repository-relative path: ${repoPath}`);
  }
  const source = Buffer.from(servedBytes);
  const committedBytes = git(root, ['show', `${sourceRevision}:${repoPath}`], { encoding: null, maxBuffer: 128 * 1024 * 1024 });
  if (!source.equals(committedBytes)) {
    throw new Error(`served source bytes differ from ${sourceRevision}:${repoPath}`);
  }
  const gitBlob = git(root, ['rev-parse', `${sourceRevision}:${repoPath}`]).trim();
  return {
    path: repoPath,
    sourceRevision,
    gitBlob,
    sha256: createHash('sha256').update(source).digest('hex'),
    byteLength: source.byteLength,
    matchesCommittedBytes: true,
  };
}
