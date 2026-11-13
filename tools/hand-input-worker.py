"""One explicitly configured WiLoR MLX process; stdin/stdout JSON protocol.
All model imports, initialization and inference stay on this process's thread.
"""
import base64
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import traceback

def digest(path):
    with open(path,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

class WiLoRRoute:
    def __init__(self,config):
        import mlx.core as mx
        from wilor_mlx import WiLoR
        from wilor_mlx.detector import HandDetector
        from wilor_mlx.pipeline import HandPosePipeline,_crop_and_resize_mlx
        if not mx.metal.is_available():raise RuntimeError('WiLoR requires the configured MLX Metal route')
        mx.set_default_device(mx.gpu)
        self.mx=mx;self.crop=_crop_and_resize_mlx
        self.pose=WiLoR.from_pretrained(weights_path=config['weights'],mano_path=config['mano'])
        self.detector=HandDetector.from_pretrained(weights_path=config['detector'])
        self.pipeline=HandPosePipeline(self.detector,self.pose)
        self.identity={'model':'wilor','backend':'mlx-metal','sourceRoot':config['source'],
            'sourceCommit':subprocess.check_output(['git','-C',config['source'],'rev-parse','HEAD'],text=True).strip(),
            'weightsSha256':digest(config['weights']),'manoSha256':digest(config['mano']),
            'detectorSha256':digest(config['detector']),'placement':'camera-plane display; uncalibrated'}
    def loaded(self):
        import numpy as np
        faces=np.array(self.pose.mano.faces).reshape(-1).tolist()
        if len(faces)!=1538*3:raise ValueError('WiLoR MANO topology is incomplete')
        return {'identity':self.identity,'faces':faces}
    def infer(self,payload):
        import numpy as np
        from PIL import Image
        image=np.array(Image.open(io.BytesIO(base64.b64decode(payload['image'],validate=True))).convert('RGB'))
        if image.shape[1]!=payload['width'] or image.shape[0]!=payload['height']:raise ValueError('Native frame dimensions disagree with source')
        sides=payload['sides']
        if not isinstance(sides,list) or len(set(sides))!=len(sides) or any(s not in ('left','right') for s in sides):raise ValueError('Invalid requested hand sides')
        detections=self.pipeline(image,include_3d=False,include_vertices=False,conf_threshold=payload.get('threshold',.3))
        mx=self.mx;hands=[]
        for side in sides:
            found=[h for h in detections if h.hand_side==side]
            if not found:continue
            hand=max(found,key=lambda h:h.confidence)
            x0,y0,x1,y1=hand.bbox;size=max(x1-x0,y1-y0)*2.5
            crop=self.crop(mx.array(image),(x0+x1)/2,(y0+y1)/2,size,target_size=256)
            if side=='left':crop=crop[:,::-1]
            out=self.pose(crop[None]);mx.eval(out)
            vertices=np.array(out['pred_vertices'][0]);joints=np.array(out['pred_keypoints_3d'][0])
            if side=='left':vertices[:,0]*=-1;joints[:,0]*=-1
            if not np.isfinite(vertices).all() or not np.isfinite(joints).all():raise ValueError('Non-finite WiLoR geometry')
            hands.append({'handedness':side,'hasHand':True,'verticesMeters':vertices.reshape(-1).tolist(),
                'jointsMeters':joints.reshape(-1).tolist(),'nativeCamera':np.array(out['pred_cam'][0]).tolist(),
                'detection':{'bbox':hand.bbox,'keypoints':hand.keypoints_2d,'confidence':hand.confidence,'handSide':side},
                'identity':self.identity,'acquisition':{'source':'wilor_mlx_detector','fallback':False}})
        return {'hands':hands,'identity':self.identity,'frameId':payload['frameId'],'imageSize':[image.shape[1],image.shape[0]]}

route=None
for line in sys.stdin:
    try:
        payload=json.loads(line)
        with contextlib.redirect_stdout(sys.stderr):
            if payload['action']=='load':route=WiLoRRoute(payload['config']);result=route.loaded()
            elif payload['action']=='infer':
                if route is None:raise RuntimeError('WiLoR not loaded')
                result=route.infer(payload)
            else:raise ValueError('Unknown worker operation')
        print(json.dumps(result,allow_nan=False),flush=True)
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'error':str(error)}),flush=True)
