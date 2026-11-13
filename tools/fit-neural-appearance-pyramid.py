#!/usr/bin/env python3
"""Measured continuation of one verified PatternedMetal checkpoint."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import traceback
from time import perf_counter

import mlx.core as mx
import numpy as np

from neural_appearance_patterned_metal import PatternedMetal, filtered_response, reference_footprint, reference_queries
from neural_appearance_pyramid import checkpoint_digest, fit_level, load_parent, write_bundle


def run(a):
    out=a.output.resolve()
    out.mkdir(parents=True,exist_ok=False)
    job=os.environ.get('GREENROOM_JOB_ID')
    report={'status':'running','phase':'admission','job':job,'backend':None,
            'settings':{'steps':a.steps,'batch':a.batch,'learningRate':a.rate,'seed':a.seed},'levels':[]}
    start=perf_counter()
    def save():
        target=out/'report.tmp'
        target.write_text(json.dumps(report,indent=2)+'\n')
        target.replace(out/'report.json')
    save()
    try:
        repo=Path(__file__).resolve().parents[1]
        def git(*argv):return subprocess.check_output(['git',*argv],cwd=repo,text=True).strip()
        commit=git('rev-parse','HEAD')
        if not job or commit!=os.environ.get('EXPECTED_COMMIT') or git('status','--porcelain'):
            raise ValueError('Greenroom admission from the pinned clean worktree is required')
        if not mx.metal.is_available():raise RuntimeError('MLX Metal required')
        if checkpoint_digest(a.source.read_bytes())!=a.source_sha:
            raise ValueError('Source manifest digest mismatch')
        mx.set_default_device(mx.gpu)
        report.update(phase='load-teacher-parent',backend=str(mx.default_device()),commit=commit,mlx=mx.__version__,
                      sourceSha256=a.source_sha,parentSha256=a.parent_sha)
        save()
        doc,fine,fine_codes=load_parent(a.parent,a.parent_sha,a.source_sha)
        if fine_codes.shape[0]!=512 or doc['kaminos']['provenance']['step']!=100000:
            raise ValueError('Expected a 512-square 100,000-step production parent')
        report['decoder']=doc['decoder']['hidden_layers']
        teacher=PatternedMetal(a.source)
        trained=[]
        for size,steps in zip((256,128),a.steps,strict=True):
            footprint=reference_footprint(size)
            seed=a.seed+size
            train_rng=np.random.default_rng(seed)
            held_rng=np.random.default_rng(seed+1)
            report['phase']=f'heldout-{size}';save()
            hq=reference_queries(held_rng,4096,size)
            hy=np.asarray(filtered_response(teacher.evaluate,hq,held_rng,footprint,reference=True))
            np.savez(out/f'heldout-{size}.npz',query=hq,response=hy)
            record={'size':size,'footprint':footprint,'seed':seed,'stepsRequested':steps}
            report['levels'].append(record)
            report['phase']=f'fit-{size}';save()
            def batch(_):
                q=reference_queries(train_rng,a.batch,size)
                return q,filtered_response(teacher.evaluate,q,train_rng,footprint)
            def checkpoint(step,codes,stats):
                payload=codes.astype('<f4').tobytes()
                path=out/f'latents-{size}-step-{step}.f32'
                path.write_bytes(payload)
                record.setdefault('checkpoints',[]).append({'step':step,'path':path.name,'sha256':checkpoint_digest(payload),**stats})
                save()
            codes,stats=fit_level(doc,fine_codes,size,batch,(hq,hy),steps=steps,learning_rate=a.rate,on_checkpoint=checkpoint)
            trained.append((size,codes));record.update(stats)
            save()
        report['phase']='export';save()
        write_bundle(out,doc,fine,trained,a.parent_sha,{'run':job,'sourceCommit':commit,
                     'levelTraining':[{'size':r['size'],'footprint':r['footprint'],'steps':r['stepsRequested']} for r in report['levels']]})
        report.update(status='passed',phase='complete',bundleSha256=checkpoint_digest((out/'model.model').read_bytes()))
    except BaseException:
        report.update(status='failed',error=traceback.format_exc())
        raise
    finally:
        report['wallSeconds']=perf_counter()-start;save()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path);p.add_argument('source_sha')
    p.add_argument('parent',type=Path);p.add_argument('parent_sha')
    p.add_argument('output',type=Path)
    p.add_argument('--steps',type=int,nargs=2,required=True)
    p.add_argument('--batch',type=int,required=True)
    p.add_argument('--rate',type=float,default=.01)
    p.add_argument('--seed',type=int,default=41)
    run(p.parse_args())
