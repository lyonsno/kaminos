"""Experimental fixed-joint sphere/cone envelope; perspective axial depth."""
import numpy as np


def sphere_depth(origin, rays, center, radius):
    q = np.asarray(origin) - center
    a = np.sum(rays * rays, axis=-1)
    b = rays @ q
    c = q @ q - radius * radius
    det = b*b-a*c
    root = np.sqrt(np.maximum(det, 0))
    t0, t1 = (-b-root)/a, (-b+root)/a
    t = np.where(t0 > 0, t0, t1)
    return np.where((det >= 0) & (t > 0), t, np.inf)


def cone_depth(origin, rays, start, end, radius_start, radius_end):
    axis=np.asarray(end)-start
    length=np.linalg.norm(axis)
    if length <= 1e-12:
        return sphere_depth(origin,rays,start,max(radius_start,radius_end))
    axis=axis/length
    q=np.asarray(origin)-start
    z0=q@axis
    zd=rays@axis
    qp=q-z0*axis
    dp=rays-zd[...,None]*axis
    k=(radius_end-radius_start)/length
    rz=radius_start+k*z0
    a=np.sum(dp*dp,axis=-1)-(k*zd)**2
    b=2*(dp@qp-rz*k*zd)
    c=qp@qp-rz*rz
    det=b*b-4*a*c
    root=np.sqrt(np.maximum(det,0))
    linear=np.abs(a)<1e-12
    with np.errstate(divide='ignore',invalid='ignore'):
        t0=np.where(linear,-c/b,(-b-root)/(2*a))
        t1=np.where(linear,-c/b,(-b+root)/(2*a))
    def valid(t):
        z=z0+t*zd
        return (det>=0)&np.isfinite(t)&(t>0)&(z>=0)&(z<=length)
    return np.minimum(np.where(valid(t0),t0,np.inf),np.where(valid(t1),t1,np.inf))


def require_target(depth, mask):
    if depth.shape != mask.shape or depth.ndim != 2:
        raise ValueError('depth and mask must be matching 2-D arrays')
    if not mask.any() or not np.all(np.isfinite(depth[mask]) & (depth[mask] > 0)):
        raise ValueError('target needs nonempty positive finite foreground depth')
