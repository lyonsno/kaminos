"""Export one source occupancy decode and reusable F32 weights, never generation."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import numpy as np

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as file:
        for chunk in iter(lambda:file.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def source_occupancy_coordinates(logits):
    """Pinned generate.py policy: strict sign, complete2³any, np.argwhere."""
    if logits.dtype != np.float32 or logits.ndim != 5 or logits.shape[:2] != (1, 1):
        raise ValueError('complete F32 cubic logits shape required')
    resolution = logits.shape[2]
    if resolution < 2 or resolution % 2 or logits.shape[2:] != (resolution,) * 3:
        raise ValueError('positive even cubic logits shape required')
    if not np.isfinite(logits).all():
        raise ValueError('finite occupancy logits required')
    small = resolution // 2
    decoded = logits[0, 0] > 0
    flags = decoded.reshape(small, 2, small, 2, small, 2).any(axis=(1, 3, 5))
    return np.argwhere(flags).astype(np.int32), flags.astype(np.uint32).reshape(-1)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('repo-root','source-root','out'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--expected-commit',required=True)
    parser.add_argument('--checkpoint',type=Path)
    parser.add_argument('--checkpoint-config',type=Path)
    parser.add_argument('--input-manifest',type=Path)
    parser.add_argument('--input-tensor',default='step11.sample')
    parser.add_argument('--synthetic',action='store_true')
    args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    report={'schema':'trellis2.sparse-decoder-reference.v0','status':'failed','phase':'source','modelCalls':0,
        'convolutionsExecuted':0,'tensors':{},'referenceRoute':'pinned-MLX-GPU-source-sparse-decoder/F32',
        'fixtureKind':'synthetic-operation-conformance' if args.synthetic else 'checkpoint-decoder',
        'inputHandoff':'artifact input for stage isolation, not live WebGPU composition'}
    started=time.perf_counter()
    try:
        git=lambda root,*items:subprocess.check_output(['git','-C',str(root),*items],text=True).strip()
        root=args.source_root.resolve();producer=args.repo_root.resolve()
        for name,folder in [('source',root),('producer',producer)]:
            report[name]={'root':str(folder),'commit':git(folder,'rev-parse','HEAD'),'dirty':git(folder,'status','--porcelain')}
        if report['source']['dirty'] or report['producer']['dirty'] or report['producer']['commit']!=args.expected_commit:
            raise ValueError('clean exact producer and source required')
        for name in ('trellmlx/models/sparse_structure_decoder.py','trellmlx/weight_loader.py'):
            report['source'][name]=digest(root/name)
        report['producer']['scriptSha256']=digest(__file__)
        report['phase']='input-admission'
        if args.synthetic:
            if any((args.checkpoint,args.checkpoint_config,args.input_manifest)):raise ValueError('synthetic conformance must not masquerade as checkpoint input')
            config={'resolution':2,'latentChannels':2,'outChannels':1,'channels':[4,2],'numResBlocks':1,'numResBlocksMiddle':1}
            sample=np.linspace(-1,1,16,dtype=np.float32).reshape(1,2,2,2,2)
            report['input']={'kind':'deterministic-synthetic','seed':42}
        else:
            if not all((args.checkpoint,args.checkpoint_config,args.input_manifest)):raise ValueError('checkpoint, checkpoint-config and input-manifest required')
            source_config=json.loads(args.checkpoint_config.read_text())
            if source_config.get('name')!='SparseStructureDecoder':raise ValueError('source SparseStructureDecoder config required')
            c=source_config['args'];config={'resolution':16,'latentChannels':c['latent_channels'],'outChannels':c['out_channels'],
                'channels':c['channels'],'numResBlocks':c['num_res_blocks'],'numResBlocksMiddle':c['num_res_blocks_middle']}
            if config!={'resolution':16,'latentChannels':8,'outChannels':1,'channels':[512,128,32],'numResBlocks':2,'numResBlocksMiddle':2}:
                raise ValueError('observed source checkpoint geometry required')
            manifest=json.loads(args.input_manifest.read_text())
            if manifest.get('status')!='succeeded' or manifest.get('schema')!='trellis2.sparse-sampler-trajectory-reference.v0' or manifest.get('source',{}).get('commit')!=report['source']['commit']:
                raise ValueError('matching complete source trajectory input required')
            row=manifest['tensors'][args.input_tensor]
            if row.get('dtype')!='float32' or row.get('shape')!=[1,8,16,16,16] or row.get('byteLength')!=131072 or Path(row['file']).name!=row['file']:
                raise ValueError('complete F32 latent descriptor required')
            path=args.input_manifest.parent/row['file']
            if path.stat().st_size!=row['byteLength'] or digest(path)!=row['sha256']:raise ValueError('partial/changed latent')
            sample=np.fromfile(path,dtype='<f4').reshape(row['shape'])
            report['input']={'manifest':str(args.input_manifest.resolve()),'manifestSha256':digest(args.input_manifest),
                'tensor':args.input_tensor,'sha256':row['sha256'],'sourceRoute':manifest['referenceRoute']}
            if args.checkpoint.suffix!='.safetensors':raise ValueError('named safetensors path required')
            report['checkpoint']={'path':str(args.checkpoint.absolute()),'resolvedPath':str(args.checkpoint.resolve()),'sha256':digest(args.checkpoint)}
            report['checkpointConfig']={'path':str(args.checkpoint_config.resolve()),'sha256':digest(args.checkpoint_config),'storedUseFp16':c.get('use_fp16')}
        if not np.isfinite(sample).all():raise ValueError('finite complete latent required')
        report['config']=config
        sys.path.insert(0,str(root))
        import mlx.core as mx
        from mlx.utils import tree_flatten
        from trellmlx.models.sparse_structure_decoder import SparseStructureDecoder,UpsampleBlock3d,ResBlock3d
        from trellmlx.weight_loader import load_weights,_remap_key
        if mx.default_device()!=mx.gpu:raise ValueError('actual MLX GPU source route required')
        report['phase']='model-load'
        model=SparseStructureDecoder(out_channels=config['outChannels'],latent_channels=config['latentChannels'],
            num_res_blocks=config['numResBlocks'],num_res_blocks_middle=config['numResBlocksMiddle'],channels=config['channels'])
        if args.synthetic:
            rng=np.random.default_rng(42);parameters={}
            for name,value in tree_flatten(model.parameters()):
                data=(np.ones(value.shape,dtype=np.float32) if '.norm' in name and name.endswith('.weight') or name=='out_layer_0.weight'
                    else np.zeros(value.shape,dtype=np.float32) if name.endswith('.bias') else rng.normal(0,.1,value.shape).astype(np.float32))
                parameters[name]=mx.array(data)
            model.load_weights(list(parameters.items()))
        else:
            from safetensors import safe_open
            with safe_open(str(args.checkpoint),framework='numpy') as checkpoint:
                expected=set(dict(tree_flatten(model.parameters())))
                if {_remap_key(key) for key in checkpoint.keys()}!=expected:raise ValueError('complete exact decoder parameter keys required')
            if load_weights(model,str(args.checkpoint),verbose=False):raise ValueError('complete decoder checkpoint required')
        parameters=dict(tree_flatten(model.parameters()))
        if any(value.dtype!=mx.float32 for value in parameters.values()):raise ValueError('source destination arithmetic differs from F32 decoder contract')
        values={'sample':sample};report['parameterCount']=sum(int(v.size) for v in parameters.values())
        for name,value in parameters.items():
            key=name.replace('out_layer_0.','out_layer.0.').replace('out_layer_2.','out_layer.2.')
            if value.ndim==5:value=value.transpose(0,4,1,2,3)
            values['weight.'+key]=np.asarray(value,dtype=np.float32)
        report['effectiveBackend']={'device':str(mx.default_device()),'arithmetic':'f32-channel-layernorm-silu-conv3d',
            'weightLayout':'source-checkpoint-OI-DHW','normEpsilon':1e-6,'checkpointCasting':'source constructors/destination loader float32',
            'sourceModel':'actual SparseStructureDecoder.__call__ with observation-only module wrappers'}
        captures={}
        class Observe:
            def __init__(self,module,name=None,incoming=False,conv=False):self.module,self.name,self.incoming,self.conv=module,name,incoming,conv
            def __call__(self,x):
                result=self.module(x)
                if self.conv:report['convolutionsExecuted']+=1
                if self.name:captures[self.name]=x if self.incoming else result
                return result
        model.input_layer=Observe(model.input_layer,'inputProjected',conv=True)
        for block in model.middle_block+model.blocks:
            if isinstance(block,ResBlock3d):
                block.conv1=Observe(block.conv1,conv=True);block.conv2=Observe(block.conv2,conv=True)
            elif isinstance(block,UpsampleBlock3d):block.conv=Observe(block.conv,conv=True)
        level=0
        for i,block in enumerate(model.blocks):
            if isinstance(block,UpsampleBlock3d):model.blocks[i]=Observe(block,f'level{level}',incoming=True);level+=1
        model.out_layer_0=Observe(model.out_layer_0,f'level{level}',incoming=True)
        model.out_layer_2=Observe(model.out_layer_2,conv=True)
        report['phase']='source-decode'
        logits=model(mx.array(sample));mx.eval(logits);report['modelCalls']=1
        expected_convs=2+2*(config['numResBlocksMiddle']+len(config['channels'])*config['numResBlocks'])+len(config['channels'])-1
        if report['convolutionsExecuted']!=expected_convs:raise ValueError('complete source convolution graph required')
        for name,value in captures.items():values['expected.'+name]=np.asarray(value,dtype=np.float32).reshape(-1,value.shape[-1])
        values['expected.logits']=np.asarray(logits,dtype=np.float32)
        report['occupiedCells']=int(np.count_nonzero(values['expected.logits']>0))
        report['phase']='output-export'
        for name,value in values.items():
            value=np.asarray(value,dtype='<f4',order='C')
            if not np.isfinite(value).all():raise ValueError('nonfinite decoder tensor '+name)
            file=args.out/(name+'.f32');value.tofile(file)
            report['tensors'][name]={'file':file.name,'shape':list(value.shape),'dtype':'float32','byteLength':value.nbytes,'sha256':digest(file)}
        report['phase']='post-source-admission'
        for name,folder in [('source',root),('producer',producer)]:
            state={'commit':git(folder,'rev-parse','HEAD'),'dirty':git(folder,'status','--porcelain')};report[name+'After']=state
            if state['commit']!=report[name]['commit'] or state['dirty']:raise ValueError(name+' changed during export')
        report.update(status='succeeded',phase=None)
    except Exception as error:report['error']={'type':type(error).__name__,'message':str(error)}
    finally:
        report['elapsedSeconds']=time.perf_counter()-started
        (args.out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'phase':report['phase'],'manifest':str(args.out/'manifest.json'),'error':report.get('error')}))
    return 0 if report['status']=='succeeded' else 1

if __name__=='__main__':sys.exit(main())
