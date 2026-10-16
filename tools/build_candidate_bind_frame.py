"""Build authenticated candidate frame/control inputs for existing binders."""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

from candidate_bind_frame import derive_frame


def main():
    parser = argparse.ArgumentParser()
    for n in ['original-plan', 'candidate-plan', 'original-frame', 'control', 'bundle', 'out']:
        parser.add_argument('--'+n, required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = {'status': 'failed', 'phase': 'input', 'argv': sys.argv}
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    paths = [Path(p).resolve() for p in [args.original_plan, args.candidate_plan, args.original_frame, args.control]]
    bundle = Path(args.bundle).resolve()
    paths += [bundle/'demo.json', bundle/'demo.bin']
    try:
        report['inputs'] = {str(p): digest(p) for p in paths}
        old, new, old_frame, control, demo = [json.loads(p.read_text()) for p in paths[:-1]]
        if old_frame['source']['control']['sha256'] != digest(paths[3]):
            raise ValueError('original frame/control authentication mismatch')
        if old_frame['source']['plan']['sha256'] != digest(paths[0]):
            raise ValueError('original frame/plan authentication mismatch')
        raw = paths[-1].read_bytes()
        if demo['sha256'] != digest(paths[-1]):
            raise ValueError('bundle binary digest mismatch')
        rest = next(a for a in demo['arrays'] if a['name'] == 'restPositions')
        n = demo['skeleton']['joints']
        if rest['dtype'] != 'float32' or rest['shape'] != [n, 3] or rest['byteLength'] != n*12:
            raise ValueError('invalid observed rest-position descriptor')
        start = rest['offset']
        if not isinstance(start, int) or start < 0 or start+n*12 > len(raw):
            raise ValueError('incomplete observed rest positions')
        flat = struct.unpack('<'+str(n*3)+'f', raw[start:start+n*12])
        positions = [list(flat[i:i+3]) for i in range(0, len(flat), 3)]
        report['phase'] = 'derive'
        frame, candidate_control = derive_frame(old, new, old_frame, control,
            demo['skeleton']['jointNames'], demo['skeleton']['parents'], positions)
        (out/'control.json').write_text(json.dumps(candidate_control, indent=2)+'\n')
        frame['source'] = {'control': {'path': str(out/'control.json'), 'sha256': digest(out/'control.json')},
            'plan': {'path': str(paths[1]), 'sha256': digest(paths[1])},
            'originalFrame': {'path': str(paths[2]), 'sha256': digest(paths[2])},
            'canonicalBundle': {'path': str(paths[4]), 'sha256': digest(paths[4])},
            'canonicalAssetSha256': demo['assetCondSha256'],
            'sourceSceneSha256': control['sourceSha256']}
        # Conditioning and canonical mesh are different identities.
        frame['source']['assetConditioningSha256'] = frame['source'].pop('canonicalAssetSha256')
        (out/'rig-frame.json').write_text(json.dumps(frame, indent=2)+'\n')
        if report['inputs'] != {str(p): digest(p) for p in paths}:
            raise ValueError('input changed during derivation')
        report.update(status='completed', phase='complete', bones=n,
            canonicalRestHeadMaxError=max(e['residualSourceNormalized'] for e in frame['canonicalRestHeadErrors']),
            outputs={p.name: digest(p) for p in out.iterdir() if p.is_file()})
    except Exception as e:
        report['error'] = repr(e)
        raise
    finally:
        (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()

