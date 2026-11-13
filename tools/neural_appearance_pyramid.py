"""Fit coarser PatternedMetal latents with the original decoder frozen."""
import copy
import hashlib
import json

import mlx.core as mx
import numpy as np

from neural_appearance_mlx import Appearance, appearance_response_loss
from neural_appearance_pool import SourceAdam


def checkpoint_digest(data):
    return hashlib.sha256(data).hexdigest()


def load_parent(path, sha, source_sha):
    wire = path.read_bytes()
    if checkpoint_digest(wire) != sha:
        raise ValueError('Parent checkpoint digest mismatch')
    doc = json.loads(wire)
    lat = doc['latents']
    config = doc['kaminos']
    if config['provenance']['sourceHash'] != source_sha:
        raise ValueError('Parent checkpoint source mismatch')
    if (config['schema'],config['response'],config['filtering'],lat['num_channels'],lat['num_mip_levels'],lat['normalize']) != (
            'kaminos.neural-appearance.bundle.v1','projected-bsdf','nearest-authored-texel-mip',8,1,False):
        raise ValueError('Parent must be an unnormalized single-level projected response')
    level, = config['levels']
    size = level['width']
    file = level['url']
    if size != level['height'] or not file or '/' in file or file in ('.','..'):
        raise ValueError('Invalid parent grid or payload path')
    payload = (path.parent/file).read_bytes()
    if len(payload) != size**2*32 or checkpoint_digest(payload) != level['sha256']:
        raise ValueError('Parent latent byte count or digest mismatch')
    codes = np.frombuffer(payload,'<f4').reshape(size,size,8)
    if not np.isfinite(codes).all():
        raise ValueError('Non-finite parent latents')
    return doc,payload,codes


def frozen_decoder(doc):
    spec=doc['decoder']
    template=Appearance(1, recipe='published-direct', hidden_layers=spec['hidden_layers'])
    if {k:v for k,v in spec.items() if k!='_params'} != {k:v for k,v in template.checkpoint()['decoder'].items() if k!='_params'}:
        raise ValueError('Unsupported parent decoder convention')
    params=spec['_params']
    def set_layer(dst,src):
        weights=np.asarray(src['weights'],dtype='f4').reshape(src['num_outputs'],src['num_inputs'])
        bias=np.asarray(src['biases'],dtype='f4')
        if weights.shape!=dst.weight.shape or bias.shape!=(weights.shape[0],) or not np.isfinite(weights).all() or not np.isfinite(bias).all():
            raise ValueError('Parent decoder parameter mismatch')
        dst.weight=mx.array(weights)
        if 'bias' in dst: dst.bias=mx.array(bias)
        elif np.any(bias): raise ValueError('Unsupported rotation bias')
    set_layer(template.rotation,params['rotation']['rotation_decoder']['mlp_layers'][0])
    for dst,src in zip(template.layers,params['network']['mlp_layers'],strict=True):set_layer(dst,src)
    return template


def fit_level(doc, fine, size, training_batch, heldout, *, steps, learning_rate, on_checkpoint=None):
    from time import perf_counter
    side=fine.shape[0]
    if size<1 or size>=side or side%size or steps<1 or not np.isfinite(learning_rate) or learning_rate<=0:
        raise ValueError('Need a positive fit plan and a coarser grid')
    factor=side//size
    initial=fine.reshape(size,factor,size,factor,8).mean(axis=(1,3)).reshape(size**2,8)
    codes=mx.array(initial)
    decoder=frozen_decoder(doc)
    def predict(c,q):
        uv=q[:,:2]-mx.floor(q[:,:2])
        ij=mx.clip((uv*size).astype(mx.int32),0,size-1)
        return decoder.decode(c[ij[:,1]*size+ij[:,0]],q)
    def loss(c,q,y):return appearance_response_loss(predict(c,q),y,'L1WithPowerLog')
    gradient=mx.value_and_grad(loss)
    if mx.default_device()==mx.gpu:gradient=mx.compile(gradient)
    adam=SourceAdam(learning_rate)
    hq,hy=(mx.array(x,dtype=mx.float32) for x in heldout)
    def validate():
        pred=np.asarray(predict(codes,hq))
        target=np.asarray(hy)
        if not np.isfinite(pred).all() or not np.isfinite(target).all():raise ValueError('Invalid validation result')
        err=np.abs(np.log1p(pred)-np.log1p(target))
        bright=target.mean(axis=-1)>=np.quantile(target.mean(axis=-1),.90)
        return {'meanLog1pL1':float(err.mean()),'brightLog1pL1':float(err[bright].mean())}
    before=validate()
    teacher_s=optimizer_s=0.
    rows=0
    for step in range(1,steps+1):
        start=perf_counter()
        q,y=(mx.array(x,dtype=mx.float32) for x in training_batch(step))
        mx.eval(q,y) # Same materialization point the teacher already needs.
        teacher_s+=perf_counter()-start
        start=perf_counter()
        value,grad=gradient(codes,q,y)
        codes=adam.apply_gradients({'codes':grad},{'codes':codes})['codes']
        mx.eval(codes,adam.state,value)
        optimizer_s+=perf_counter()-start
        rows+=len(q)
        if on_checkpoint and (step==steps or (step&(step-1)==0)):
            on_checkpoint(step,np.asarray(codes),{'teacherSeconds':teacher_s,'optimizerSeconds':optimizer_s,
                                                   'queries':rows,'heldout':validate()})
    return np.asarray(codes),{'before':before,'after':validate(),'queries':rows,
                               'teacherSeconds':teacher_s,'optimizerSeconds':optimizer_s}


def write_bundle(out, doc, fine, trained, parent_sha, provenance=None):
    out.mkdir(parents=True,exist_ok=True)
    result=copy.deepcopy(doc)
    base=result['kaminos']['levels'][0]
    if checkpoint_digest(fine)!=base['sha256']:
        raise ValueError('Unmodified fine payload required')
    base['url']='latents.f32'
    (out/base['url']).write_bytes(fine)
    previous=base['width']
    for size,codes in trained:
        if size*2!=previous or codes.shape!=(size**2,8) or not np.isfinite(codes).all():
            raise ValueError('Expected a contiguous finite mip level')
        payload=codes.astype('<f4').tobytes()
        name=f'latents-{size}.f32'
        (out/name).write_bytes(payload)
        result['kaminos']['levels'].append({'width':size,'height':size,'url':name,'sha256':checkpoint_digest(payload)})
        previous=size
    result['latents']['num_mip_levels']=len(result['kaminos']['levels'])
    result['kaminos']['provenance']['pyramidContinuation']={'parentSha256':parent_sha,'frozenDecoder':True,**(provenance or {})}
    (out/'model.model').write_text(json.dumps(result,indent=2)+'\n')
    return result
