"""Capture one actual SLat forward on source-ordered support; no whole pipeline."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
import numpy as np

def load_sibling(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

flow_export = load_sibling('sparse_flow_export', 'export-sparse-flow.py')
digest = flow_export.digest

def matched_slat_noise(coords, *, seed, resolution=32):
    if coords.dtype != np.int32 or coords.ndim != 2 or coords.shape[1] != 3 or len(coords) == 0:
        raise ValueError('complete nonempty int32[N,3] coordinates required')
    if np.any(coords < 0) or np.any(coords >= resolution):
        raise ValueError('coordinates outside source grid')
    order = np.lexsort((coords[:,2], coords[:,1], coords[:,0]))
    if not np.array_equal(order, np.arange(len(coords))) or (len(coords)>1 and np.any(np.all(coords[1:]==coords[:-1],axis=1))):
        raise ValueError('strict source lexicographic coordinate identity required')
    return np.random.default_rng(seed).standard_normal((len(coords),32), dtype=np.float32)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('repo-root','source-root','checkpoint','coordinate-fixture','conditioning','out'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--expected-commit',required=True)
    parser.add_argument('--mode',choices=('shape','texture'),required=True)
    parser.add_argument('--seed',type=int,required=True)
    parser.add_argument('--concat',type=Path)
    parser.add_argument('--concat-coordinates',type=Path)
    args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    report={'schema':'trellis2.slat-flow-reference.v0','status':'failed','phase':'source','tensors':{},
        'fullModelAttempts':0,'fullModelExecutions':0,'blocksExecuted':0,
        'referenceRoute':'pinned-MLX-GPU-full-SLat/fast-SDPA/two-pass-LN/mlx-sum-QK/real-RoPE/source-BF16-GELU/F32-terminal',
        'inputHandoff':'offline source support and image conditioning; explicitly matched NumPy noise, not live sampler generation'}
    started=time.perf_counter()
    try:
        git=lambda root,*a:subprocess.check_output(['git','-C',str(root),*a],text=True).strip()
        root=args.source_root.resolve()
        for name,base in [('source',root),('producer',args.repo_root)]:
            report[name]={'root':str(base.resolve()),'commit':git(base,'rev-parse','HEAD'),'dirty':git(base,'status','--porcelain')}
        if report['source']['dirty'] or report['producer']['dirty'] or report['producer']['commit']!=args.expected_commit:
            raise ValueError('clean exact source/producer required')
        for file in ('generate.py','trellmlx/models/slat_flow.py','trellmlx/models/sparse_structure_flow.py',
            'trellmlx/modules/rope.py','trellmlx/modules/attention.py','trellmlx/modules/norm.py',
            'trellmlx/shape_flow_layernorm.py','trellmlx/weight_loader.py','trellmlx/source_cuda_gelu.py'):
            report['source'][file]=digest(root/file)
        report['producer']['scriptSha256']=digest(Path(__file__))
        report['phase']='input-admission'
        manifest_file=args.coordinate_fixture/'manifest.json';m=json.loads(manifest_file.read_text())
        if m.get('schema')!='trellis2.occupancy-coordinate-reference.v0' or m.get('status')!='succeeded' or m.get('source',{}).get('commit')!=report['source']['commit'] or m.get('source',{}).get('dirty')!='' or m.get('threshold')!=0 or m.get('coordinateOrder')!='z-y-x-lexicographic':
            raise ValueError('observed matching source occupancy coordinates required')
        def admitted(name,dtype):
            row=m['tensors'][name];p=args.coordinate_fixture/row['file']
            if Path(row['file']).name!=row['file'] or row['dtype']!=str(np.dtype(dtype)) or p.stat().st_size!=row['byteLength'] or digest(p)!=row['sha256']:
                raise ValueError('changed/partial source coordinate fixture '+name)
            values=np.fromfile(p,dtype=dtype)
            if values.size!=np.prod(row['shape']):raise ValueError('incomplete source shape '+name)
            return values.reshape(row['shape'])
        coords=admitted('expected.coordinates','<i4');logits=admitted('logits','<f4')
        if m['config']['resolution']!=64 or logits.shape!=(1,1,64,64,64):raise ValueError('selected512 source needs full64-cubed occupancy')
        sample=matched_slat_noise(coords,seed=args.seed)
        derived,_=load_sibling('decoder_export','export-sparse-decoder.py').source_occupancy_coordinates(logits)
        if not np.array_equal(derived,coords):raise ValueError('support does not match recorded source occupancy')
        with np.load(args.conditioning,allow_pickle=False) as data:condition=np.asarray(data['cond'],dtype=np.float32)
        if condition.shape!=(1,1029,1024) or not np.isfinite(condition).all():raise ValueError('full finite saved positive DINO conditioning required')
        report['conditioning']={'path':str(args.conditioning.resolve()),'sha256':digest(args.conditioning)}
        report['coordinates']={'manifest':str(manifest_file.resolve()),'manifestSha256':digest(manifest_file),
            'coordinateOrder':m['coordinateOrder'],'sourceCommit':m['source']['commit'],
            'tensorSha256':m['tensors']['expected.coordinates']['sha256'],'logitsSha256':m['tensors']['logits']['sha256']}
        report['config']={'tokenRows':len(coords),'mode':args.mode,'channels':1536,'heads':12,'contextChannels':1024,
            'contextRows':1029,'hidden':8192,'frequencyDim':256,'numBlocks':30}
        report['timeConvention']={'captureSpace':'normalized-sampler-time','captureValue':1,'modelMultiplier':1000,'modelValue':1000,'modelDtype':'float32'}
        def save(name,values,**extra):
            values=np.asarray(values,dtype='<i4' if name=='coordinates' else '<f4',order='C')
            if name!='gelu' and not np.isfinite(values).all():raise ValueError('nonfinite tensor '+name)
            file=args.out/(name+'.bin');values.tofile(file)
            report['tensors'][name]={'file':file.name,'shape':list(values.shape),'dtype':str(values.dtype),
                'byteLength':values.nbytes,'sha256':digest(file),**extra}
        save('coordinates',coords);save('logits',logits);save('sample',sample);save('timestep',np.array([1000],dtype=np.float32))
        save('conditioning',condition.reshape(1029,1024))
        report['sample']={'generator':'numpy-PCG64-standard-normal-f32','seed':args.seed,'sha256':report['tensors']['sample']['sha256'],
            'claim':'controlled shared input, not MLX random-stream equivalence'}
        concat=None
        if args.mode=='texture':
            if not args.concat or not args.concat_coordinates:raise ValueError('texture requires explicit normalized shape bytes and matching coordinate bytes')
            concat=np.fromfile(args.concat,dtype='<f4')
            if concat.size!=len(coords)*32 or not np.isfinite(concat).all() or digest(args.concat_coordinates)!=report['coordinates']['tensorSha256']:
                raise ValueError('texture condition must preserve complete normalized shape and coordinate identity')
            concat=concat.reshape(len(coords),32);save('concatConditioning',concat)
            report['concatConditioning']={'path':str(args.concat.resolve()),'sha256':digest(args.concat),
                'coordinateTensorSha256':digest(args.concat_coordinates),'arithmetic':'normalized-shape-latent-f32'}
        elif args.concat or args.concat_coordinates:raise ValueError('shape has no texture concatenation input')
        report['phase']='checkpoint-export'
        config_file=args.checkpoint.with_suffix('.json');checkpoint_config=json.loads(config_file.read_text())
        expected_in=64 if args.mode=='texture' else 32
        config_args=checkpoint_config.get('args',{})
        for key,value in {'resolution':32,'in_channels':expected_in,'out_channels':32,'model_channels':1536,'cond_channels':1024,
            'num_blocks':30,'num_heads':12,'dtype':'bfloat16','pe_mode':'rope','share_mod':True,'qk_rms_norm':True,'qk_rms_norm_cross':True}.items():
            if config_args.get(key)!=value:raise ValueError('source checkpoint config mismatch '+key)
        if checkpoint_config.get('name')!='SLatFlowModel':raise ValueError('source checkpoint model class mismatch')
        report['checkpoint']={'path':str(args.checkpoint.resolve()),'sha256':digest(args.checkpoint),
            'config':str(config_file.resolve()),'configSha256':digest(config_file),'mode':args.mode,'variant':'512-bf16'}
        mapping={**{'prefix.'+k:v for k,v in flow_export.PREFIX_KEYS.items()},
            **{f'block{i}.{k}':f'blocks.{i}.{v}' for i in range(30) for k,v in flow_export.BLOCK_KEYS.items()},
            'terminal.weight':'out_layer.weight','terminal.bias':'out_layer.bias'}
        with args.checkpoint.open('rb') as file:
            length=struct.unpack('<Q',file.read(8))[0];header=json.loads(file.read(length))
            if set(header)-{'__metadata__'}!=set(mapping.values()):raise ValueError('complete source SLat parameter coverage required')
            for name,key in mapping.items():
                row=header[key];a,b=row['data_offsets'];file.seek(8+length+a);raw=file.read(b-a)
                if len(raw)!=b-a:raise ValueError('partial checkpoint '+key)
                if row['dtype']=='BF16':values=(np.frombuffer(raw,dtype='<u2').astype('<u4')<<16).view('<f4')
                elif row['dtype']=='F32':values=np.frombuffer(raw,dtype='<f4')
                else:raise ValueError('unsupported SLat precision '+row['dtype'])
                save(name,values.reshape(row['shape']),checkpointKey=key,checkpointDtype=row['dtype'],checkpointTensorSha256=hashlib.sha256(raw).hexdigest())
        os.environ['TRELLIS2MLX_ATTENTION_BACKEND']='fast';os.environ['TRELLIS2MLX_QK_NORM_BACKEND']='mlx-sum'
        sys.path.insert(0,str(root));import mlx.core as mx;import mlx.utils
        from trellmlx.models.slat_flow import SLatFlowModel,_shape_shared_modulation
        from trellmlx.modules.attention import qk_norm_backend_identity
        from trellmlx.modules.rope import rope_backend_identity
        from trellmlx.shape_flow_layernorm import shape_flow_layernorm_backend_identity
        from trellmlx.weight_loader import load_weights,_remap_key
        model=SLatFlowModel.for_shape() if args.mode=='shape' else SLatFlowModel.for_texture()
        if set(dict(mlx.utils.tree_flatten(model.parameters())))!={_remap_key(k) for k in header if k!='__metadata__'}:
            raise ValueError('source constructor/checkpoint coverage mismatch')
        if load_weights(model,str(args.checkpoint),verbose=False):raise ValueError('source loader skipped SLat parameters')
        report['effectiveBackend']={'device':str(mx.default_device()),'attention':'fast','qk':qk_norm_backend_identity(),
            'rope':rope_backend_identity(),'layernorm':shape_flow_layernorm_backend_identity(),
            'terminal':model.terminal_linear_backend_identity(len(coords))}
        if mx.default_device()!=mx.gpu or report['effectiveBackend']['layernorm']['backend']!='mlx-two-pass' or report['effectiveBackend']['rope']['backend']!='mlx-real':
            raise ValueError('selected source SLat effective route changed')
        freqs=np.arange(21,dtype=np.float32)/21;freqs=1.0/(10000**freqs);save('rope.frequencies',freqs)
        phases=model._coords_to_rope_phases(mx.array(coords));mx.eval(phases);save('expected.phases',np.asarray(phases))
        table_path=root/'trellmlx/models/source_cuda_bf16_gelu_tanh_table.npy';table=np.load(table_path,allow_pickle=False)
        if table.shape!=(65536,) or table.dtype!=np.uint16:raise ValueError('source BF16 GELU table mismatch')
        report['geluSource']={'path':str(table_path),'sha256':digest(table_path)};save('gelu',(table.astype('<u4')<<16).view('<f4'))
        report['phase']='full-SLat-forward';terminal={};original=model._final_projection
        def observe(x,dtype):
            normalized,prediction=original(x,dtype);terminal.update(hidden=x,normalized=normalized);return normalized,prediction
        model._final_projection=observe;report['fullModelAttempts']=1
        try:
            prediction=model(mx.array(sample),mx.array([1000],dtype=mx.float32),mx.array(condition),coords=mx.array(coords),
                concat_cond=None if concat is None else mx.array(concat));mx.eval(prediction,*terminal.values())
        finally:model._final_projection=original
        report['fullModelExecutions']=1;report['blocksExecuted']=len(model.blocks)
        save('expected.prediction',np.asarray(prediction))
        for name,value in terminal.items():save('expected.'+name,np.asarray(value.astype(mx.float32)),arithmetic='bfloat16' if name=='hidden' else'float32')
        model_input=sample if concat is None else np.concatenate((sample,concat),axis=-1)
        projected=model.input_layer(mx.array(model_input)).astype(mx.bfloat16)
        modulation=_shape_shared_modulation(mx.array([1000],dtype=mx.float32),model.t_embedder,model.adaLN_modulation,mx.bfloat16)
        mx.eval(projected,modulation);save('expected.projected',np.asarray(projected.astype(mx.float32)));save('expected.modulation',np.asarray(modulation.astype(mx.float32)))
        report['phase']='post-source-admission'
        for name,base in [('source',root),('producer',args.repo_root)]:
            report[name+'After']={'commit':git(base,'rev-parse','HEAD'),'dirty':git(base,'status','--porcelain')}
            if report[name+'After']['commit']!=report[name]['commit'] or report[name+'After']['dirty']:raise ValueError(name+' changed during source forward')
        report['status']='succeeded';report['phase']=None
    except Exception as error:report['error']={'type':type(error).__name__,'message':str(error)};raise
    finally:
        report['elapsedSeconds']=time.perf_counter()-started
        (args.out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'status':report['status'],'phase':report['phase'],'report':str(args.out/'manifest.json')}))

if __name__=='__main__':main()
