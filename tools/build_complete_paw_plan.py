"""Write a fresh, source-authenticated complete-paw plan and label annotation."""
import argparse
import hashlib
import json
from pathlib import Path

from complete_paw_plan import complete_paws


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for name in ('plan', 'probe', 'annotation', 'out'):
        parser.add_argument('--'+name, required=True)
    args = parser.parse_args()
    inputs = [Path(p).resolve() for p in (args.plan,args.probe,args.annotation)]
    out = Path(args.out).resolve()
    if out.exists() or any(out == p.parent or out == p or out in p.parents for p in inputs):
        raise ValueError('choose a fresh output directory distinct from source directories')
    out.mkdir(parents=True)
    report = dict(status='failed', phase='source-authentication', inputs={}, requestedInputs=vars(args))
    try:
        report['inputs'] = {str(p):digest(p) for p in inputs}
        plan, probe, annotation = [json.loads(p.read_text()) for p in inputs]
        for path, expected in probe['source'].items():
            if digest(path) != expected:
                raise ValueError('anatomy probe source changed: '+path)
        report['phase'] = 'derive'
        candidate = complete_paws(plan,probe)
        raw = [j['raw'] for j in annotation['joints']]
        if len(set(raw)) != len(raw) or set(raw) != {j['name'] for j in plan['joints']}:
            raise ValueError('annotation/source joint inventory mismatch')
        # Preserve all existing semantic labels and facing conventions. Only the
        # four new endpoints acquire the corresponding existing-label + End.
        for j in candidate['joints']:
            if j['name'] not in raw:
                original = next(a for a in annotation['joints'] if a['raw'] == j['parent'])
                annotation['joints'].append({**original, 'index':len(annotation['joints']),
                    'raw':j['name'], 'parent':j['parent'], 'label':original['label']+' End'})
        (out/'joint-plan.json').write_text(json.dumps(candidate,indent=2)+'\n')
        (out/'unimate-annotation.json').write_text(json.dumps(annotation,indent=2)+'\n')
        if report['inputs'] != {str(p):digest(p) for p in inputs}:
            raise ValueError('source changed during derivation')
        report.update(status='completed',phase='complete',joints=len(candidate['joints']),
                      intervention=candidate['paw_intervention'],
                      outputs={p.name:digest(p) for p in out.iterdir() if p.is_file()})
    except Exception as exc:
        report['error'] = repr(exc)
        raise
    finally:
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
