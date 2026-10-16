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
    for n in ['original-plan', 'candidate-plan', 'original-frame', 'control', 'out']:
        parser.add_argument('--'+n, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--bundle')
    source.add_argument('--asset-cond', help='Trusted local upstream cond.npy; no forward capture required')
    parser.add_argument('--asset-key', help='Explicit skeleton key in --asset-cond')
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = {'status': 'failed', 'phase': 'input', 'argv': sys.argv}
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    paths = [Path(p).resolve() for p in [args.original_plan, args.candidate_plan, args.original_frame, args.control]]
    if args.bundle:
        bundle = Path(args.bundle).resolve()
        paths += [bundle/'demo.json', bundle/'demo.bin']
    else:
        paths += [Path(args.asset_cond).resolve()]
    try:
        report['inputs'] = {str(p): digest(p) for p in paths}
        old, new, old_frame, control = [json.loads(p.read_text()) for p in paths[:4]]
        if old_frame['source']['control']['sha256'] != digest(paths[3]):
            raise ValueError('original frame/control authentication mismatch')
        if old_frame['source']['plan']['sha256'] != digest(paths[0]):
            raise ValueError('original frame/plan authentication mismatch')
        if args.bundle:
            demo = json.loads(paths[4].read_text())
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
            names, parents = demo['skeleton']['jointNames'], demo['skeleton']['parents']
            conditioning_sha = demo['assetCondSha256']
        else:
            import numpy as np
            if not args.asset_key:
                raise ValueError('--asset-key required with --asset-cond')
            observed = np.load(paths[4],allow_pickle=True).item()[args.asset_key]
            names = list(observed['joint_names'])
            parents = [int(p) for p in observed['parents']]
            positions = np.asarray(observed['tpos_first_frame']).tolist()
            n = len(names)
            conditioning_sha = digest(paths[4])
        report['phase'] = 'derive'
        frame, candidate_control = derive_frame(old, new, old_frame, control,
            names, parents, positions)
        (out/'control.json').write_text(json.dumps(candidate_control, indent=2)+'\n')
        frame['source'] = {'control': {'path': str(out/'control.json'), 'sha256': digest(out/'control.json')},
            'plan': {'path': str(paths[1]), 'sha256': digest(paths[1])},
            'originalFrame': {'path': str(paths[2]), 'sha256': digest(paths[2])},
            ('canonicalBundle' if args.bundle else 'canonicalConditioning'): {'path': str(paths[4]), 'sha256': digest(paths[4])},
            'canonicalAssetSha256': conditioning_sha,
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

