#!/usr/bin/env python3
"""Caller-owned corpus -> NVIDIA-shaped compact appearance -> native bundle."""
import argparse,json,pathlib,traceback,os,subprocess,hashlib,math
p=argparse.ArgumentParser();p.add_argument('config');p.add_argument('output');args=p.parse_args()
out=pathlib.Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
report={'status':'running','phase':'configuration','repoRoot':str(pathlib.Path.cwd()),'job':os.environ.get('GREENROOM_JOB_ID'),'configPath':args.config,'checkpoints':[],
        'claim':'Own fit of the NVIDIA released 8-latent/two-frame/2x16 architecture; direct texel optimization, one candidate, float32 MLX. Not the author pretrained specimens or full multi-instance trainer.'}
def publish():(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
publish()
try:
    if not report['job']:raise RuntimeError('Training requires Greenroom admission')
    report['sourceCommit']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    expected=os.environ.get('EXPECTED_COMMIT')
    if not expected or report['sourceCommit']!=expected:raise RuntimeError('Explicit pinned training source commit required')
    if subprocess.check_output(['git','status','--porcelain'],text=True).strip():raise RuntimeError('Training source is dirty')
    report['sourceHashes']={name:hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest() for name in ['tools/neural-appearance-fit.py','tools/neural_appearance_mlx.py','tools/neural-appearance-capture.mjs','neural-appearance.mjs']}
    config=json.loads(pathlib.Path(args.config).read_text());report['config']=config
    if config.get('capture'):
        report['phase']='capture';publish()
        subprocess.run(['node',str(pathlib.Path(__file__).with_name('neural-appearance-capture.mjs')),str(pathlib.Path(args.config).resolve()),str(out/'corpus')],check=True)
        corpus=out/'corpus'
    else:corpus=pathlib.Path(config['corpus']).resolve()
    import numpy as np
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    from neural_appearance_mlx import Appearance
    if not mx.metal.is_available():raise RuntimeError('Metal MLX runtime required; no CPU training fallback')
    mx.set_default_device(mx.gpu);report['backend']={'library':'mlx','device':str(mx.default_device()),'metalAvailable':True}
    options={'resolution':64,'steps':1000,'batch':1024,'seed':41,**config.get('fit',{})}
    report['options']=options
    for k in ['resolution','steps','batch','seed']:
        if not isinstance(options[k],int) or options[k]<(0 if k=='seed' else 1):raise ValueError('Invalid fit '+k)
    if options['batch']>options.get('queries',2**63):raise ValueError('Batch exceeds configured query pool')
    dataset=json.loads((corpus/'dataset.json').read_text());report['dataset']=dataset
    if dataset['response']!='projected-bsdf' or dataset['resolution']!=options['resolution']:raise ValueError('Corpus response convention/resolution differs from fit')
    def load(name,channels):
        entry=dataset[name];payload=(corpus/entry['file']).read_bytes()
        if hashlib.sha256(payload).hexdigest()!=entry['sha256']:raise ValueError('Corpus digest mismatch '+name)
        a=np.frombuffer(payload,dtype='<f4').reshape((-1,channels)).copy()
        if not np.isfinite(a).all():raise ValueError('Nonfinite corpus '+name)
        return mx.array(a)
    q,t,hq,ht=load('queries',8),load('labels',3),load('heldoutQueries',8),load('heldoutLabels',3)
    if q.shape[0]!=t.shape[0] or hq.shape[0]!=ht.shape[0] or not len(q) or not len(hq):raise ValueError('Corpus row mismatch')
    if options['batch']>len(q):raise ValueError('Batch exceeds retained query pool')
    model=Appearance(options['resolution'],16,options['seed']);optimizer=optim.Adam(learning_rate=.001)
    # A robust log response loss lets bright specular samples contribute
    # without making unlit black samples dominate relative denominators.
    def loss(model,queries,labels):return mx.mean(mx.abs(mx.log1p(model(queries))-mx.log1p(labels)))
    update=nn.value_and_grad(model,loss)
    def checkpoint(step):
        predicted=model(hq);error=loss(model,hq,ht);mx.eval(predicted,error)
        value=float(error.item())
        if not math.isfinite(value):raise ValueError('Nonfinite held-out loss')
        record={'step':step,'heldoutLogL1':value,**model.save_bundle(out/f'step-{step}',{'kind':'own-mlx-fit','dataset':str(corpus),'datasetIdentity':hashlib.sha256((corpus/'dataset.json').read_bytes()).hexdigest(),'teacher':dataset['teacher'],'step':step})}
        report['checkpoints'].append(record);np.asarray(predicted).astype('<f4').tofile(out/f'heldout-{step}.f32');publish();print(json.dumps(record),flush=True)
    report['phase']='fit';publish();checkpoint(0)
    for step in range(1,options['steps']+1):
        ids=mx.random.randint(0,len(q),(options['batch'],));value,grads=update(model,q[ids],t[ids]);optimizer.update(model,grads);mx.eval(model.parameters(),optimizer.state,value)
        if step%250==0 or step==options['steps']:checkpoint(step)
    if report['checkpoints'][-1]['heldoutLogL1']>=report['checkpoints'][0]['heldoutLogL1']:raise ValueError('Held-out response did not improve')
    report['status']='passed';report['phase']='complete'
except BaseException as error:
    report['status']='failed';report['error']=traceback.format_exc();raise
finally:publish()
