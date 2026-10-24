"""Small, replayable CPU oracle for the FLUX.3 reference-image path.

Uses the installed diffusers implementation and the exact source checkpoint/LoRA.
No text model is needed: fixed random text features isolate reference conditioning.
Weights receive the same quantization as the browser package. Outputs and failure
phase are retained under the caller's output directory.
"""
import argparse, gc, hashlib, importlib.util, json, pathlib, subprocess, traceback

# Source parameter names in FLUX.2's pack-transformer.py globals bundle.
FLUX2_GLOBALS = {
    'x_embedder.weight', 'context_embedder.weight',
    'time_guidance_embed.timestep_embedder.linear_1.weight',
    'time_guidance_embed.timestep_embedder.linear_2.weight',
    'double_stream_modulation_img.linear.weight',
    'double_stream_modulation_txt.linear.weight',
    'single_stream_modulation.linear.weight', 'norm_out.linear.weight', 'proj_out.weight',
}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--model-dir',required=True);ap.add_argument('--lora')
    ap.add_argument('--model',choices=['flux2','flux3'],default='flux3')
    ap.add_argument('--out',required=True)
    a=ap.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
    source=pathlib.Path(a.model_dir);here=pathlib.Path(__file__).resolve().parent
    r={'ok':False,'phase':'source-identity','modelDir':str(source),'sourceRevision':source.name,
       'model':a.model,'weights':{'format':'i4','globals_format':'i4' if a.model=='flux2' else 'i8','group':128 if a.model=='flux2' else 64,'globals_group':64},'tensors':{},'width':48,'height':32,'seed':9021}
    def write():(out/'manifest.json').write_text(json.dumps(r,indent=2))
    def save(name,t):
        x=np.ascontiguousarray(t.detach().float().cpu().numpy());data=x.tobytes();file=name+'.f32'
        (out/file).write_bytes(data);r['tensors'][name]={'file':file,'shape':list(x.shape),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    write()
    try:
        if a.model=='flux3':r['loraSha256']=hashlib.sha256(pathlib.Path(a.lora or '').read_bytes()).hexdigest()
        else:(source/'transformer'/'config.json').read_bytes()
        r['sourceCommit']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=here,text=True).strip()
        r['phase']='imports';write()
        import numpy as np
        import torch
        import diffusers
        from diffusers import AutoencoderKLFlux2, Flux2KleinPipeline
        from diffusers.models.transformers.transformer_flux2 import Flux2Transformer2DModel
        from diffusers.models.transformers.transformer_flux3 import Flux3Transformer2DModel
        from diffusers.modular_pipelines.flux3.encoders import Flux3VaeEncoderStep
        from diffusers.modular_pipelines.flux3.before_denoise import _prepare_image_ids
        from flux3_lora import lora_deltas
        spec=importlib.util.spec_from_file_location('pack',here/'pack-flux3-transformer.py');pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)
        r['versions']={'torch':torch.__version__,'diffusers':diffusers.__version__}
        r['oracleFiles']={}
        import inspect
        for cls in [AutoencoderKLFlux2,Flux3Transformer2DModel,Flux3VaeEncoderStep]:
            f=pathlib.Path(inspect.getfile(cls));r['oracleFiles'][cls.__name__]={'path':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}
        Model=Flux2Transformer2DModel if a.model=='flux2' else Flux3Transformer2DModel
        for cls in [Model,Flux2KleinPipeline]:
            f=pathlib.Path(inspect.getfile(cls));r['oracleFiles'][cls.__name__]={'path':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}
        r['phase']='vae';write()
        vae=AutoencoderKLFlux2.from_pretrained(source/'vae',torch_dtype=torch.float32).eval()
        with torch.no_grad():
            for name,p in vae.named_parameters():
                if not name.startswith('bn.'):p.copy_(p.half().float())
            y,x=np.mgrid[:r['height'],:r['width']]
            rgb=np.stack([x/(r['width']-1)*2-1,y/(r['height']-1)*2-1,np.sin(x*.31)*np.cos(y*.17)],-1).astype('float32')
            inp=torch.from_numpy(rgb).permute(2,0,1)[None]
            save('rgb',torch.from_numpy(rgb))
            mean=vae.encode(inp).latent_dist.mode()
            packed=Flux3VaeEncoderStep._patchify_latents(mean)
            packed=(packed-vae.bn.running_mean[None,:,None,None])/torch.sqrt(vae.bn.running_var[None,:,None,None]+vae.config.batch_norm_eps)
            reference=packed.flatten(2).transpose(1,2).contiguous()
            save('reference',reference[0])
        del vae;gc.collect()
        r['phase']='transformer-load';write()
        tr=Model.from_pretrained(source/'transformer',torch_dtype=torch.float32).eval()
        deltas=lora_deltas(a.lora,keep_image_cond=True) if a.model=='flux3' else {}
        params=dict(tr.named_parameters())
        with torch.no_grad():
            for name,d in deltas.items():params[name].add_(d)
        del params,deltas;gc.collect()
        r['phase']='transformer-quantize';write()
        globals_names={p for _,p in pack.GLOBALS}|{'x_embedders.image_cond.weight','early_stream_modulations.image_cond.linear.weight','single_stream_modulations.image_cond.linear.weight'}
        if a.model=='flux2':globals_names=FLUX2_GLOBALS
        with torch.no_grad():
            for name,p in tr.named_parameters():
                w=p.numpy()
                fmt=r['weights']['globals_format' if name in globals_names else 'format']
                group=r['weights']['globals_group' if name in globals_names else 'group']
                if w.ndim==2 and w.shape[1]%group==0:p.copy_(torch.from_numpy(pack.quantize(w,fmt,group)[2]))
                else:p.copy_(p.half().float())
        r['phase']='transformer-forward';write()
        gen=torch.Generator('cpu').manual_seed(r['seed'])
        latents=torch.randn(1,6,128,generator=gen)
        prompt=torch.randn(1,2,tr.config.joint_attention_dim,generator=gen)
        if a.model=='flux3':
            img_ids=_prepare_image_ids(2,3,.5);ref_ids=img_ids.clone();ref_ids[:,3]=-1
        else:
            dummy=torch.zeros(1,128,2,3)
            img_ids=Flux2KleinPipeline._prepare_latent_ids(dummy)[0].float()
            ref_ids=Flux2KleinPipeline._prepare_image_ids([dummy])[0].float()
        txt_ids=torch.zeros(2,4);txt_ids[:,3]=torch.arange(2)
        for name,t in [('latents',latents[0]),('prompt',prompt[0]),('image_ids',img_ids),('reference_ids',ref_ids),('text_ids',txt_ids)]:save(name,t)
        with torch.no_grad():
            kwargs=dict(hidden_states=latents,encoder_hidden_states=prompt,timestep=torch.ones(1),img_ids=img_ids,txt_ids=txt_ids,return_dict=False)
            if a.model=='flux3':velocity=tr(**kwargs,image_cond_hidden_states=reference,image_cond_ids=ref_ids)[0]
            else:
                conditioned={**kwargs,'hidden_states':torch.cat([latents,reference],dim=1),'img_ids':torch.cat([img_ids,ref_ids],dim=0)}
                velocity=tr(**conditioned)[0][:,:6]
            save('velocity',velocity[0])
            unconditioned=tr(**kwargs)[0];save('velocity_without_reference',unconditioned[0])
            r['referenceEffectL2']=float((velocity-unconditioned).norm()/velocity.norm())
            if not torch.isfinite(velocity).all() or r['referenceEffectL2']<=1e-3:raise ValueError('Oracle reference does not affect finite output')
        r.update(ok=True,phase='done');write()
    except BaseException as e:
        r.update(error=str(e),traceback=traceback.format_exc());write();raise

if __name__=='__main__':main()
