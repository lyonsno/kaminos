#!/usr/bin/env python3
"""Fit explicit UV footprints of an existing source; write a reusable map bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

import mlx.core as mx
import numpy as np

from fitted_reflectance import LAYOUT, fit_level
from neural_appearance_patterned_metal import PatternedMetal, filtered_response, reference_footprint


def run(args):
    out=Path(args.output).resolve()
    out.mkdir(parents=True,exist_ok=True)
    report={'status':'running','phase':'admission','source':str(Path(args.source).resolve()),
            'backend':'MLX Metal','job':os.getenv('GREENROOM_JOB_ID'),'levels':[]}
    def save():
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    def sha(data):
        return hashlib.sha256(data).hexdigest()
    save()
    try:
        if not report['job'] or not mx.metal.is_available():
            raise RuntimeError('Greenroom admission and Metal required')
        report['commit']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
        if report['commit']!=os.getenv('EXPECTED_COMMIT') or subprocess.check_output(['git','status','--porcelain'],text=True).strip():
            raise RuntimeError('Pinned clean source required')
        source=Path(args.source)
        if sha(source.read_bytes())!=args.source_sha256:
            raise ValueError('Reference manifest digest mismatch')
        if args.levels!=sorted(set(args.levels),reverse=True):
            raise ValueError('Choose unique levels, largest first')
        footprints=[reference_footprint(level) for level in args.levels]
        mx.set_default_device(mx.gpu)
        report.update(phase='load-source',sourceSha256=args.source_sha256,mlx=mx.__version__,
                      settings={'pairs':args.pairs,'steps':args.steps,'seed':args.seed,'chunk':args.chunk})
        save()
        teacher=PatternedMetal(source)
        for size,fp in zip(args.levels,footprints):
            report['phase']=f'fit-{size}';save()
            rng=np.random.default_rng(args.seed)
            def evaluate(q):
                return filtered_response(teacher.evaluate,q,rng,fp)
            fitted,error=fit_level(evaluate,size,steps=args.steps,pairs=args.pairs,chunk=args.chunk,seed=args.seed)
            raw=fitted.astype('<f4').tobytes();name=f'fit-{size}.f32';(out/name).write_bytes(raw)
            report['levels'].append({'size':size,'url':name,'sha256':sha(raw),'heldOutLogL1':error,'footprint':fp})
            save()
        bundle={'schema':'kaminos.fitted-reflectance.v1','layout':LAYOUT,'sourceSha256':args.source_sha256,
                'response':'projected-bsdf','filtering':'nearest-authored-texel-mip','levels':report['levels']}
        payload=(json.dumps(bundle,indent=2)+'\n').encode();(out/'fitted.model').write_bytes(payload)
        report.update(status='passed',phase='complete',bundleSha256=sha(payload))
    except BaseException:
        report.update(status='failed',error=traceback.format_exc())
        raise
    finally:
        save()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source');p.add_argument('source_sha256');p.add_argument('output')
    p.add_argument('--levels',nargs='+',type=int,required=True)
    p.add_argument('--pairs',type=int,required=True)
    p.add_argument('--steps',type=int,required=True)
    p.add_argument('--chunk',type=int,required=True)
    p.add_argument('--seed',type=int,default=41)
    run(p.parse_args())
