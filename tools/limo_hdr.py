"""Fit a retained LiMo exposure set with its published joint-sphere renderer."""
import argparse
import importlib
import json
from pathlib import Path
import pickle
import random
import subprocess
import sys
import time

import numpy as np
from PIL import Image

from diffusionlight_probe import require_mps, save_json
from emlight_probe import digest

EVS=(0,-3,-6,-9)


def validate_probe(path):
    report=json.loads(path.read_text())
    expected={(target,ev) for target in ('sphere_0','sphere_1') for ev in EVS}
    passes=report.get('passes',[])
    actual={(entry['target'],entry['ev']) for entry in passes}
    if report.get('status')!='complete' or report.get('estimator')!='LiMo-image' or actual!=expected or len(passes)!=8:
        raise ValueError('joint reconstruction requires a complete eight-pass LiMo exposure set')
    for entry in passes:
        if entry['effectiveSteps']!=20:
            raise ValueError('expected published twenty-step sphere prediction')
        if digest(entry['path'])!=entry['sha256']:
            raise ValueError('sphere input digest mismatch')
        with Image.open(entry['path']) as image:
            if image.size!=(512,512): raise ValueError('expected source 512-square sphere prediction')
    return report


def fit(args, report, path):
    import cv2
    import pyexr
    import torch
    require_mps()
    report['phase']='input-validation'; save_json(path,report)
    probe=validate_probe(args.probe)
    scene=Path(probe['scene']['path'])
    for relative,sha in probe['scene']['files'].items():
        if digest(scene/relative)!=sha: raise ValueError(f'scene digest mismatch: {relative}')
    report['inputs']={'probe':str(args.probe),'sha256':digest(args.probe),'scene':str(scene)}
    sys.path.insert(0,str(args.source_root))
    source=importlib.import_module('HDRMerge.batch_optimization_pol_manual_gt')
    if not Path(source.__file__).resolve().is_relative_to(args.source_root.resolve()):
        raise ValueError('wrong HDR renderer source route')
    report['source']={'root':str(args.source_root),'revision':subprocess.check_output(
        ['git','-C',str(args.source_root),'rev-parse','HEAD'],text=True).strip(),
        'rendererSha256':digest(source.__file__),
        'pyramidSha256':digest(args.source_root/'HDRMerge/torch_PoL/torchpol/torch_pol.py'),
        'adapterSha256':digest(__file__)}
    def geometry(name,nearest=False):
        raw=pyexr.read(str(scene/'sphere_0'/f'{name}_0001.exr'))[...,:3].astype(np.float32)
        if name=='mask': raw=(raw==255).astype(np.float32)
        resized=cv2.resize(raw,(512,512),interpolation=cv2.INTER_NEAREST if nearest else cv2.INTER_LINEAR)
        if resized.ndim==2: resized=resized[...,None]
        return torch.from_numpy(resized).permute(2,0,1)
    mask=geometry('mask',True)[:1]
    indices=(mask[0]==1).nonzero()
    if not len(indices): raise ValueError('empty sphere geometry')
    lo=indices.amin(0); hi=indices.amax(0)+1
    crop=(slice(None),slice(int(lo[0]),int(hi[0])),slice(int(lo[1]),int(hi[1])))
    mask=mask[crop].to('mps'); positions=geometry('position')[crop].to('mps'); normals=geometry('normal')[crop].to('mps')
    with (scene/'camera_info.pkl').open('rb') as handle: camera=pickle.load(handle)
    world2cam=torch.from_numpy(np.linalg.inv(np.asarray(camera['cam2world'],dtype=np.float32))).to('mps')
    refs={}
    for entry in probe['passes']:
        pixels=np.array(Image.open(entry['path']).convert('RGB'),dtype=np.float32)/255
        refs[(entry['target'],entry['ev'])]=torch.from_numpy(pixels).permute(2,0,1)[crop].to('mps')
    report['route']={'device':'mps','dtype':'torch.float32','cpuFallback':False,'torch':torch.__version__,
        'renderer':'published-gradio-joint-sphere','pyramidGraphs':False,'optimizerFused':False,
        'geometryPreprocess':'CPU EXR/resize/matrix inversion; fit and rendering MPS'}
    report['phase']='optimization'; save_json(path,report)
    random.seed(args.seed); torch.manual_seed(args.seed)
    initial=torch.full((1,3,256,512),.5,device='mps')
    pol=source.PoL(initial,learning_rate=.005,weight_decay=.05,padding_mode='circular',graphed=False)
    optimizer=torch.optim.AdamW(pol.parameters(),betas=(.9,.99),fused=False)
    targets=['sphere_0'] if args.mode=='mirror' else ['sphere_0','sphere_1']
    report['losses']=[]
    torch.mps.synchronize(); started=time.perf_counter()
    for index in range(args.iterations):
        optimizer.zero_grad()
        recon=pol().squeeze(0).exp2()
        if not torch.isfinite(recon).all(): raise ValueError('nonfinite fitted environment')
        target=random.choice(targets); ev=random.choice(EVS)
        reference=refs[(target,ev)]
        rendered=source.render(positions,world2cam,normals,recon,
            mode='mirror' if target=='sphere_0' else 'diffuse',num_samples=64,proj='latlong')
        rendered=source.Lin_to_sRGB(rendered*(2**ev)).clamp(0,1)
        saturation=torch.where((reference>.9)&(rendered>.9),0.,1.)
        loss=((rendered-reference)*mask*saturation).square().mean()
        if not torch.isfinite(loss): raise ValueError('nonfinite fit loss')
        loss.backward(); optimizer.step(); pol.end_iter_callback(index)
        if index%100==0 or index==args.iterations-1:
            report['effectiveIterations']=index+1
            report['losses'].append({'iteration':index+1,'target':target,'ev':ev,'loss':loss.item()})
            save_json(path,report); print(report['losses'][-1],flush=True)
    torch.mps.synchronize(); report['fitSeconds']=time.perf_counter()-started
    environment=pol().squeeze(0).exp2().detach()
    if not torch.isfinite(environment).all(): raise ValueError('nonfinite final environment')
    report['phase']='output'; save_json(path,report)
    hdr=args.output_dir/'environment.exr'
    pixels=environment.permute(1,2,0).cpu().numpy()
    pyexr.write(str(hdr),pixels)
    reopened=pyexr.read(str(hdr))
    if reopened.shape!=(256,512,3) or not np.isfinite(reopened).all(): raise ValueError('invalid saved HDR')
    preview=args.output_dir/'environment-preview.png'
    display=source.Lin_to_sRGB(environment).clamp(0,1).permute(1,2,0).cpu().numpy()
    Image.fromarray(np.uint8(display*255)).save(preview)
    report['outputs']={'hdr':{'path':str(hdr),'sha256':digest(hdr),'shape':list(reopened.shape)},
        'preview':{'path':str(preview),'sha256':digest(preview)}}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source-root','probe','output-dir'): parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--mode',choices=('joint','mirror'),default='joint')
    parser.add_argument('--iterations',type=int,default=1000)
    parser.add_argument('--seed',type=int,default=0)
    args=parser.parse_args(argv)
    args.output_dir.mkdir(parents=True,exist_ok=True); path=args.output_dir/'fit.json'
    if path.exists(): raise FileExistsError('choose a fresh output directory')
    report={'schema':'kaminos.limo-hdr.v0','status':'running','phase':'initialization',
        'receiver':'welcome-to-the-desert-of-the-real','requestedDevice':'mps',
        'requested':{'mode':args.mode,'iterations':args.iterations,'seed':args.seed},
        'scope':'relative reconstructed light from predicted spheres; not measured original scene HDR'}
    save_json(path,report)
    try:
        if args.iterations<=0: raise ValueError('iterations must be positive')
        fit(args,report,path); report.update(status='complete',phase='complete')
    except Exception as error:
        report.update(status='failed',error=f'{type(error).__name__}: {error}'); raise
    finally: save_json(path,report)
    print(path,flush=True)


if __name__=='__main__': main()
