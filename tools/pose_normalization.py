"""Offline known-tree correspondence; neither joint inference nor anatomy truth.

A union of capsule proxies is fitted to area-weighted coarse surface cells.
Tree connectivity, soft edge-length/radius priors and centerline coverage stop
an unconstrained point-cloud warp from masquerading as articulation. This is a
local geometric hypothesis: an improved objective is NOT anatomical admission.
No watertightness or triangle connectivity is assumed by the fit.
"""
import numpy as np


def tree(joints, parents):
    joints=np.asarray(joints,dtype=float); parents=np.asarray(parents,dtype=int)
    if (joints.ndim!=2 or joints.shape[1]!=3 or len(joints)<2 or parents.shape!=(len(joints),)
            or not np.isfinite(joints).all() or parents[0]!=-1
            or any(p<0 or p>=i for i,p in enumerate(parents[1:],1))):
        raise ValueError('finite parent-before-child single tree required')
    if np.any(np.linalg.norm(joints[1:]-joints[parents[1:]],axis=1)<1e-9):
        raise ValueError('zero-length segment')
    return joints,parents


def rotation_between(a,b):
    a=np.asarray(a,dtype=float); b=np.asarray(b,dtype=float)
    if not np.isfinite([a,b]).all() or min(np.linalg.norm(a),np.linalg.norm(b))<1e-12:
        raise ValueError('nonzero finite directions required')
    a=a/np.linalg.norm(a); b=b/np.linalg.norm(b)
    c=np.clip(a@b,-1,1); v=np.cross(a,b)
    if c<-1+1e-10:
        axis=np.cross(a,np.eye(3)[np.argmin(np.abs(a))]); axis/=np.linalg.norm(axis)
        return 2*np.outer(axis,axis)-np.eye(3)
    k=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
    return np.eye(3)+k+k@k/(1+c)


def canonical_joints(rest,fitted,parents,*,match_lengths=False):
    rest,parents=tree(rest,parents); fitted,_=tree(fitted,parents)
    out=rest.copy()
    if not match_lengths:
        for i,p in enumerate(parents[1:],1):
            d=rest[i]-rest[p]
            out[i]=out[p]+d/np.linalg.norm(d)*np.linalg.norm(fitted[i]-fitted[p])
    return out


def deform_points(points,fitted,target,parents,weights):
    """Blend segment-local maps. Axial stretch is explicit; radial detail stays.

    Caller supplies a nonnegative partition (derived from surface connectivity
    by the binding consumer, not a global nearest-surface attachment).
    """
    fitted,parents=tree(fitted,parents); target,_=tree(target,parents)
    points=np.asarray(points,dtype=float); weights=np.asarray(weights,dtype=float)
    if (points.ndim!=2 or points.shape[1]!=3 or weights.shape!=(len(points),len(fitted)-1)
            or not np.isfinite(points).all() or not np.isfinite(weights).all()
            or (weights<0).any() or not np.allclose(weights.sum(axis=1),1,atol=1e-6)):
        raise ValueError('finite points and segment partition required')
    out=np.zeros_like(points)
    for edge,(i,p) in enumerate(enumerate(parents[1:],1)):
        a=fitted[i]-fitted[p]; b=target[i]-target[p]
        r=rotation_between(a,b); u=a/np.linalg.norm(a)
        axial=np.eye(3)+(np.linalg.norm(b)/np.linalg.norm(a)-1)*np.outer(u,u)
        moved=(points-fitted[p])@(r@axial).T+target[p]
        out+=weights[:,edge,None]*moved
    return out


def voxel_surface(points,area,size):
    points=np.asarray(points,dtype=float); area=np.asarray(area,dtype=float)
    if (points.ndim!=2 or points.shape[1]!=3 or not len(points) or area.shape!=(len(points),)
            or not np.isfinite(points).all() or not np.isfinite(area).all()
            or (area<0).any() or area.sum()<=0 or not np.isfinite(size) or size<=0):
        raise ValueError('finite surface, positive area and voxel size required')
    cells,inv=np.unique(np.floor(points/size).astype(np.int64),axis=0,return_inverse=True)
    mass=np.bincount(inv,weights=area,minlength=len(cells))
    positive=mass>0
    centers=np.column_stack([np.bincount(inv,weights=area*points[:,k],minlength=len(cells)) for k in range(3)])
    return centers[positive]/mass[positive,None],mass[positive]


def capsule_values(points,joints,parents,radii):
    a=joints[parents[1:]]; d=joints[1:]-a
    lengths2=np.sum(d*d,axis=1)
    # Optimizer trials can approach a collapsed edge; keep evaluation finite,
    # then reject any collapsed terminal skeleton via tree().
    t=np.clip(np.einsum('nej,ej->ne',points[:,None,:]-a,d)/np.maximum(lengths2,1e-16),0,1)
    offset=points[:,None,:]-a-t[:,:,None]*d
    distance=np.linalg.norm(offset,axis=2)
    sdf=distance-radii
    chosen=np.argmin(sdf,axis=1); rows=np.arange(len(points))
    return sdf[rows,chosen],chosen,t[rows,chosen],offset[rows,chosen]/np.maximum(distance[rows,chosen,None],1e-12)


def fit_skeleton(points,area,joints,parents,radii,*,voxel_size):
    """Regularized capsule-union fit; every positive-area cell contributes.

    SciPy is an offline-only optional tool dependency. No tighter evaluation
    limit is imposed than the solver's default; its termination is returned.
    """
    from scipy.optimize import least_squares
    from scipy.spatial import cKDTree
    from scipy.sparse import coo_array
    joints,parents=tree(joints,parents)
    points=np.asarray(points,dtype=float)
    coarse,mass=voxel_surface(points,area,voxel_size)
    radii=np.asarray(radii,dtype=float)
    if radii.shape!=(len(joints),) or not np.isfinite(radii).all() or (radii<=0).any():
        raise ValueError('positive per-joint proxy radii required')
    n=len(joints); e=n-1; m=len(coarse)
    initial_radius=(radii[1:]+radii[parents[1:]])/2
    initial_length=np.linalg.norm(joints[1:]-joints[parents[1:]],axis=1)
    scale=np.median(initial_length)
    sw=np.sqrt(mass/mass.sum())
    kd=cKDTree(coarse)
    # Three centerline locations per segment, all retained. Coverage is only an
    # unsigned proximity constraint; do not report it as a containment proof.
    sample_t=np.tile([0.,.5,1.],e)
    sample_child=np.repeat(np.arange(1,n),3); sample_parent=parents[sample_child]
    sample_edge=sample_child-1
    coverage_weight=np.sqrt(.35/len(sample_t))
    length_weight=np.sqrt(.08/e)
    radius_weight=np.sqrt(.02/e)
    prior_weight=np.sqrt(.004/n)/scale
    initial=np.r_[joints.ravel(),initial_radius]

    def evaluate(x,jac=False):
        q=x[:3*n].reshape(n,3); r=x[3*n:]
        sdf,edge,t,normal=capsule_values(coarse,q,parents,r)
        child=edge+1; parent=parents[child]
        samples=q[sample_parent]*(1-sample_t[:,None])+q[sample_child]*sample_t[:,None]
        dist,idx=kd.query(samples)
        vector=(samples-coarse[idx])/np.maximum(dist[:,None],1e-12)
        excess=np.maximum(dist-r[sample_edge],0)
        d=q[1:]-q[parents[1:]]; length=np.linalg.norm(d,axis=1)
        residual=np.r_[sdf*sw,excess*coverage_weight,
            (length-initial_length)*length_weight,
            (r-initial_radius)*radius_weight,
            ((q-joints)*prior_weight).ravel()]
        if not jac: return residual
        rr=[]; cc=[]; vv=[]
        def add(rows,cols,values):
            rr.extend(np.asarray(rows).ravel()); cc.extend(np.asarray(cols).ravel()); vv.extend(np.asarray(values).ravel())
        rows=np.arange(m)
        for k in range(3):
            add(rows,3*parent+k,-normal[:,k]*(1-t)*sw)
            add(rows,3*child+k,-normal[:,k]*t*sw)
        add(rows,3*n+edge,-sw)
        rows=m+np.arange(len(samples)); active=excess>0
        for k in range(3):
            add(rows,3*sample_parent+k,vector[:,k]*(1-sample_t)*coverage_weight*active)
            add(rows,3*sample_child+k,vector[:,k]*sample_t*coverage_weight*active)
        add(rows,3*n+sample_edge,-coverage_weight*active)
        offset=m+len(samples); rows=offset+np.arange(e)
        for k in range(3):
            derivative=d[:,k]/np.maximum(length,1e-12)*length_weight
            add(rows,3*np.arange(1,n)+k,derivative)
            add(rows,3*parents[1:]+k,-derivative)
        offset+=e
        add(offset+np.arange(e),3*n+np.arange(e),np.full(e,radius_weight))
        offset+=e
        add(offset+np.arange(3*n),np.arange(3*n),np.full(3*n,prior_weight))
        return coo_array((vv,(rr,cc)),shape=(len(residual),len(x))).tocsr()

    def metrics(x):
        q=x[:3*n].reshape(n,3); r=x[3*n:]
        sdf,edge,_,_=capsule_values(coarse,q,parents,r)
        return {'surfaceRms':float(np.sqrt(np.sum(mass*sdf*sdf)/mass.sum())),
                'surfaceMax':float(np.max(np.abs(sdf))),
                'surfaceCellsPerSegment':np.bincount(edge,minlength=e).tolist()}
    result=least_squares(evaluate,initial,jac=lambda x:evaluate(x,True),
        bounds=(np.r_[np.full(3*n,-np.inf),initial_radius*.35],
                np.r_[np.full(3*n,np.inf),initial_radius*2.5]),
        method='trf',x_scale='jac')
    fitted=result.x[:3*n].reshape(n,3); tree(fitted,parents)
    return {'joints':fitted,'radii':result.x[3*n:],'before':metrics(initial),'after':metrics(result.x),
            'inputPoints':len(points),'coarsePoints':m,'voxelSize':voxel_size,
            'solver':{'success':bool(result.success),'status':int(result.status),'message':result.message,
                      'evaluations':int(result.nfev),'cost':float(result.cost),'optimality':float(result.optimality)},
            'authority':'provisional geometric correspondence; no authored joint or containment claim',
            'regularization':{'coverage':.35,'length':.08,'radius':.02,'position':.004,
                              'radiusRatios':[.35,2.5]}}
