"""Select complete raw triangles intersecting physical support AABBs, with aligned PBR rows."""
import argparse,hashlib,json,os
from pathlib import Path
import numpy as np

def select(data,faces,region):
    n=np.asarray(region['normal'],dtype=np.float64);n/=np.linalg.norm(n)
    u=np.asarray(region['tangent'],dtype=np.float64);u-=n*np.dot(n,u);u/=np.linalg.norm(u)
    v=np.cross(n,u);origin=np.asarray(region['origin']);radius=region['radius']
    corners=np.array([origin+x*radius*u+y*radius*v+z*n for x in [-1,1] for y in [-1,1] for z in [-region['depth'],region['top']]])
    lo,hi=corners.min(0),corners.max(0)
    points=data[faces,:3]
    selected=np.flatnonzero(((points.max(1)>=lo)&(points.min(1)<=hi)).all(1)).astype('<u4')
    if not len(selected):raise ValueError('Support does not intersect raw triangles')
    vertices,remapped=np.unique(faces[selected].reshape(-1),return_inverse=True)
    return data[vertices].copy(),remapped.astype('<u4').reshape(-1,3),vertices.astype('<u4'),selected

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('regions',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=True);report={'ok':False,'phase':'admission','job':os.environ.get('GREENROOM_JOB_ID'),'source':str(a.source),'regions':{}}
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    try:
        if not report['job']:raise ValueError('Raw region extraction requires Greenroom admission')
        report['phase']='source';meta=json.loads((a.source/'report.json').read_text())
        if not meta['ok'] or meta['stride']!=12:raise ValueError('Completed aligned raw-field source required')
        for file,expected in [('surfels.f32',meta['dataSHA256']),('triangles.u32',meta['triangles']['sha256'])]:
            if digest(a.source/file)!=expected:raise ValueError('Raw field source hash mismatch: '+file)
        data=np.memmap(a.source/'surfels.f32',mode='r',dtype='<f4').reshape(meta['count'],12)
        faces=np.memmap(a.source/'triangles.u32',mode='r',dtype='<u4').reshape(-1,3)
        for name,region in json.loads(a.regions.read_text()).items():
            report['phase']='extract:'+name;out=a.output/name;out.mkdir(exist_ok=True)
            selected,triangles,vertex_ids,triangle_ids=select(data,faces,region)
            for file,array in [('surfels.f32',selected),('triangles.u32',triangles),('source-vertex-ids.u32',vertex_ids),('source-triangle-ids.u32',triangle_ids)]:array.tofile(out/file)
            m={'schema':'trellis-raw-region.v1','ok':True,'source':str(a.source),'sourceHashes':meta['sourceHashes'],'region':region,'selection':'all complete raw triangles with AABB intersection; no stride or triangle reduction; exact GPU volume clip follows','count':len(selected),'stride':12,'dataSHA256':digest(out/'surfels.f32'),'triangles':{'file':'triangles.u32','count':len(triangles),'sourceCount':len(faces),'sha256':digest(out/'triangles.u32')},'sourceTriangleIds':{'file':'source-triangle-ids.u32','sha256':digest(out/'source-triangle-ids.u32')},'sourceVertexIds':{'file':'source-vertex-ids.u32','sha256':digest(out/'source-vertex-ids.u32')}}
            (out/'report.json').write_text(json.dumps(m,indent=2));report['regions'][name]=m
        report.update(ok=True,phase='done')
    except Exception as e:report['error']=repr(e);raise
    finally:(a.output/'report.json').write_text(json.dumps(report,indent=2))
if __name__=='__main__':main()
