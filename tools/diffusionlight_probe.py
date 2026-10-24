"""DiffusionLight-Turbo assay on MPS, composed with the existing lighting viewer.

Inference adapted from DiffusionLight-Turbo-diffusers ef7a372; MIT copyright
2025 Pakkapon Phongthawee (tools/licenses/diffusionlight-turbo.txt).
Ball projection and HDR merge execute the unmodified upstream functions.
"""
import argparse
import gc
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace

import numpy as np
from PIL import Image, ImageOps
from emlight_probe import (camera_to_native, diffuse_metrics, digest,
    environment_coefficients, native_to_camera, panorama_grid, png_url,
    project_sh, read_environment, rotate_native, sample_panorama, tone)

SOURCE_REVISION = '6e8b0f1ad664f5e11281d80482ae19a490927cc4'
EVS = (0, -2.5, -5)
SEED = 200
PIPELINE_SETTINGS = {'num_inference_steps':30,'guidance_scale':5.0,
                     'strength':0.9999,'controlnet_conditioning_scale':.5}
PROMPT = 'a perfect mirrored reflective chrome ball sphere'
BLACK_PROMPT = 'a perfect black dark mirrored reflective chrome ball sphere'
NEGATIVE_PROMPT = 'matte, diffuse, flat, dull'
MODELS = {
    'base': ('stabilityai/stable-diffusion-xl-base-1.0', '462165984030d82259a11f4367a4eed129e94a7b',
        ['model_index.json','scheduler/scheduler_config.json','text_encoder/config.json',
         'text_encoder/model.fp16.safetensors','text_encoder_2/config.json',
         'text_encoder_2/model.fp16.safetensors','unet/config.json',
         'unet/diffusion_pytorch_model.fp16.safetensors','vae/config.json',
         'vae/diffusion_pytorch_model.fp16.safetensors',
         *[f'{t}/{f}' for t in ['tokenizer','tokenizer_2'] for f in
           ['merges.txt','vocab.json','tokenizer_config.json','special_tokens_map.json']]]),
    'control': ('diffusers/controlnet-depth-sdxl-1.0', '17bb97973f29801224cd66f192c5ffacf82648b4',
        ['config.json','diffusion_pytorch_model.fp16.safetensors']),
    'depth': ('Intel/dpt-large','bc15f29aa3a80d532f2ed650b5e16ac48d8958f9',
        ['config.json','preprocessor_config.json','model.safetensors']),
    'turbo': ('DiffusionLight/Flickr2K','ed635477e5a742e363e54a6ed2193a9a43153113',
        ['pytorch_lora_weights.safetensors']),
    'exposure': ('DiffusionLight/DiffusionLight','bda34823e932601b3eb9aff0276f00925cdeea46',
        ['pytorch_lora_weights.safetensors']),
}


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+'\n')


def acquire(path):
    from huggingface_hub import snapshot_download
    path.parent.mkdir(parents=True, exist_ok=True)
    result = {'status':'running','receiver':'welcome-to-the-desert-of-the-real',
              'pid':os.getpid(),'phase':'download','models':{}}
    save_json(path,result)
    try:
        for name,(repo,revision,files) in MODELS.items():
            print(f'Acquiring {name}: {repo}@{revision}',flush=True)
            root=Path(snapshot_download(repo,revision=revision,allow_patterns=files))
            result['models'][name]={'repo':repo,'revision':revision,'path':str(root),
                'files':{f:{'bytes':(root/f).stat().st_size,'sha256':digest(root/f)} for f in files}}
            save_json(path,result)
        result.update(status='complete',phase='complete')
    except Exception as error:
        result.update(status='failed',error=f'{type(error).__name__}: {error}')
        raise
    finally:
        save_json(path,result)


def require_mps():
    import torch
    if os.environ.get('PYTORCH_ENABLE_MPS_FALLBACK') == '1':
        raise RuntimeError('MPS fallback must be disabled for this assay')
    if not torch.backends.mps.is_available():
        raise RuntimeError('MPS unavailable; no CPU fallback')


def pad_input(image):
    resized=ImageOps.contain(image.convert('RGB'),(1024,1024),Image.Resampling.LANCZOS)
    output=Image.new('RGB',(1024,1024))
    output.paste(resized,((1024-resized.width)//2,(1024-resized.height)//2))
    return output


def camera_input(environment, fov, yaw):
    if not 0 < fov < 180 or not np.isfinite(yaw):
        raise ValueError('fov must be in (0,180) and yaw finite')
    x,y=np.meshgrid((np.arange(1024)+.5)/1024*2-1,1-(np.arange(768)+.5)/768*2)
    scale=np.tan(np.radians(fov)/2)
    camera=np.stack((x*scale,y*scale*768/1024,-np.ones_like(x)),-1)
    camera/=np.linalg.norm(camera,axis=-1,keepdims=True)
    return tone(sample_panorama(environment,rotate_native(camera_to_native(camera),yaw)))


def ball_controls(depth_image):
    depth=np.asarray(depth_image.convert('L')).copy()
    if depth.shape != (1024,1024):
        raise ValueError('depth must be 1024 square')
    def circle(size):
        x,y=np.meshgrid(np.linspace(-1,1,size),np.linspace(1,-1,size))
        return (x*x+y*y)<=1
    depth[384:640,384:640]=np.where(circle(256),255,depth[384:640,384:640])
    mask=np.zeros_like(depth)
    mask[374:650,374:650]=circle(276)*255
    return Image.fromarray(depth),Image.fromarray(mask)


def interpolate_prompt(bright, dark, ev):
    if ev not in EVS:
        raise ValueError('unsupported exposure bracket')
    ratio=(ev+5)/5
    return bright*ratio+dark*(1-ratio)


def import_source(root, name):
    spec=importlib.util.spec_from_file_location(f'diffusionlight_{name}',root/f'{name}.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def hdr_converter(root):
    import OpenEXR
    module=import_source(root,'exposure2hdr')
    def write(path, rgb):
        # skylibs0.7.4 calls NumPy's removed tostring(). Keep upstream HDR math
        # intact and replace only its EXR file writer with the installed API.
        channels={c:np.ascontiguousarray(rgb[...,i],dtype=np.float32) for i,c in enumerate('RGB')}
        OpenEXR.File({},channels).write(str(path))
    module.ezexr=SimpleNamespace(imwrite=write)
    return module


def reconstruct(root, output):
    # These exact upstream functions define the camera convention and EV merge.
    sys.path.insert(0,str(root))
    ball=import_source(root,'ball2envmap')
    exposure=hdr_converter(root)
    env_dir=output/'envmap'; env_dir.mkdir()
    hdr_dir=output/'hdr'; hdr_dir.mkdir()
    names={ev:f'probe_ev{int(ev*10)}.png' for ev in EVS}
    for name in names.values():
        ball.process_image(SimpleNamespace(ball_dir=str(output/'square'),envmap_dir=str(env_dir),
            envmap_height=256,scale=4),name)
        if not (env_dir/name).is_file():
            raise RuntimeError(f'upstream ball projection produced no {name}')
    exposure.process_image(SimpleNamespace(input_dir=str(env_dir),output_dir=str(hdr_dir),
        gamma=2.4,preview_output=True),{'name':'probe','ev':names})
    return hdr_dir/'probe.exr'


def run_inference(models, image, output, report, report_path):
    import torch
    from diffusers import ControlNetModel, StableDiffusionXLControlNetInpaintPipeline, UniPCMultistepScheduler
    from transformers import pipeline
    require_mps()
    def phase(name):
        report['phase']=name; save_json(report_path,report); print(name,flush=True)
    phase('depth-load-and-inference')
    depth_estimator=pipeline('depth-estimation',model=models['depth']['path'],
        device='mps',torch_dtype=torch.float32)
    depth=depth_estimator(image)['depth']
    depth.save(output/'depth.png')
    control_image,mask=ball_controls(depth)
    control_image.save(output/'control-depth.png'); mask.save(output/'inpaint-mask.png')
    del depth_estimator
    gc.collect(); torch.mps.empty_cache()
    phase('sdxl-load')
    control=ControlNetModel.from_pretrained(models['control']['path'],variant='fp16',
        torch_dtype=torch.float16,local_files_only=True)
    pipe=StableDiffusionXLControlNetInpaintPipeline.from_pretrained(models['base']['path'],
        controlnet=control,variant='fp16',torch_dtype=torch.float16,add_watermarker=False,
        local_files_only=True).to('mps')
    pipe.load_lora_weights(models['turbo']['path'],adapter_name='turbo')
    pipe.load_lora_weights(models['exposure']['path'],adapter_name='exposure')
    pipe.scheduler=UniPCMultistepScheduler.from_config(pipe.scheduler.config)
    original=pipe.prepare_mask_latents
    def prepare(self, *args, **kwargs):
        values=list(args)
        values[0]=torch.nn.functional.interpolate(values[0],
            size=(values[3]//self.vae_scale_factor,values[4]//self.vae_scale_factor),
            mode='bilinear',align_corners=False)
        return original(*values,**kwargs)
    pipe.prepare_mask_latents=prepare.__get__(pipe,pipe.__class__)
    def apply_lora(name, scale):
        pipe.unfuse_lora(); pipe.set_adapters(name); pipe.fuse_lora(lora_scale=scale)
    bright,_,bright_pool,_=pipe.encode_prompt(PROMPT)
    dark,_,dark_pool,_=pipe.encode_prompt(BLACK_PROMPT)
    report['effectiveDevice']=str(pipe.unet.device)
    if report['effectiveDevice']!='mps':
        raise RuntimeError('unexpected diffusion device')
    report['route']={'depthDevice':'mps','depthDtype':'float32','diffusionDevice':'mps',
        'diffusionDtype':'float16','randomGeneratorDevice':'cpu','cpuFallback':False,
        'torchVersion':torch.__version__,'diffusersVersion':__import__('diffusers').__version__}
    report['settings']={'exposures':EVS,'seed':SEED,'pipeline':PIPELINE_SETTINGS,
        'scheduler':'UniPCMultistepScheduler','switchTimestep':800,'exposureLoraScale':.75,
        'prompt':PROMPT,'blackPrompt':BLACK_PROMPT,'negativePrompt':NEGATIVE_PROMPT}
    report['exposures']=[]
    (output/'raw').mkdir(); (output/'square').mkdir()
    with torch.inference_mode():
        for ev in EVS:
            phase(f'inference-ev-{ev}')
            switched=False; switches=[]; step_count=0
            def callback(pipeline, index, timestep, callback_kwargs):
                nonlocal switched, step_count
                step_count+=1
                if not switched and float(timestep)<=800:
                    apply_lora('exposure',.75); switched=True
                    switches.append({'step':index,'timestep':float(timestep)})
                return callback_kwargs
            apply_lora('turbo',1.)
            torch.mps.synchronize(); start=time.perf_counter()
            frame=pipe(prompt_embeds=interpolate_prompt(bright,dark,ev),
                pooled_prompt_embeds=interpolate_prompt(bright_pool,dark_pool,ev),
                negative_prompt=NEGATIVE_PROMPT,image=image,mask_image=mask,control_image=control_image,
                **PIPELINE_SETTINGS,callback_on_step_end=callback,
                generator=torch.Generator(device='cpu').manual_seed(SEED)).images[0]
            torch.mps.synchronize()
            elapsed=time.perf_counter()-start
            name=f'probe_ev{int(ev*10)}.png'
            frame.save(output/'raw'/name)
            frame.crop((384,384,640,640)).save(output/'square'/name)
            pixels=np.asarray(frame)
            if not switches or np.ptp(pixels[384:640,384:640])==0:
                raise RuntimeError('missing LoRA switch or blank generated ball')
            report['exposures'].append({'ev':ev,'seed':SEED,'seconds':elapsed,'switches':switches,'effectiveSteps':step_count,
                'image':str(output/'raw'/name),'sha256':digest(output/'raw'/name)})
            save_json(report_path,report)
    del pipe, control
    gc.collect(); torch.mps.empty_cache()


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--acquire',type=Path)
    parser.add_argument('--models',type=Path)
    parser.add_argument('--source-root',type=Path)
    parser.add_argument('--environment',type=Path)
    parser.add_argument('--output-dir',type=Path)
    parser.add_argument('--fov',type=float,default=60)
    parser.add_argument('--view-yaw',type=float,default=0)
    parser.add_argument('--label',default='Warehouse')
    args=parser.parse_args(argv)
    if args.acquire:
        return acquire(args.acquire)
    if any(value is None for value in [args.models,args.source_root,args.environment,args.output_dir]):
        parser.error('--models, --source-root, --environment and --output-dir required')
    args.output_dir.mkdir(parents=True,exist_ok=True)
    report_path=args.output_dir/'lighting.json'
    report={'schema':'kaminos.inferred-lighting.v1','estimator':'DiffusionLight-Turbo',
        'status':'failed','phase':'source-validation','requestedDevice':'mps','label':args.label,
        'receiver':'welcome-to-the-desert-of-the-real','claim':'inferred relative HDR; not measured radiometry'}
    save_json(report_path,report)
    try:
        models=json.loads(args.models.read_text())
        if models['status']!='complete': raise ValueError('incomplete model acquisition')
        models=models['models']
        for name,(_,revision,files) in MODELS.items():
            entry=models[name]
            if entry['revision']!=revision: raise ValueError(f'{name} revision mismatch')
            for filename in files:
                path=Path(entry['path'])/filename
                if digest(path)!=entry['files'][filename]['sha256']:
                    raise ValueError(f'{name}/{filename} hash mismatch')
        report['models']=models
        report['checkpointSha256']=digest(args.models)
        report['sourceRevision']=subprocess.check_output(['git','-C',str(args.source_root),'rev-parse','HEAD'],text=True).strip()
        if report['sourceRevision']!=SOURCE_REVISION: raise ValueError('upstream revision mismatch')
        report['adapterSha256']=digest(__file__)
        report['inferenceExampleRevision']='ef7a372e54d5cfeeb47ae5900a5531dbc0628b56'
        report['environmentSha256']=digest(args.environment)
        report['environmentPath']=str(args.environment.resolve())
        report['phase']='preprocess'
        environment=read_environment(args.environment,args.output_dir)
        if not np.isfinite(environment).all() or np.any(environment<0):
            raise ValueError('environment must be finite nonnegative RGB')
        crop=camera_input(environment,args.fov,args.view_yaw)
        image=pad_input(Image.fromarray(np.uint8(crop*255)))
        image.save(args.output_dir/'input.png')
        report['input']={'width':1024,'height':1024,'horizontalFov':args.fov,
            'viewYawDegrees':args.view_yaw,'image':png_url(crop),'sha256':digest(args.output_dir/'input.png'),
            'preprocessing':'1024x768 perspective; gamma1/2.4; positive median=.5; clip; black pad1024 square',
            'scope':'same 60-degree camera frustum as EMLight; native higher-resolution sampling; no fitted view'}
        run_inference(models,image,args.output_dir,report,report_path)
        report['phase']='hdr-reconstruction'; save_json(report_path,report)
        hdr=reconstruct(args.source_root,args.output_dir)
        estimated=read_environment(hdr,args.output_dir)
        if not np.isfinite(estimated).all() or np.any(estimated<0):
            raise ValueError('nonfinite or negative reconstructed HDR')
        ref_sh,ref_mean=environment_coefficients(environment,args.view_yaw)
        # Upstream panorama samples include endpoints (unlike our HDR pixel-center grid).
        ball=import_source(args.source_root,'ball2envmap')
        grid=ball.create_envmap_grid(estimated.shape[0])
        native=ball.get_cartesian_from_spherical(grid[...,1],grid[...,0])
        weights=np.sin(grid[...,1])
        weights*=4*np.pi/weights.sum()
        mean=float(np.einsum('hwc,hw,c->',estimated,weights,[.2126,.7152,.0722])/weights.sum())
        if not np.isfinite(mean) or mean<=0: raise ValueError('no positive estimated light energy')
        est_sh=project_sh(estimated/mean,native_to_camera(native),weights)
        preview_dirs,_=panorama_grid(128,256)
        reference_preview=sample_panorama(environment,rotate_native(preview_dirs,args.view_yaw))
        report['lights']={'reference':{'sh':ref_sh.tolist(),'meanLuminanceBeforeNormalization':ref_mean,
            'preview':png_url(tone(reference_preview))},'estimated':{'sh':est_sh.tolist(),
            'meanLuminanceBeforeNormalization':mean,'preview':png_url(tone(estimated))}}
        report['hdr']={'path':str(hdr),'sha256':digest(hdr),'shape':list(estimated.shape),
            'min':float(estimated.min()),'max':float(estimated.max())}
        report['metrics']=diffuse_metrics(ref_sh,est_sh)
        report['interpretation']={'normalization':'each map independently mean-luminance normalized',
            'coordinates':'upstream Blender X points toward camera; camera=(native -Y,Z,X)',
            'referenceIntegration':'original HDR pixels and solid angles',
            'limits':['degree-2 diffuse comparison; full HDR preserved separately',
                'single seed; generated hidden scene; not calibrated intensity',
                'MPS float16 diffusion, float32 depth, CPU noise; not CUDA reproduction']}
        report.update(status='complete',phase='complete')
    except Exception as error:
        report['error']=f'{type(error).__name__}: {error}'
        raise
    finally:
        save_json(report_path,report)
    print(str(report_path),flush=True)


if __name__=='__main__':
    main()
