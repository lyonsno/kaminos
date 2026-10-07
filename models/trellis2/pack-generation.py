"""Package cached complete checkpoint inputs. No MLX import or model execution."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import numpy as np

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as file:
        for chunk in iter(lambda:file.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def decode_tensor(raw,dtype,shape):
    types={'F32':'<f4','F16':'<f2','BF16':'<u2'}
    if dtype not in types:raise ValueError('unsupported checkpoint precision '+dtype)
    if len(raw)!=int(np.prod(shape))*np.dtype(types[dtype]).itemsize:raise ValueError('complete checkpoint tensor required')
    values=np.frombuffer(raw,dtype=types[dtype])
    if dtype=='BF16':values=(values.astype('<u4')<<16).view('<f4')
    return values.astype('<f4',copy=False).reshape(shape)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['repo-root','out','trellis-snapshot','dino-reference','sparse-reference','shape-reference','decoder-reference','occupancy-reference']:
        p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--expected-commit',required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    m={'schema':'trellis2.generation-inputs.v0','status':'failed','phase':'source-identity','modelCalls':0,
       'producer':{},'tensors':{},'models':{},'references':{},'meshResolution':1024,'seed':42,
       'comparison':'prepared source pixels; browser noise is not matched MLX RNG or a fidelity oracle'}
    try:
        git=lambda *args:subprocess.check_output(['git','-C',str(a.repo_root),*args],text=True).strip()
        m['producer']={'root':str(a.repo_root.resolve()),'commit':git('rev-parse','HEAD'),'dirty':git('status','--porcelain'),'scriptSha256':digest(__file__)}
        if m['producer']['commit']!=a.expected_commit or m['producer']['dirty']:raise ValueError('clean exact producer source required')
        def source(root,file='manifest.json'):
            f=root/file;v=json.loads(f.read_text());m['references'][str(root)]={'path':str(f),'sha256':digest(f)};return v
        def copy_tensor(root,row,name):
            if Path(row['file']).name!=row['file'] or row['dtype']!='float32':raise ValueError('safe complete F32 input descriptor required '+name)
            f=root/row['file']
            if f.stat().st_size!=row['byteLength'] or row['byteLength']!=int(np.prod(row['shape']))*4 or digest(f)!=row['sha256']:
                raise ValueError('changed/partial source input '+name)
            target=a.out/(name+'.f32');shutil.copyfile(f,target)
            m['tensors'][name]={**row,'file':target.name,'sourcePath':str(f),'sourceSha256':row['sha256']};return name
        def save(name,values,**extra):
            values=np.ascontiguousarray(values,dtype='<f4')
            if not np.isfinite(values).all():raise ValueError('nonfinite checkpoint '+name)
            f=a.out/(name+'.f32');values.tofile(f)
            m['tensors'][name]={'file':f.name,'shape':list(values.shape),'dtype':'float32','byteLength':values.nbytes,'sha256':digest(f),**extra};return name
        def checkpoint(file,mapping,transform=lambda k,v:v):
            identity={'path':str(file),'resolvedPath':str(file.resolve()),'sha256':digest(file),'format':'safetensors'};rows={}
            with file.open('rb') as f:
                length=struct.unpack('<Q',f.read(8))[0];header=json.loads(f.read(length));keys=set(header)-{'__metadata__'}
                if set(mapping.values())!=keys:raise ValueError('complete exact checkpoint parameter coverage required '+str(file))
                for name,key in mapping.items():
                    row=header[key];start,end=row['data_offsets'];f.seek(8+length+start);raw=f.read(end-start)
                    values=transform(key,decode_tensor(raw,row['dtype'],row['shape']))
                    rows[name]=save(name,values,checkpointKey=key,checkpointDtype=row['dtype'],checkpointTensorSha256=hashlib.sha256(raw).hexdigest())
            return rows,identity
        def flow_config(stored,sampler,resolution):
            c=stored['args'];expected={'resolution':resolution,'model_channels':1536,'cond_channels':1024,'num_blocks':30,'num_heads':12}
            for key,value in expected.items():
                if c.get(key)!=value:raise ValueError('canonical flow config changed '+key)
            params=sampler['params'];return {'channels':1536,'heads':12,'contextChannels':1024,'contextRows':1029,
                'hidden':8192,'frequencyDim':256,'numBlocks':30,'steps':params['steps'],'guidanceStrength':params['guidance_strength'],
                'guidanceRescale':params['guidance_rescale'],'guidanceInterval':params['guidance_interval'],'rescaleT':params['rescale_t'],'sigmaMin':sampler['args']['sigma_min']}
        pipeline_file=a.trellis_snapshot/'pipeline.json';pipeline=json.loads(pipeline_file.read_text())['args']
        m['pipeline']={'path':str(pipeline_file),'sha256':digest(pipeline_file),'defaultPipelineType':pipeline['default_pipeline_type']}
        if pipeline['default_pipeline_type']!='1024_cascade':raise ValueError('canonical1024cascade pipeline required')
        m['phase']='retained-image-encoder-inputs';d=source(a.dino_reference,'reference-manifest.json')
        if d.get('ok') is not True or d['preprocessing']['pixelValuesShape']!=[1,512,512,3]:raise ValueError('observed complete normalized image input required')
        m['image']={**d['preprocessing'],'pixelTensor':copy_tensor(a.dino_reference,d['outputs']['pixel_values'],'image.pixels'),
            'handoff':'retained normalized image pixels, not retained conditioning/features'}
        prefix={'patchProjection':'patch_projection','patchBias':'patch_bias','classToken':'class_token','registerTokens':'register_tokens','ropeCos':'rope_cos','ropeSin':'rope_sin'}
        layer={'norm1Weight':'norm1_weight','norm1Bias':'norm1_bias','qWeight':'q_weight','qBias':'q_bias','kWeight':'k_weight',
            'vWeight':'v_weight','vBias':'v_bias','oWeight':'o_weight','oBias':'o_bias','layerScale1':'layer_scale1',
            'norm2Weight':'norm2_weight','norm2Bias':'norm2_bias','mlpUpWeight':'mlp_up_weight','mlpUpBias':'mlp_up_bias',
            'mlpDownWeight':'mlp_down_weight','mlpDownBias':'mlp_down_bias','layerScale2':'layer_scale2'}
        m['dino']={'identity':d['model'],'prefix':{k:copy_tensor(a.dino_reference,d['outputs'][v],'dino.'+k) for k,v in prefix.items()},
            'layers':[{k:copy_tensor(a.dino_reference,d['outputs'][f'layer{i}_{v}'],f'dino.layer{i}.{k}') for k,v in layer.items()} for i in range(24)]}
        m['phase']='retained-model-weight-inputs';s=source(a.sparse_reference);lr=source(a.shape_reference);occ=source(a.occupancy_reference)
        if any(v.get('status')!='succeeded' for v in [s,lr,occ]):raise ValueError('successful complete source weight references required')
        gelu=copy_tensor(a.sparse_reference,s['tensors']['gelu'],'shared.gelu')
        def retained_flow(role,root,ref,config):
            rows={k:copy_tensor(root,v,role+'.'+k) for k,v in ref['tensors'].items() if k.startswith(('prefix.','block','terminal.'))}
            rows['gelu']=gelu;m['models'][role]={'config':config,'identity':ref['checkpoint'],'tensors':rows}
        c=flow_config(json.loads((a.trellis_snapshot/'ckpts/ss_flow_img_dit_1_3B_64_bf16.json').read_text()),pipeline['sparse_structure_sampler'],16)
        retained_flow('sparseFlow',a.sparse_reference,s,c)
        m['models']['sparseFlow']['phases']=copy_tensor(a.sparse_reference,s['tensors']['phases'],'sparse.phases')
        c=flow_config(json.loads((a.trellis_snapshot/'ckpts/slat_flow_img2shape_dit_1_3B_512_bf16.json').read_text()),pipeline['shape_slat_sampler'],32)
        retained_flow('lowResolutionShape',a.shape_reference,lr,c)
        m['models']['occupancyDecoder']={'config':occ['config'],'identity':occ['checkpoint'],
            'tensors':{k[7:]:copy_tensor(a.occupancy_reference,v,'occupancy.'+k) for k,v in occ['tensors'].items() if k.startswith('weight.')}}
        shape_root=a.decoder_reference;sh=source(shape_root)
        if sh.get('status')!='succeeded':raise ValueError('complete learned shape decoder source weights required')
        silu=copy_tensor(shape_root,sh['tensors']['silu'],'shared.silu')
        m['models']['shapeDecoder']={'config':sh['config'],'identity':sh['checkpoint'],'siluTable':silu,
            'tensors':{k[7:]:copy_tensor(shape_root,v,'shapeDecoder.'+k) for k,v in sh['tensors'].items() if k.startswith('weight.')}}
        m['phase']='cached-HR-and-texture-checkpoint-expansion'
        spec=importlib.util.spec_from_file_location('flow_weight_maps',Path(__file__).with_name('export-sparse-flow.py'));maps=importlib.util.module_from_spec(spec);spec.loader.exec_module(maps)
        mapping={**{'prefix.'+k:v for k,v in maps.PREFIX_KEYS.items()},**{f'block{i}.{k}':f'blocks.{i}.{v}' for i in range(30) for k,v in maps.BLOCK_KEYS.items()},
            'terminal.weight':'out_layer.weight','terminal.bias':'out_layer.bias'}
        for role,stem,res,sampler in [('highResolutionShape','slat_flow_img2shape_dit_1_3B_1024_bf16',64,'shape_slat_sampler'),
            ('textureFlow','slat_flow_imgshape2tex_dit_1_3B_512_bf16',32,'tex_slat_sampler')]:
            f=a.trellis_snapshot/'ckpts'/(stem+'.safetensors');config=flow_config(json.loads(f.with_suffix('.json').read_text()),pipeline[sampler],res)
            rows,identity=checkpoint(f,{role+'.'+k:v for k,v in mapping.items()})
            m['models'][role]={'config':config,'identity':identity,'tensors':{k[len(role)+1:]:v for k,v in rows.items()}};m['models'][role]['tensors']['gelu']=gelu
        f=a.trellis_snapshot/'ckpts/tex_dec_next_dc_f16c32_fp16.safetensors'
        with f.open('rb') as file:header=json.loads(file.read(struct.unpack('<Q',file.read(8))[0]))
        def remap(k):return re.sub(r'(blocks\.\d+\.\d+\.mlp)\.([02])',r'\1_\2',k)
        def conv_layout(k,v):
            if v.ndim==5 and v.shape[2]==v.shape[3]==v.shape[4] and v.shape[2]<=7:v=np.transpose(v,(0,2,3,4,1))
            if k.startswith('blocks.'):v=v.astype('<f2').astype('<f4')
            return v
        rows,identity=checkpoint(f,{'textureDecoder.'+remap(k):k for k in header if k!='__metadata__'},conv_layout)
        cfg=json.loads(f.with_suffix('.json').read_text())['args']
        m['models']['textureDecoder']={'config':{'latentChannels':cfg['latent_channels'],'channels':cfg['model_channels'],'numBlocks':cfg['num_blocks'],'mode':'texture'},
            'identity':identity,'siluTable':silu,'tensors':{k[len('textureDecoder.'):]:v for k,v in rows.items()}}
        m['status']='succeeded';m['phase']=None
    except Exception as e:m['error']={'message':str(e),'class':type(e).__name__};print(str(e),file=sys.stderr)
    finally:(a.out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
    if m['status']!='succeeded':raise SystemExit(1)
    print(json.dumps({'status':m['status'],'modelCalls':0,'tensorCount':len(m['tensors']),'manifest':str(a.out/'manifest.json')}))

if __name__=='__main__':main()
