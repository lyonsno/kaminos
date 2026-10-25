"""LiMo image probe assay; retained native outputs, not a live/browser port."""
import argparse
import gc
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
from PIL import Image
from diffusionlight_probe import require_mps, save_json
from emlight_probe import digest

SOURCE_REVISION='cf6a1fa84c808dfa810ca4acffabcec4c1de187d'
SUPPORT_REVISION='741f7c3ce8b383c54771c7003378a50191e9efe9'
CHECKPOINT_BYTES=23784654093
CONDITIONS=('image','position','normals','dist_to_sphere','dir_to_sphere')
TARGETS=('sphere_0','sphere_1')
EVS=(0,-3,-6,-9)


def conditioned_config(base):
    result=dict(base)
    if result['in_channels']!=64 or result.get('out_channels') not in (None,64):
        raise ValueError('expected FLUX output with 64 packed latent channels')
    result.update(in_channels=384,out_channels=64)
    return result


def packed_noise(pipe, width, height, generator, dtype, device):
    import torch
    scale=pipe.vae_scale_factor
    if width%(scale*2) or height%(scale*2):
        raise ValueError('dimensions must align with packed VAE latents')
    channels=pipe.transformer.config.out_channels//4
    noise=torch.randn((1,channels,height//scale,width//scale),generator=generator,
        device='cpu',dtype=dtype)
    return pipe._pack_latents(noise,1,channels,height//scale,width//scale).to(device)


def validate_pass(image, mask, effective_steps, requested_steps):
    if effective_steps!=requested_steps:
        raise ValueError('effective steps do not match requested steps')
    if image.ndim!=3 or image.shape[-1]!=3 or mask.shape!=image.shape[:2] or not mask.any():
        raise ValueError('invalid image or sphere mask')
    if not np.isfinite(image).all():
        raise ValueError('output must be finite')
    region=image[mask]
    if np.ptp(region)==0:
        raise ValueError('blank sphere output')
    if image.min()<0 or image.max()>1:
        raise ValueError('output outside normalized image range')
    return {'maskPixels':int(mask.sum()),'min':float(region.min()),
        'max':float(region.max()),'mean':float(region.mean())}


def support_files(metadata):
    if metadata['sha']!=SUPPORT_REVISION:
        raise ValueError('support revision mismatch')
    entries=[entry for entry in metadata['siblings'] if entry['rfilename'].startswith(
        ('text_encoder/','text_encoder_2/','tokenizer/','tokenizer_2/','vae/','scheduler/'))
        or entry['rfilename'] in ('transformer/config.json','model_index.json','README.md')]
    required={'model_index.json','transformer/config.json','scheduler/scheduler_config.json',
        'text_encoder/config.json','text_encoder/model.safetensors','text_encoder_2/config.json',
        'text_encoder_2/model.safetensors.index.json',
        'text_encoder_2/model-00001-of-00002.safetensors',
        'text_encoder_2/model-00002-of-00002.safetensors',
        'tokenizer/vocab.json','tokenizer/merges.txt','tokenizer_2/spiece.model',
        'vae/config.json','vae/diffusion_pytorch_model.safetensors'}
    if not required.issubset(entry['rfilename'] for entry in entries):
        raise ValueError('incomplete support manifest')
    return entries


def validate_assets(args):
    revision=subprocess.check_output(['git','-C',str(args.source_root),'rev-parse','HEAD'],text=True).strip()
    if revision!=SOURCE_REVISION:
        raise ValueError('LiMo source revision mismatch')
    dirty=subprocess.check_output(['git','-C',str(args.source_root),'status','--porcelain',
        '--untracked-files=no'],text=True)
    if dirty.strip(): raise ValueError('LiMo tracked source differs from pinned revision')
    if args.checkpoint.stat().st_size!=CHECKPOINT_BYTES:
        raise ValueError('incomplete LiMo checkpoint')
    files={}
    for entry in support_files(json.loads(args.metadata.read_text())):
        relative=entry['rfilename']; path=args.support/relative
        if path.stat().st_size!=entry['size']:
            raise ValueError(f'incomplete support file: {relative}')
        sha=digest(path)
        if entry.get('lfs') and sha!=entry['lfs']['sha256']:
            raise ValueError(f'support digest mismatch: {relative}')
        if entry.get('blobId') and not entry.get('lfs'):
            import hashlib
            data=path.read_bytes()
            blob=hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest()
            if blob!=entry['blobId']:
                raise ValueError(f'support Git blob mismatch: {relative}')
        files[relative]={'bytes':entry['size'],'sha256':sha}
    return {'sourceRevision':revision,'supportRevision':SUPPORT_REVISION,
        'checkpoint':{'path':str(args.checkpoint),'bytes':CHECKPOINT_BYTES,'sha256':digest(args.checkpoint)},
        'support':{'path':str(args.support),'files':files}}


def source_modules(root):
    sys.path[:0]=[str(root),str(root/'image')]
    dataset=importlib.import_module('datasets.dataset_spheres_test')
    if not Path(dataset.__file__).resolve().is_relative_to(root.resolve()):
        raise RuntimeError('wrong dataset module route')
    return (dataset,importlib.import_module('image.utils'),
        importlib.import_module('image.train_utils_min'),
        importlib.import_module('image.conditional_pipelines'))


def run(args, report, report_path):
    import torch
    from diffusers import FluxTransformer2DModel
    require_mps()
    def phase(name):
        report['phase']=name; save_json(report_path,report); print(name,flush=True)
    phase('source-and-asset-validation')
    report['assets']=validate_assets(args)
    report['adapterSha256']=digest(__file__)
    phase('scene-validation')
    dataset_module,source_utils,training,pipelines=source_modules(args.source_root)
    for name in ('image_0001.exr','position_0001.exr','camera_info.pkl',
        'sphere_0/mask_0001.exr','sphere_0/position_0001.exr','sphere_0/normal_0001.exr',
        'sphere_0/image_0001.exr','sphere_1/image_0001.exr'):
        path=args.scene/name
        if not path.is_file(): raise FileNotFoundError(path)
    import pyexr
    raw_mask=pyexr.read(str(args.scene/'sphere_0/mask_0001.exr'))[...,0]
    if not np.any(raw_mask==255): raise ValueError('scene has no sphere id255')
    report['scene']={'path':str(args.scene),'files':{
        str(path.relative_to(args.scene)):digest(path) for path in sorted(args.scene.rglob('*')) if path.is_file()}}
    config=dataset_module.SpheresDatasetConfig(data_dir=str(args.scene),
        augmentation_cfg=dataset_module.SpheresAugConfig())
    dataset=dataset_module.SpheresDataset(config,target_layers=list(TARGETS),split='test')
    batch=dataset[0]
    height,width=batch['image'].shape[-2:]
    mask=(batch['sphere_mask'][0].numpy()+1)/2>.5
    report['input']={'width':width,'height':height,'conditions':CONDITIONS,
        'maskPixels':int(mask.sum()),'scope':'official rendered fixture geometry; not inferred MoGe geometry'}
    Image.fromarray(np.uint8(((batch['image'].permute(1,2,0).numpy()+1)/2).clip(0,1)*255)).save(args.output_dir/'input.png')
    Image.fromarray(np.uint8(mask)*255).save(args.output_dir/'mask.png')
    phase('checkpoint-loading')
    with torch.device('meta'):
        transformer=FluxTransformer2DModel.from_config(conditioned_config(
            json.loads((args.support/'transformer/config.json').read_text())))
    checkpoint=torch.load(args.checkpoint,map_location='cpu',weights_only=True,mmap=True)
    state=checkpoint['module']
    report['checkpointTensorCount']=len(state)
    report['checkpointDtypes']=sorted({str(value.dtype) for value in state.values()})
    transformer.load_state_dict(state,strict=True,assign=True)
    del checkpoint,state
    phase('support-loading-and-prompts')
    pipe=pipelines.ConditionalFluxPipeline.from_pretrained(str(args.support),
        transformer=transformer,torch_dtype=torch.float16,local_files_only=True)
    encoders=[pipe.text_encoder.to('mps',dtype=torch.float16),pipe.text_encoder_2.to('mps',dtype=torch.float16)]
    tokenizers=[pipe.tokenizer,pipe.tokenizer_2]
    cfg=importlib.import_module('image.test_config').default_test_configs['balls'][1]
    prompts=[]
    def encode(*values,**kwargs):
        prompts.append(values[2])
        result=training.encode_prompt(*values,**kwargs)
        if any(not torch.isfinite(value).all() for value in result if value is not None):
            raise ValueError('nonfinite text embeddings')
        return result
    _,prompt_embeds,pooled_embeds,_=source_utils.prepare_target_and_prompt_ev(cfg,encode,encoders,tokenizers,'mps')
    report['encodedPrompts']=prompts
    pipe.text_encoder=None; pipe.text_encoder_2=None
    del encoders,tokenizers
    gc.collect(); torch.mps.empty_cache()
    phase('mps-model-and-condition-encoding')
    pipe.to('mps',dtype=torch.float16)
    if pipe.transformer.device.type!='mps': raise RuntimeError('unexpected effective device')
    report['route']={'device':str(pipe.transformer.device),'dtype':str(pipe.transformer.dtype),
        'torch':torch.__version__,'diffusers':__import__('diffusers').__version__,
        'cpuFallback':False,'randomGeneratorDevice':'cpu','loading':'strict-complete-state-no-base-transformer'}
    conditions=[]
    with torch.inference_mode():
        for key in CONDITIONS:
            condition=source_utils.encode_with_vae(pipe.vae,batch[key].unsqueeze(0).to('mps'),weight_dtype=pipe.vae.dtype)
            if not torch.isfinite(condition).all(): raise ValueError(f'nonfinite condition: {key}')
            conditions.append(condition)
        report['passes']=[]
        for ev in args.evs:
            generator=torch.Generator(device='cpu').manual_seed(args.seed)
            for target in args.targets:
                phase(f'{target}-ev{ev}')
                steps=0
                def callback(_pipe,index,_timestep,values):
                    nonlocal steps
                    steps+=1; report['currentPass']={'target':target,'ev':ev,'effectiveSteps':steps}
                    save_json(report_path,report)
                    return values
                latents=packed_noise(pipe,width,height,generator,pipe.transformer.dtype,'mps')
                torch.mps.synchronize(); start=time.perf_counter()
                image=pipe(prompt_embeds=prompt_embeds[target][ev],pooled_prompt_embeds=pooled_embeds[target][ev],
                    latent_conditions=conditions,latents=latents,width=width,height=height,guidance_scale=1.0,
                    num_inference_steps=args.steps,output_type='pt',callback_on_step_end=callback).images[0]
                torch.mps.synchronize(); seconds=time.perf_counter()-start
                pixels=image.float().permute(1,2,0).cpu().numpy()
                stats=validate_pass(pixels,mask,steps,args.steps)
                path=args.output_dir/f'{target}_ev{ev}.png'
                Image.fromarray(np.uint8(pixels*255)).save(path)
                report['passes'].append({'target':target,'ev':ev,'seed':args.seed,
                    'effectiveSeed':generator.initial_seed(),'effectiveSteps':steps,'seconds':seconds,
                    'path':str(path),'sha256':digest(path),'region':stats})
                save_json(report_path,report)
    del pipe,transformer,conditions
    gc.collect(); torch.mps.empty_cache()


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source-root','support','checkpoint','metadata','scene','output-dir'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--targets',nargs='+',choices=TARGETS,default=list(TARGETS))
    parser.add_argument('--evs',nargs='+',type=int,choices=EVS,default=list(EVS))
    parser.add_argument('--steps',type=int,default=20)
    parser.add_argument('--seed',type=int,default=0)
    args=parser.parse_args(argv)
    args.output_dir.mkdir(parents=True,exist_ok=True)
    path=args.output_dir/'probe.json'
    if path.exists(): raise FileExistsError('choose a fresh output directory; preserve prior probe evidence')
    report={'schema':'kaminos.limo-probe.v0','status':'failed','phase':'initialization',
        'receiver':'welcome-to-the-desert-of-the-real','estimator':'LiMo-image',
        'requestedDevice':'mps','requested':{'targets':args.targets,'evs':args.evs,'steps':args.steps,'seed':args.seed},
        'scope':'selected sphere outputs only; no reconstructed HDR or environment quality claim'}
    save_json(path,report)
    try:
        if args.steps<=0: raise ValueError('steps must be positive')
        if len(set(args.targets))!=len(args.targets) or len(set(args.evs))!=len(args.evs):
            raise ValueError('duplicate target or EV would overwrite retained output')
        run(args,report,path)
        report.update(status='complete',phase='complete')
    except Exception as error:
        report['error']=f'{type(error).__name__}: {error}'
        raise
    finally:
        save_json(path,report)
    print(path,flush=True)


if __name__=='__main__':
    main()
