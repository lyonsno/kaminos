"""CPU-only replay of the pinned coordinate policy; no MLX/model execution."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import numpy as np

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('repo-root', 'source-root', 'decoder-fixture', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--expected-commit', required=True)
    args = parser.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'trellis2.occupancy-coordinate-reference.v0', 'status': 'failed', 'phase': 'source',
        'modelCalls': 0, 'referenceRoute': 'numpy-cpu-source-occupancy-coordinate-policy', 'threshold': 0,
        'coordinateOrder': 'z-y-x-lexicographic', 'tensors': {}, 'inputHandoff': 'offline source logits, not live decoder composition'}
    digest = lambda file: hashlib.sha256(Path(file).read_bytes()).hexdigest()
    try:
        git = lambda root, *a: subprocess.check_output(['git', '-C', str(root), *a], text=True).strip()
        for name, folder in [('source', args.source_root), ('producer', args.repo_root)]:
            report[name] = {'root': str(folder.resolve()), 'commit': git(folder, 'rev-parse', 'HEAD'), 'dirty': git(folder, 'status', '--porcelain')}
        if report['source']['dirty'] or report['producer']['dirty'] or report['producer']['commit'] != args.expected_commit:
            raise ValueError('clean exact source and producer required')
        report['source']['generate.py'] = digest(args.source_root / 'generate.py')
        report['producer']['scriptSha256'] = digest(__file__)
        report['phase'] = 'source-logits-admission'
        manifest_path = args.decoder_fixture / 'manifest.json'; m = json.loads(manifest_path.read_text())
        if m.get('status') != 'succeeded' or m.get('schema') != 'trellis2.sparse-decoder-reference.v0' or m.get('source', {}).get('commit') != report['source']['commit']:
            raise ValueError('matching observed source decoder reference required')
        row = m['tensors']['expected.logits']; resolution = row['shape'][2]
        if row.get('dtype') != 'float32' or row['shape'] != [1, 1, resolution, resolution, resolution] or row.get('byteLength') != 4 * resolution ** 3 or Path(row['file']).name != row['file']:
            raise ValueError('complete source logit descriptor required')
        logits_path = args.decoder_fixture / row['file']
        if logits_path.stat().st_size != row['byteLength'] or digest(logits_path) != row['sha256']:
            raise ValueError('changed/partial source logits')
        report['input'] = {'decoderManifest': str(manifest_path.resolve()), 'decoderManifestSha256': digest(manifest_path),
            'logitsSha256': row['sha256'], 'sourceRoute': m['referenceRoute'], 'fixtureKind': m['fixtureKind']}
        report['config'] = {'resolution': resolution}
        spec = importlib.util.spec_from_file_location('decoder_export', Path(__file__).with_name('export-sparse-decoder.py'))
        source = importlib.util.module_from_spec(spec); spec.loader.exec_module(source)
        report['producer']['coordinatePolicySha256'] = digest(Path(__file__).with_name('export-sparse-decoder.py'))
        logits = np.fromfile(logits_path, dtype='<f4').reshape(row['shape'])
        coordinates, flags = source.source_occupancy_coordinates(logits)
        report['rows'] = len(coordinates); report['phase'] = 'save-complete-reference'
        for name, values in [('logits', logits), ('expected.coordinates', coordinates), ('expected.flags', flags)]:
            file = args.out / (name + '.bin'); values.tofile(file)
            report['tensors'][name] = {'file': file.name, 'shape': list(values.shape), 'dtype': str(values.dtype),
                'byteLength': values.nbytes, 'sha256': digest(file)}
        report['effectiveBackend'] = {'device': 'CPU', 'library': 'numpy', 'version': np.__version__,
            'policy': 'generate.py strict sign/reshape.any(axis1,3,5)/argwhere', 'modelExecutions': 0}
        for name, folder in [('source', args.source_root), ('producer', args.repo_root)]:
            if git(folder, 'rev-parse', 'HEAD') != report[name]['commit'] or git(folder, 'status', '--porcelain'):
                raise ValueError('source changed during coordinate replay')
        report['status'] = 'succeeded'; report['phase'] = None
    except Exception as error:
        report['error'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        (args.out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'phase': report['phase'], 'report': str(args.out / 'manifest.json')}))

if __name__ == '__main__':
    main()
