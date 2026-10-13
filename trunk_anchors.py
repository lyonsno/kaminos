"""Provisional axial surface anchors from the given rig, without painted labels."""
import numpy as np

AXIAL=('pelvis','spine-lumbar','spine-chest')

def derive_trunk_anchors(points,triangles,bones):
    points=np.asarray(points,dtype=float);triangles=np.asarray(triangles)
    if points.ndim!=2 or points.shape[1]!=3 or not np.isfinite(points).all():raise ValueError('invalid trunk geometry')
    if triangles.ndim!=2 or triangles.shape[1]!=3 or not len(triangles) or not np.issubdtype(triangles.dtype,np.integer) or triangles.min()<0 or triangles.max()>=len(points):raise ValueError('invalid trunk topology')
    by_name={b['name']:b for b in bones}
    if not all(n in by_name for n in AXIAL):raise ValueError('distributed trunk requires given pelvis/lumbar/chest')
    matrices={n:np.asarray(by_name[n]['restMatrix'],dtype=float) for n in AXIAL}
    if any(m.shape!=(4,4) or not np.isfinite(m).all() for m in matrices.values()):raise ValueError('invalid axial rest frame')
    heads={n:m[:3,3] for n,m in matrices.items()}
    a=points[triangles[:,0]];e1=points[triangles[:,1]]-a;e2=points[triangles[:,2]]-a
    overrides={};rays=[]
    for k,name in enumerate(AXIAL):
        origin=heads[name]
        tangent=heads[AXIAL[k+1]]-origin if k+1<len(AXIAL) else origin-heads[AXIAL[k-1]]
        length=np.linalg.norm(tangent)
        if length<1e-12:raise ValueError('degenerate given axial segment')
        tangent/=length
        projected=[matrices[name][:3,j]-tangent*np.dot(matrices[name][:3,j],tangent) for j in range(3)]
        u=next((v/np.linalg.norm(v) for v in projected if np.linalg.norm(v)>1e-8),None)
        if u is None:raise ValueError('axial frame has no transverse basis')
        v=np.cross(tangent,u);seeds=[]
        for index in range(8):
            angle=index*np.pi/4;direction=np.cos(angle)*u+np.sin(angle)*v
            cross=np.cross(np.broadcast_to(direction,e2.shape),e2);det=np.einsum('ij,ij->i',e1,cross)
            valid=np.abs(det)>1e-12;inverse=np.zeros(len(det));inverse[valid]=1/det[valid]
            offset=origin-a;bary_u=np.einsum('ij,ij->i',offset,cross)*inverse
            q=np.cross(offset,e1);bary_v=q@direction*inverse;distance=np.einsum('ij,ij->i',e2,q)*inverse
            valid&=(bary_u>=-1e-10)&(bary_v>=-1e-10)&(bary_u+bary_v<=1+1e-10)&(distance>1e-9)
            hits=np.flatnonzero(valid);row={'bone':name,'angularSample':index,'origin':origin.tolist(),'direction':direction.tolist()}
            if len(hits):
                triangle=int(hits[np.argmin(distance[hits])]);hit=origin+distance[triangle]*direction
                vertices=triangles[triangle];seed=int(vertices[np.argmin(np.sum((points[vertices]-hit)**2,axis=1))]);seeds.append(seed)
                row.update(status='hit',triangle=triangle,distance=float(distance[triangle]),point=hit.tolist(),vertex=seed)
            else:row['status']='miss'
            rays.append(row)
        # Misses stay explicit. The original point seed remains in extend_weights.
        if seeds:overrides[name]=sorted(set(seeds))
    return overrides,{'kind':'given-axial-transverse-first-hit-surface-seeds','angularSamples':8,'seeds':overrides,'rays':rays,
                      'authority':'provisional rest-geometry support anchors, not authored tissue attachments','missPolicy':'retain original point seed; no invented ray hit'}
