"""Retain raw TRELLIS surface/material rows as oriented patches, without mesh finishing.

Normal construction follows Dark Side's build_surfels.py prototype. Material
layout follows trellmlx/texture_bake.py: sRGB, metallic, roughness, opacity.
An optional normalized Y-up region selects a spatial comparison, never a stride.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np

def selected_triangles(faces, ids, count):
    remap = np.full(count, -1, dtype=np.int64)
    remap[ids] = np.arange(len(ids))
    mapped = remap[faces]
    return mapped[(mapped >= 0).all(axis=1)].astype('<u4')

def rows(vertices, faces, material):
    if vertices.ndim != 2 or vertices.shape[1] != 3 or material.shape != (len(vertices), 6):
        raise ValueError('Expected aligned raw vertices and six-channel material rows')
    if not np.isfinite(vertices).all() or not np.isfinite(material).all():
        raise ValueError('Nonfinite source fields')
    if faces.ndim != 2 or faces.shape[1] != 3 or faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError('Invalid raw triangles')
    v = vertices.astype(np.float64)
    fn = np.cross(v[faces[:, 1]]-v[faces[:, 0]], v[faces[:, 2]]-v[faces[:, 0]])
    n = np.zeros_like(v)
    for k in range(3): np.add.at(n, faces[:, k], fn)
    lengths = np.linalg.norm(n, axis=1)
    valid = lengths > 1e-12
    n[valid] /= lengths[valid, None]
    n[~valid] = [0, 0, 1]
    yup = lambda a: np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)
    # Preserve raw material values. Only the renderer clamps/linearizes them.
    return np.concatenate([yup(v), yup(n), material], axis=1).astype('<f4'), int((~valid).sum())

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoints', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--region', nargs=6, type=float)
    a = p.parse_args(); a.output.mkdir(parents=True, exist_ok=True)
    report = {'schema':'trellis-surfel-fields.v1','ok':False,'phase':'load',
              'source':str(a.checkpoints),'regionNormalizedYUp':a.region,
              'layout':['x','y','z','nx','ny','nz','r','g','b','metallic','roughness','opacity']}
    try:
        mesh_path=a.checkpoints/'mesh_raw.npz'; texture_path=a.checkpoints/'texture.npz'
        report['sourceHashes']={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in [mesh_path,texture_path]}
        with np.load(mesh_path) as mesh, np.load(texture_path) as tex:
            faces=mesh['faces']
            report['phase']='derive'; data,bad=rows(mesh['vertices'],faces,tex['tex_np'])
        report['sourceCount']=len(data); report['fallbackNormals']=bad
        lo=data[:,:3].min(0); hi=data[:,:3].max(0)
        report['sourceBounds']=[lo.tolist(),hi.tolist()]
        if a.region:
            r=np.array(a.region)
            if np.any(r[:3]<0) or np.any(r[3:]>1) or np.any(r[:3]>=r[3:]): raise ValueError('Invalid region')
            keep=((data[:,:3]>=lo+(hi-lo)*r[:3]) & (data[:,:3]<=lo+(hi-lo)*r[3:])).all(1)
        else: keep=np.ones(len(data),dtype=bool)
        ids=np.flatnonzero(keep).astype('<u4'); data=data[keep]
        if not len(data): raise ValueError('Empty spatial selection')
        report['phase']='write'; data.tofile(a.output/'surfels.f32');ids.tofile(a.output/'source-ids.u32')
        triangles=selected_triangles(faces,ids,report['sourceCount'])
        triangles.tofile(a.output/'triangles.u32')
        report['triangles']={'file':'triangles.u32','count':len(triangles),
                             'sha256':hashlib.sha256((a.output/'triangles.u32').read_bytes()).hexdigest(),
                             'sourceCount':len(faces)}
        report.update(ok=True,phase='done',count=len(data),stride=12,
                      gridSize=512,radius=0.8/512,
                      bounds=[data[:,:3].min(0).tolist(),data[:,:3].max(0).tolist()],
                      dataSHA256=hashlib.sha256((a.output/'surfels.f32').read_bytes()).hexdigest())
    except Exception as e:
        report['error']=repr(e);raise
    finally:
        (a.output/'report.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__': main()
