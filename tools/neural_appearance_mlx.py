"""Portable float32 training of the released NVIDIA two-frame decoder.

The input is retained directional-response data, not beauty images. This first
fit directly optimizes texels and one decoder instance; it does not reproduce
the official encoder/multi-instance selection or its FP16 arithmetic.
"""
import json
import math
import hashlib
from pathlib import Path
import numpy as np
import mlx.core as mx
import mlx.nn as nn


def normalize(x):
    return x / mx.maximum(mx.sqrt(mx.sum(x*x, axis=-1, keepdims=True)), 1e-12)


def smelu(x):
    return mx.minimum(mx.maximum(.01*x, x+.495), mx.minimum(.495*x*x+.505*x+.12375, mx.maximum(x,.5)))


class Appearance(nn.Module):
    def __init__(self, resolution=64, width=16, seed=41, *, recipe="legacy", hidden_layers=None):
        if recipe not in ["legacy", "published-direct"]:raise ValueError("Known initialization recipe required")
        hidden_layers=[width,width] if hidden_layers is None else hidden_layers
        if not isinstance(hidden_layers,(list,tuple)) or not hidden_layers or any(type(w) is not int or w<1 for w in hidden_layers):raise ValueError('Positive integer decoder hidden layers required')
        super().__init__()
        mx.random.seed(seed)
        self.resolution=resolution
        self.normalized_latents=recipe=="legacy"
        self.latents=mx.random.normal((resolution*resolution,8))*.1 if self.normalized_latents else mx.zeros((resolution*resolution,8))
        self.rotation=nn.Linear(8,12,bias=False)
        sizes=[24,*hidden_layers,3]
        self.layers=[nn.Linear(inputs,outputs) for inputs,outputs in zip(sizes,sizes[1:])]
        # Start near a plausible reflectance; the official output mapping has
        # exp-like slope in this range, with a high finite asymptote.
        if recipe=="legacy":self.layers[-1].bias=mx.full((3,),-2.)
        else:
            # Released LinearLayer: NumPy-seeded Xavier uniform and zero biases.
            rng=np.random.RandomState(seed)
            for layer in [self.rotation,*self.layers]:
                outputs,inputs=layer.weight.shape;bound=math.sqrt(6./(inputs+outputs))
                layer.weight=mx.array(rng.uniform(-bound,bound,(outputs,inputs)).astype(np.float32))
                if 'bias' in layer:layer.bias=mx.zeros((outputs,))

    def __call__(self, queries):
        uv=queries[:,:2]-mx.floor(queries[:,:2])
        xy=mx.clip(mx.floor(uv*self.resolution).astype(mx.int32),0,self.resolution-1)
        z=self.latents[xy[:,1]*self.resolution+xy[:,0]]
        if self.normalized_latents:z=mx.tanh(z)
        return self.decode(z,queries)

    def decode(self,z,queries):
        """Evaluate latents in the checkpoint's trained directional frame."""
        frames=self.rotation(z)
        n=normalize(frames[:,:6].reshape((-1,2,3))+mx.array([0.,0.,1.]))
        t=normalize(frames[:,6:].reshape((-1,2,3))+mx.array([1.,0.,0.]))
        b=mx.stack((n[:,:,1]*t[:,:,2]-n[:,:,2]*t[:,:,1],n[:,:,2]*t[:,:,0]-n[:,:,0]*t[:,:,2],n[:,:,0]*t[:,:,1]-n[:,:,1]*t[:,:,0]),axis=-1)
        wi=queries[:,2:5];wo=queries[:,5:8];wh=normalize(wi+wo)
        v=mx.stack((wh[:,1],-wh[:,0],mx.zeros_like(wh[:,0])),axis=-1)
        cross=mx.stack((v[:,1]*wi[:,2]-v[:,2]*wi[:,1],v[:,2]*wi[:,0]-v[:,0]*wi[:,2],v[:,0]*wi[:,1]-v[:,1]*wi[:,0]),axis=-1)
        wd=wi*wh[:,2:3]+cross+mx.sum(v*wi,axis=-1,keepdims=True)*v/(1+wh[:,2:3])
        def project(w):
            w=w[:,None,:]
            return mx.stack((mx.sum(w*t,axis=-1),mx.sum(w*b,axis=-1),mx.sum(w*n,axis=-1)),axis=-1).reshape((-1,6))
        x=mx.concatenate((project(wh),project(wd),mx.sum(wi[:,None,:]*n,axis=-1),mx.sum(wo[:,None,:]*n,axis=-1),z),axis=-1)
        for layer in self.layers[:-1]:x=smelu(layer(x))
        x=self.layers[-1](x)
        e=mx.exp(-mx.abs(x));result=mx.where(x>0,1e5/(1e5*e+1),1e5*e/(e+1e5))
        return mx.where(((wi[:,2]>0)&(wo[:,2]>0))[:,None],result,0)

    def checkpoint(self):
        def layer(l):
            w=np.asarray(l.weight);b=np.asarray(l.bias) if 'bias' in l else np.zeros(w.shape[0])
            return {'num_inputs':w.shape[1],'num_outputs':w.shape[0],'weights':w.flatten().tolist(),'biases':b.tolist()}
        return {'latents':{'num_channels':8,'num_mip_levels':1,'normalize':self.normalized_latents},'decoder':{
            'hidden_layers':[layer.weight.shape[0] for layer in self.layers[:-1]],'hidden_activations':'SmeLU',
            'output_activation':{'type':'ScaledSigmoid','scale':1e5},'half_diff_parameterization':'StableRusinkiewicz',
            'num_shading_frames':2,'direction_inputs':'WhWdZiZo',
            '_params':{'rotation':{'rotation_decoder':{'mlp_layers':[layer(self.rotation)]}},'network':{'mlp_layers':[layer(l) for l in self.layers]}}}}

    def save_bundle(self, out, provenance):
        out=Path(out);out.mkdir(parents=True,exist_ok=True)
        data=np.asarray(mx.tanh(self.latents) if self.normalized_latents else self.latents).astype('<f4').tobytes()
        (out/'latents.f32').write_bytes(data)
        ckpt=self.checkpoint();ckpt['kaminos']={'schema':'kaminos.neural-appearance.bundle.v1','response':'projected-bsdf',
            'filtering':'nearest-authored-texel-mip','levels':[{'width':self.resolution,'height':self.resolution,'url':'latents.f32','sha256':hashlib.sha256(data).hexdigest()}],
            'provenance':provenance}
        payload=(json.dumps(ckpt,indent=2)+'\n').encode();(out/'model.json').write_bytes(payload)
        return {'path':str(out/'model.json'),'sha256':hashlib.sha256(payload).hexdigest()}


def appearance_response_loss(predicted, reference, kind='log1p-l1', power=3.0):
    """Author power-log loss, or the explicitly named legacy integration loss."""
    if kind == 'log1p-l1':
        return mx.mean(mx.abs(mx.log1p(predicted)-mx.log1p(reference)))
    if kind != 'L1WithPowerLog' or not math.isfinite(power) or power <= 0:
        raise ValueError('Supported response loss and positive power required')
    return power*mx.mean(mx.abs(predicted**(1.0/power)-reference**(1.0/power)))


def appearance_learning_rate(iteration, iterations, initial=.001, end_scale=1.0):
    if not math.isfinite(iteration) or iteration < 0 or iterations <= 0 or not math.isfinite(initial) or initial <= 0 or not math.isfinite(end_scale) or end_scale < 0:
        raise ValueError('Valid cosine training schedule required')
    t=min(iteration/iterations,1.0)
    return initial*(end_scale+(1.0-end_scale)*.5*(1.0+math.cos(math.pi*t)))
