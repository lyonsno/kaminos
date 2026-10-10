"""Stage packed FLUX.2 Klein weights as a Hugging Face model repository folder.

Layout (what the browser page reads from a weights base URL):
  te/   text-encoder bundles, token-embedding table, tokenizer.json, manifest.json
  dit/  transformer bundles and manifest.json
  vae/  VAE decoder bundle and manifest.json
  LICENSE, README.md, staged-files.json

Weight files are hard-linked from the packed directories (no copy). Manifests are rewritten
so `source` names the upstream repository and revision instead of a local path. Nothing is
uploaded; staged-files.json lists every file with size and sha256 for review.

  python stage-hf-repo.py --te <dir> --dit <dir> --vae <dir> --license <LICENSE> --out <dir> \
      --repo-id <org/name> --readme <README.md>
"""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

from importlib import import_module

source_identity = import_module('pack-transformer').source_identity


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 24), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for name in ('te', 'dit', 'vae'):
        ap.add_argument(f'--{name}', required=True)
    ap.add_argument('--license', required=True)
    ap.add_argument('--readme', required=True)
    ap.add_argument('--repo-id', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    for name in ('te', 'dit', 'vae'):
        src, dst = Path(getattr(args, name)), out / name
        dst.mkdir()
        manifest = json.loads((src / 'manifest.json').read_text())
        source = manifest.get('source')
        if isinstance(source, str):
            manifest['source'] = source_identity(source)
        if any(str(v).startswith('/') for v in manifest['source'].values()):
            raise SystemExit(f'{name}: manifest source still names a local path')
        (dst / 'manifest.json').write_text(json.dumps(manifest, indent=1))
        for f in src.iterdir():
            if f.name == 'manifest.json' or f.name.startswith('.'):
                continue
            os.link(f, dst / f.name)

    shutil.copyfile(args.license, out / 'LICENSE')
    shutil.copyfile(args.readme, out / 'README.md')
    rows = []
    for f in sorted(p for p in out.rglob('*') if p.is_file()):
        rows.append({'path': str(f.relative_to(out)), 'bytes': f.stat().st_size, 'sha256': sha256_file(f)})
    (out / 'staged-files.json').write_text(json.dumps({'repo_id': args.repo_id, 'files': rows,
                                                       'total_bytes': sum(r['bytes'] for r in rows)}, indent=1))
    print(len(rows), 'files', sum(r['bytes'] for r in rows), 'bytes')


if __name__ == '__main__':
    main()
