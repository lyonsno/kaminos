"""Discover trusted, owner-authored modules in an explicitly selected checkout."""

import argparse
import json
from pathlib import Path
from urllib.parse import quote


def discover_experiments(repo_root, directory='workbench-experiments'):
    root = Path(repo_root).resolve(strict=True)
    directory = (root / directory).resolve()
    if not directory.is_relative_to(root):
        raise ValueError('Experiment directory must be within the served checkout')
    if not directory.exists():
        return []
    if not directory.is_dir():
        raise ValueError('Experiment contribution path must be a directory')
    modules = []
    for path in sorted(directory.rglob('*.experiment.mjs')):
        if not path.resolve(strict=True).is_relative_to(root):
            raise ValueError(f'Experiment module outside served checkout: {path}')
        if path.is_file():
            modules.append('/' + quote(path.relative_to(root).as_posix(), safe='/'))
    return modules


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', required=True)
    parser.add_argument('--directory', default='workbench-experiments')
    args = parser.parse_args()
    print(json.dumps(discover_experiments(args.repo_root, args.directory)))
