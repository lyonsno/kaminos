"""Parameterised invocation of the unchanged UniMate rig preprocessor in Blender."""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    for name in ('source','annotation','unimate-root','deps','out','name'):
        parser.add_argument('--'+name, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    output = Path(args.out).resolve()
    output.mkdir(parents=True, exist_ok=False)
    inputs = [Path(args.source).resolve(), Path(args.annotation).resolve()]
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    report = dict(status='failed', phase='input', argv=sys.argv, started=time.time())
    try:
        root = Path(args.unimate_root).resolve()
        report.update(source={str(p):digest(p) for p in inputs},
                      unimate_root=str(root),
                      unimate_revision=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip())
        sys.path.insert(0, args.deps)
        sys.path.insert(0, str(root))
        sys.path.append(str(root/'.venv/lib/python3.10/site-packages'))
        import bpy
        import numpy as np
        from data_process.rig_preprocess.pipeline import preprocess
        report.update(phase='preprocess', blender=bpy.app.version_string, numpy=np.__version__)
        summary = preprocess([str(inputs[0])], str(output/'asset'), profile='general',
                             name=args.name, annotation=str(inputs[1]),
                             keep_intermediate=True, review=False)
        report.update(phase='verify-output', summary=summary)
        cond = np.load(output/'asset/cond.npy',allow_pickle=True).item()[args.name]
        names = json.loads((output/'asset/work/export/joint_names.json').read_text())[args.name]
        expected = [j['raw'] for j in json.loads(inputs[1].read_text())['joints']]
        if len(names)!=len(expected) or set(names)!=set(expected) or len(cond['parents'])!=len(expected):
            raise ValueError('preprocessing changed joint inventory')
        if not summary['model_joint_limit']['fits']:
            raise ValueError('model joint capacity exceeded')
        if report['source'] != {str(p):digest(p) for p in inputs}:
            raise ValueError('preprocessing changed an input')
        report.update(status='completed',phase='complete',source_unchanged=True,
                      joint_count=len(names),raw_joint_names=names,
                      outputs={str(p.relative_to(output)):digest(p) for p in (output/'asset').iterdir() if p.is_file()})
        print(json.dumps(report))
    except Exception as exc:
        report['error'] = repr(exc)
        raise
    finally:
        report['elapsed_seconds'] = time.time()-report['started']
        (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__ == '__main__':
    main()
