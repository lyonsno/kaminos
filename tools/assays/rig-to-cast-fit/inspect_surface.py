"""Orthographic geometry evidence in the existing binding coordinate frame."""
import argparse, hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def render(points, triangles, joints, names, parents, output, targets=None):
    views=[('right side',2,1,0,1),('left side',2,1,0,-1),('front',0,1,2,-1),('top',2,0,1,1)]
    panels=[]
    for title,u,v,d,sign in views:
        im=Image.new('RGB',(1000,800),(238,238,232));draw=ImageDraw.Draw(im)
        lo=points.min(0);hi=points.max(0);scale=min(880/(hi[u]-lo[u]),650/(hi[v]-lo[v]));center=(lo+hi)/2
        def xy(p):return (500+(p[u]-center[u])*scale,425-(p[v]-center[v])*scale)
        for axis in [u,v]:
            for t in np.arange(np.floor(lo[axis]*2)/2,np.ceil(hi[axis]*2)/2+.1,.5):
                a=center.copy();b=center.copy();a[axis]=b[axis]=t
                other=v if axis==u else u;a[other]=lo[other]-.2;b[other]=hi[other]+.2
                draw.line([xy(a),xy(b)],fill=(205,210,211));draw.text(xy(a),f'{t:.1f}',fill=(90,90,90))
        faces=points[triangles];normals=np.cross(faces[:,1]-faces[:,0],faces[:,2]-faces[:,0]);normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-12)
        depth=faces[:,:,d].mean(1)*sign
        for i in np.argsort(depth):
            shade=int(125+90*abs(normals[i,d]));draw.polygon([xy(p) for p in faces[i]],fill=(shade,int(shade*.91),int(shade*.73)))
        for i,p in enumerate(joints):
            if parents[i]>=0:draw.line([xy(joints[parents[i]]),xy(p)],fill=(5,130,195),width=2)
            x,y=xy(p);draw.ellipse([x-3,y-3,x+3,y+3],fill=(0,90,220));draw.text((x+4,y),str(i),fill=(0,50,180))
        if targets is not None:
            for i,p in enumerate(targets):
                if parents[i]>=0:draw.line([xy(targets[parents[i]]),xy(p)],fill=(220,40,65),width=3)
                x,y=xy(p);draw.ellipse([x-3,y-3,x+3,y+3],fill=(220,40,65))
        draw.text((20,20),title+' | blue: original rig'+(' | red: fitted rig' if targets is not None else ''),fill=(0,0,0))
        draw.text((20,45),f'horizontal: {"XYZ"[u]}, vertical: {"XYZ"[v]} | units: source femur length',fill=(0,0,0))
        panels.append(im)
    sheet=Image.new('RGB',(2000,1600));
    for i,im in enumerate(panels):sheet.paste(im,((i%2)*1000,(i//2)*800))
    sheet.save(output)

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--package',type=Path,required=True);a.add_argument('--out',type=Path,required=True);args=a.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    m=json.loads((args.package/'manifest.json').read_text());p=np.fromfile(args.package/'rest.bin',dtype='<f4').reshape(-1,3);t=np.fromfile(args.package/'triangles.bin',dtype='<u4').reshape(-1,3)
    names=[b['name'] for b in m['bones']];parents=[names.index(b['parent']) if b['parent'] else -1 for b in m['bones']];j=np.array([b['restMatrix'] for b in m['bones']])[:,:3,3]
    render(p,t,j,names,parents,args.out/'original-rig-multiview.png')
    (args.out/'geometry.json').write_text(json.dumps({'bounds':[p.min(0).tolist(),p.max(0).tolist()],'joints':[{'index':i,'name':n,'parent':parents[i],'position':j[i].tolist()} for i,n in enumerate(names)],'manifestSha256':hashlib.sha256((args.package/'manifest.json').read_bytes()).hexdigest(),'allTrianglesRendered':len(t),'coordinateFrame':'original bound rest.bin, source-femur normalized; Y up, -Z front'},indent=2)+'\n')
