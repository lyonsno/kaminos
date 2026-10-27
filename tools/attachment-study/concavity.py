"""Provisional rest-surface concavity cost; no production binding default.

Distances are computed on exact-position welded original edges. All vertices and
triangles remain intact in exported packages. Normals are oriented by the source
triangles; an inside-out or poorly oriented surface invalidates interpretation.
"""
import heapq
import numpy as np


def edge_penalty(points, normals, edges, scale, gain=1.):
    points=np.asarray(points); normals=np.asarray(normals); edges=np.asarray(edges)
    if not np.isfinite(scale) or scale<=0 or not np.isfinite(gain) or gain<0:
        raise ValueError('Positive scale and nonnegative gain required')
    delta=points[edges[:,1]]-points[edges[:,0]]
    length=np.linalg.norm(delta,axis=1)
    turn=np.einsum('ij,ij->i',normals[edges[:,1]]-normals[edges[:,0]],delta)/np.maximum(length,1e-15)
    return gain*scale*np.maximum(-turn,0.)


def surface(points, triangles, radius):
    unique,inverse=np.unique(points,axis=0,return_inverse=True)
    tri=inverse[triangles]
    edges=np.sort(np.concatenate([tri[:,[0,1]],tri[:,[1,2]],tri[:,[2,0]]]),axis=1)
    edges=np.unique(edges[edges[:,0]!=edges[:,1]],axis=0)
    delta=unique[edges[:,1]]-unique[edges[:,0]];length=np.linalg.norm(delta,axis=1)
    raw=np.cross(unique[tri[:,1]]-unique[tri[:,0]],unique[tri[:,2]]-unique[tri[:,0]])
    normals=np.zeros_like(unique,dtype=float)
    for j in range(3):
        for k in range(3): normals[:,k]+=np.bincount(tri[:,j],weights=raw[:,k],minlength=len(unique))
    normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-15)
    # A diffusion radius in source units, rather than a fixed iteration count per cast.
    iterations=int(np.ceil((radius/np.sqrt(np.mean(length**2)))**2))
    a,b=edges.T;degree=np.bincount(np.r_[a,b],minlength=len(unique)).astype(float)
    for _ in range(iterations):
        sums=np.column_stack([np.bincount(a,weights=normals[b,k],minlength=len(unique))+np.bincount(b,weights=normals[a,k],minlength=len(unique)) for k in range(3)])
        normals=.5*normals+.5*sums/np.maximum(degree[:,None],1)
    normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-15)
    return unique,inverse,edges,length,normals,{'weldedVertices':len(unique),'edges':len(edges),'normalRadius':radius,'normalIterations':iterations,'zeroNormals':int(np.sum(np.linalg.norm(normals,axis=1)<.5))}


def distances(n, edges, costs, seed):
    adjacency=[[] for _ in range(n)]
    for (a,b),v in zip(edges,costs): adjacency[a].append((int(b),float(v)));adjacency[b].append((int(a),float(v)))
    d=np.full(n,np.inf);d[seed]=0;queue=[(0.,int(seed))]
    while queue:
        v,i=heapq.heappop(queue)
        if v!=d[i]: continue
        for j,c in adjacency[i]:
            w=v+c
            if w<d[j]:d[j]=w;heapq.heappush(queue,(w,j))
    return d


def redistribute(weights, channels, attenuation):
    """Transfer each explicit side's proximal pull to chest; conserve all other channels."""
    out=weights.copy();chest=channels.index('spine-chest')
    for side,factor in attenuation.items():
        factor=np.asarray(factor)
        if factor.shape!=(len(weights),) or not np.isfinite(factor).all() or np.any((factor<0)|(factor>1)):
            raise ValueError('Attenuation must be finite and within [0,1]')
        for joint in ['shoulder','elbow','wrist','toe']:
            k=channels.index('forelimb-'+side+'-'+joint)
            moved=out[:,k]*(1-factor);out[:,k]-=moved;out[:,chest]+=moved
    return out
