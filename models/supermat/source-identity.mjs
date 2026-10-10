// Source identity for serialized SuperMat jobs: the checkout a job serves and
// measures must stay at the requested commit, clean, for the whole job.
import { execFileSync } from 'node:child_process';

export const SOURCE_SCOPE = ['models/supermat', 'webgpu-inference-kit/src'];

export function readSource(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  return { commit: git(['rev-parse', 'HEAD']).trim(), dirty: git(['status', '--porcelain', '--', ...SOURCE_SCOPE]) };
}

export function assertSource(root, expected, when) {
  const source = readSource(root);
  if (source.commit !== expected) throw new Error(`source moved ${when}: HEAD ${source.commit}, expected ${expected}`);
  if (source.dirty) throw new Error(`source dirty ${when}: ${source.dirty.trim().split('\n').slice(0, 5).join('; ')}`);
  return source;
}
