"""Fit an existing joint tree to explicitly named, provisional 3D landmarks."""
import numpy as np

def fit_tree(rest, parents, targets, *, vary_lengths=False):
    from scipy.optimize import least_squares
    rest=np.asarray(rest,float);parents=np.asarray(parents,int);n=len(rest)
    if rest.shape!=(n,3) or n<2 or not np.isfinite(rest).all() or parents.shape!=(n,) or parents[0]!=-1 or any(p<0 or p>=i for i,p in enumerate(parents[1:],1)):
        raise ValueError('finite parent-before-child tree required')
    d=rest[1:]-rest[parents[1:]];length=np.linalg.norm(d,axis=1)
    if np.any(length<1e-8):raise ValueError('zero-length edge')
    if not targets:raise ValueError('named landmark evidence required')
    ids=np.asarray([t['joint'] for t in targets]);points=np.asarray([t['point'] for t in targets],float);sigma=np.asarray([t['sigma'] for t in targets],float)
    if ids.dtype.kind not in 'iu' or np.any(ids<0) or np.any(ids>=n) or len(set(ids))!=len(ids) or points.shape!=(len(ids),3) or not np.isfinite(points).all() or not np.isfinite(sigma).all() or np.any(sigma<=0):
        raise ValueError('unique in-tree landmarks with finite coordinates and positive uncertainty required')
    original_direction=d/length[:,None]
    guessed=rest+np.median(points-rest[ids],axis=0);guessed[ids]=points
    gd=guessed[1:]-guessed[parents[1:]]
    gd=np.where((np.linalg.norm(gd,axis=1)>1e-8)[:,None],gd,d)
    bearings=np.column_stack([np.arctan2(gd[:,0],gd[:,2]),np.arctan2(gd[:,1],np.hypot(gd[:,0],gd[:,2]))])
    initial=np.r_[guessed[0],bearings.ravel(),np.zeros(n-1) if vary_lengths else []]
    def expand(x):
        a=x[3:3+2*(n-1)].reshape(-1,2);az,el=a.T
        direction=np.column_stack([np.sin(az)*np.cos(el),np.sin(el),np.cos(az)*np.cos(el)])
        lengths=length*(np.exp(x[3+2*(n-1):]) if vary_lengths else 1)
        q=np.empty_like(rest);q[0]=x[:3]
        for i,p in enumerate(parents[1:],1):q[i]=q[p]+direction[i-1]*lengths[i-1]
        return q,direction,lengths
    def residual(x):
        q,direction,lengths=expand(x)
        # Position uncertainties describe provisional landmarks, not truth.
        # Weak direction prior resolves unconstrained twist/pose alternatives.
        pieces=[((q[ids]-points)/sigma[:,None]).ravel(),(.15*(direction-original_direction)).ravel()]
        if vary_lengths:pieces.append(2*np.log(lengths/length))
        return np.concatenate(pieces)
    result=least_squares(residual,initial,method='trf',x_scale='jac')
    q,_,lengths=expand(result.x);errors=np.linalg.norm(q[ids]-points,axis=1)
    return {'joints':q.tolist(),'parents':parents.tolist(),'varyLengths':vary_lengths,
            'lengthRatios':(lengths/length).tolist(),'maxOriginalLengthError':float(np.max(abs(lengths-length))),
            'landmarks':[dict(t,error=float(e),originalError=float(np.linalg.norm(rest[t['joint']]-t['point']))) for t,e in zip(targets,errors)],
            'landmarkRms':float(np.sqrt(np.mean(errors**2))),
            'solver':{'success':bool(result.success),'status':int(result.status),'message':result.message,'evaluations':result.nfev,'cost':float(result.cost),'optimality':float(result.optimality)},
            'regularization':{'direction':.15,'logLength':2 if vary_lengths else None},
            'claimCeiling':'Fit to explicit provisional landmark hypotheses; no anatomical ground truth'}
