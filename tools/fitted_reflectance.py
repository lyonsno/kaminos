"""Fit a reusable local-space diffuse + tilted anisotropic GGX material.

All source queries return linear RGB with the light cosine already included.
The evaluator supplied by a caller can implement any material in that contract.
"""
import math

import mlx.core as mx
import numpy as np

LAYOUT = ['diffuseRGB', 'specularF0RGB', 'slopeXY', 'alphaXY', 'azimuth']


def unit(a):
    return a / mx.maximum(mx.sqrt(mx.sum(a*a, axis=-1, keepdims=True)), 1e-8)


def dot(a,b):
    return mx.sum(a*b,axis=-1)


def cross(a,b):
    return mx.stack((a[...,1]*b[...,2]-a[...,2]*b[...,1],
                     a[...,2]*b[...,0]-a[...,0]*b[...,2],
                     a[...,0]*b[...,1]-a[...,1]*b[...,0]),axis=-1)


def response(p, view, light):
    """Broadcast material [...,11] and two arrays of local unit directions."""
    n = unit(mx.concatenate((p[...,6:8],mx.ones_like(p[...,6:7])),axis=-1))
    t = unit(mx.stack((n[...,2],mx.zeros_like(n[...,2]),-n[...,0]),axis=-1))
    b = cross(n,t)
    c,s = mx.cos(p[...,10:11]),mx.sin(p[...,10:11])
    x,y = t*c+b*s,b*c-t*s
    nv,nl = dot(n,view),dot(n,light)
    h = unit(view+light)
    nh = mx.maximum(dot(n,h),0)
    ax,ay = p[...,8],p[...,9]
    d = 1/(math.pi*ax*ay*((dot(x,h)/ax)**2+(dot(y,h)/ay)**2+nh**2)**2+1e-12)
    def mask(w,z):
        return mx.sqrt(1+((dot(x,w)*ax)**2+(dot(y,w)*ay)**2)/mx.maximum(z*z,1e-8))
    g = 2/(mask(view,nv)+mask(light,nl))
    f0 = p[...,3:6]
    f = f0+(1-f0)*mx.maximum(1-dot(view,h),0)[...,None]**5
    value = p[...,:3]*(mx.maximum(nl,0)/math.pi)[...,None]+f*(d*g/(4*mx.maximum(nv,1e-5)))[...,None]
    valid = (nv>0)&(nl>0)&(view[...,2]>0)&(light[...,2]>0)
    return mx.where(valid[...,None],value,0)


def directions(count, seed):
    """Reproducible broad and near-mirror pairs; no scene lighting is stored."""
    if type(count) is not int or count<2: raise ValueError('At least two directional pairs required')
    rng=np.random.default_rng(seed)
    def hemi(n, low=.08):
        z=rng.uniform(low,1,n); a=rng.uniform(0,2*math.pi,n); r=np.sqrt(1-z*z)
        return np.stack((r*np.cos(a),r*np.sin(a),z),axis=-1)
    v=hemi(count); l=hemi(count)
    half=count//2; h=np.column_stack((rng.normal(0,.25,(half,2)),np.ones(half)))
    h/=np.linalg.norm(h,axis=1,keepdims=True)
    mirror=2*np.sum(v[:half]*h,axis=1,keepdims=True)*h-v[:half]
    l[:half]=np.where(mirror[:,2:3]>.02,mirror,l[:half])
    return mx.array(v.astype(np.float32)),mx.array(l.astype(np.float32))


def fit_tile(target, view, light, *, steps):
    """Fit any batch of texels; directions occupy the penultimate axis."""
    if type(steps) is not int or steps<1: raise ValueError('Positive fit steps required')
    labels=np.asarray(target,dtype=np.float32)
    if labels.ndim!=3 or not labels.size or labels.shape[1:]!=(len(view),3) or not np.isfinite(labels).all() or (labels<0).any():
        raise ValueError('Expected nonempty, finite, nonnegative [texel, direction, RGB] responses')
    p=mx.broadcast_to(mx.array([.04,.04,.04,.25,.25,.25,0,0,.28,.45,0]),(len(labels),1,11))
    lo=mx.array([0.]*6+[-1.5,-1.5,.012,.012,-math.pi])
    hi=mx.array([1.]*6+[1.5,1.5,1.,1.,math.pi])
    initial=p
    log_target=mx.log1p(mx.array(labels))
    def loss(params,v,l,labels):
        error=mx.log1p(response(params,v,l))-labels
        return mx.mean(mx.sqrt(error*error+1e-6))
    gradient=mx.grad(loss)
    def update(params,m,v,rate,step,view,light,labels):
        grad=gradient(params,view,light,labels)
        m=.9*m+.1*grad
        v=.999*v+.001*grad*grad
        delta=(m/(1-.9**step))/(mx.sqrt(v/(1-.999**step))+1e-8)
        return mx.clip(params-rate*delta,lo,hi),m,v
    step=mx.compile(update) if mx.default_device()==mx.gpu else update
    m,v=mx.zeros_like(p),mx.zeros_like(p)
    for i in range(steps):
        rate=.02*(.15+.85*(1+math.cos(math.pi*i/steps))*.5)
        p,m,v=step(p,m,v,mx.array(rate),mx.array(float(i+1)),view,light,log_target)
        mx.eval(p,m,v)
    return initial,p


def fit_level(evaluate, size, *, steps, pairs, chunk, seed, uv_origin=(0.,0.), uv_extent=(1.,1.)):
    """The caller owns source identity and how each texel footprint is integrated."""
    if type(size) is not int or size<1 or type(chunk) is not int or chunk<1:
        raise ValueError('Positive grid and batch dimensions required')
    view,light=directions(pairs,seed)
    held_view,held_light=directions(pairs,seed+1)
    y,x=np.mgrid[:size,:size]
    uv=(np.stack((x.ravel(),y.ravel()),axis=1)+.5)/size
    uv=(uv*np.asarray(uv_extent)+np.asarray(uv_origin)).astype(np.float32)
    out=[]; errors=[]
    for start in range(0,len(uv),chunk):
        tile=uv[start:start+chunk]
        def query(v,l):
            q=np.concatenate((np.broadcast_to(tile[:,None,:],(len(tile),len(v),2)),
                              np.broadcast_to(np.asarray(v),(len(tile),len(v),3)),
                              np.broadcast_to(np.asarray(l),(len(tile),len(l),3))),axis=2)
            labels=evaluate(q.reshape(-1,8))
            return np.asarray(labels,dtype=np.float32).reshape(len(tile),len(v),3)
        _,fit=fit_tile(query(view,light),view,light,steps=steps)
        target=np.asarray(query(held_view,held_light))
        if not np.isfinite(target).all() or (target<0).any():
            raise ValueError('Held-out source response is invalid')
        pred=np.asarray(response(fit,held_view,held_light))
        if not np.isfinite(pred).all(): raise ValueError('Nonfinite fitted response')
        out.append(np.asarray(fit[:,0]));errors.append(np.abs(np.log1p(pred)-np.log1p(target)).mean(axis=(1,2)))
    return np.concatenate(out).reshape(size,size,11),float(np.concatenate(errors).mean())
