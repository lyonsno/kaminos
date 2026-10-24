"""Run all named HDR cases serially under one Greenroom admission."""
import argparse
import json
from pathlib import Path
from emlight_probe import main as probe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    suite = {'schema':'kaminos.inferred-lighting-suite.v1', 'status':'failed', 'cases':[]}
    try:
        cases = json.loads(args.manifest.read_text())['cases']
        ids = set()
        for case in cases:
            key = case['id']
            if not key or key in ('.', '..') or Path(key).name != key or key in ids:
                raise ValueError('case ids must be unique directory names')
            ids.add(key)
        for case in cases:
            directory = args.output_dir / case['id']
            entry = {'id':case['id'], 'label':case['label'], 'reportUrl':f"{case['id']}/lighting.json", 'status':'failed'}
            suite['cases'].append(entry)
            try:
                probe(['--source-root',args.source_root,'--checkpoint',args.checkpoint,
                       '--environment',case['path'],'--output-dir',str(directory),
                       '--label',case['label'],'--source-url',case['source'],
                       '--view-yaw',str(case.get('viewYaw', 0))])
                result = json.loads((directory / 'lighting.json').read_text())
                entry.update(status=result['status'], metrics=result['metrics'], environmentSha256=result['environmentSha256'])
            except Exception as error:
                entry['error'] = f'{type(error).__name__}: {error}'
        if not cases or any(c['status'] != 'complete' for c in suite['cases']):
            raise RuntimeError('lighting suite contains incomplete cases')
        suite['status'] = 'complete'
    except Exception as error:
        suite['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        (args.output_dir / 'suite.json').write_text(json.dumps(suite, indent=2)+'\n')


if __name__ == '__main__':
    main()
