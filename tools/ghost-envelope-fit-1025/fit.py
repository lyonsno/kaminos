"""Reversible assay: named radii on the authored rig, with frozen camera/joints."""
import argparse, hashlib, json, traceback
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from ray_envelope import sphere_depth, cone_depth, require_target

GROUPS=['pelvis','lumbar','chest','neck','head','forelimbs','hindlimbs','paws','tail']

def group(name):
    if name in ('pelvis','spine-lumbar','spine-chest'):
        return {'pelvis':'pelvis','spine-lumbar':'lumbar','spine-chest':'chest'}[name]
    if name=='neck': return 'neck'
    if name.startswith('head'): return 'head'
    if name.startswith('tail'): return 'tail'
    if name.endswith(('-toe','-mtp','-toe-tip')): return 'paws'
    if name.startswith('forelimb'): return 'forelimbs'
    if name.startswith('hindlimb'): return 'hindlimbs'
    raise ValueError('unknown joint role '+name)

def radius(name, f):
    if name in f: return f[name]
    if name.startswith('tail-'): return f['tail'][int(name.split('-')[-1])-1]
    if name.endswith('-toe-tip'): return f['toe-tip']
    if name.endswith('-toe'): return f['hind-toe']  # exact original render recipe
    return f[name.split('-')[-1]]

class Envelope:
    def __init__(self,rig,f,camera,size):
        self.names=rig['names'];self.parents=rig['parents'];self.size=size
        p=np.asarray(rig['positions'],float)
        self.points=np.stack([p[:,0],-p[:,2],p[:,1]],axis=-1)
        self.radii=np.array([radius(n,f)*rig['trunkLength'] for n in self.names])
        self.groups=np.array([GROUPS.index(group(n)) for n in self.names])
        world=np.array(camera['camera_world']);proj=np.array(camera['projection'])
        self.origin=world[:3,3]
        yy,xx=np.mgrid[:size,:size]
        local=np.stack([(2*(xx+.5)/size-1)/proj[0,0],(1-2*(yy+.5)/size)/proj[1,1],-np.ones_like(xx)],axis=-1)
        self.rays=local@world[:3,:3].T

    def render(self,logs):
        scales=np.exp(logs)
        if not np.isfinite(scales).all() or (scales<=0).any(): raise ValueError('invalid radius multiplier')
        radii=self.radii*scales[self.groups]
        depth=np.full((self.size,self.size),np.inf)
        labels=np.full(depth.shape,-1,np.int16)
        for i,(p,r) in enumerate(zip(self.points,radii)):
            candidate=sphere_depth(self.origin,self.rays,p,r)
            parent=self.parents[i]
            if parent>=0:
                candidate=np.minimum(candidate,cone_depth(self.origin,self.rays,self.points[parent],p,radii[parent],r))
            hit=candidate<depth
            labels[hit]=self.groups[i];depth=np.minimum(depth,candidate)
        return depth,labels

def metrics(pred,target,mask):
    foreground=np.isfinite(pred)
    both=foreground&mask
    union=foreground|mask
    if not both.any():
        return dict(iou=0.,overlap_pixels=0,depth_rmse=None,depth_scale=None,depth_span_normalized_rmse=None)
    scale=float(np.sum(target[both]*pred[both])/np.sum(target[both]**2))
    rmse=float(np.sqrt(np.mean((scale*target[both]-pred[both])**2)))
    # Denominator uses the complete target foreground after one global scale.
    span=float(np.ptp(target[mask])*scale)
    return dict(iou=float(both.sum()/union.sum()),overlap_pixels=int(both.sum()),
                target_pixels=int(mask.sum()),predicted_pixels=int(foreground.sum()),
                false_positive_pixels=int((foreground&~mask).sum()),false_negative_pixels=int((mask&~foreground).sum()),
                depth_scale=scale,depth_rmse=rmse,depth_span_normalized_rmse=rmse/max(span,1e-12))

def objective(model,logs,target,mask,depth_weight):
    depth,_=model.render(logs);m=metrics(depth,target,mask)
    loss=1-m['iou']+.003*float(np.mean(logs**2))
    loss+=depth_weight*(m['depth_span_normalized_rmse'] if m['overlap_pixels'] else 10.)
    return loss,m

def fit(model,target,mask,depth_weight):
    # Pixel-bounded coordinate refinement; termination is step resolution, not a wall-clock or iteration cap.
    logs=np.zeros(len(GROUPS));value,m=objective(model,logs,target,mask,depth_weight)
    history=[dict(step=0.,group=None,loss=value,metrics=m,logs=logs.tolist())]
    step=.2
    while step>=.0125:
        changed=True
        while changed:
            changed=False
            for i,name in enumerate(GROUPS):
                candidates=[]
                for direction in (-1,1):
                    trial=logs.copy();trial[i]+=direction*step
                    score,metric=objective(model,trial,target,mask,depth_weight)
                    candidates.append((score,trial,metric))
                score,trial,metric=min(candidates,key=lambda row:row[0])
                if score<value-1e-10:
                    logs,value,m=trial,score,metric;changed=True
                    history.append(dict(step=step,group=name,loss=value,metrics=m,logs=logs.tolist()))
        step/=2
    return logs,history

def overlay(target,depth):
    result=np.full((*target.shape,3),24,np.uint8);mask=np.isfinite(depth)
    result[target]=[205,71,85];result[mask]=[43,164,218];result[target&mask]=[220,215,185]
    return Image.fromarray(result)

def main(args):
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    report={'status':'running','phase':'inputs','source_revision':args.source_revision,
            'route':'analytic sphere/cone union; exact recorded source perspective; authored joint centers and graph fixed',
            'limits':['Named controls come from source rig; no target semantic limb segmentation.',
                      'Single-view radius fit is a provisional envelope proposal, not recovered anatomy or a moving-body pass.',
                      'Target depth has one fitted global scale; its absolute scale and camera remain uncertain.'],
            'optimizer':{'size':128,'final_size':512,'initial_log_step':.2,'final_log_step':.0125,'prior_weight':.003,'depth_arm_weight':.15},
            'inputs':{}}
    def save(): (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        root=Path(args.evidence_root)
        files={'rig':root/'sources/rest-data.json','radii':root/'sources/role-radius-fractions.json',
               'camera':root/'operator-followup-1025/depth-control/ground-truth/report.json',
               'known':root/'operator-followup-1025/depth-control/ground-truth/exact-depth.npz',
               'target':root/'operator-followup-1025/depth-control/inference/generated-cat/raw-0.npz',
               'target_image':root/'anatomy-pass/capsule-flux3/generated.png'}
        for name,path in files.items():report['inputs'][name]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        rig=next(r for r in json.loads(files['rig'].read_text())['rigs'] if r['id']=='ours-toes')
        f=json.loads(files['radii'].read_text())['f'];camera=json.loads(files['camera'].read_text())
        gt=np.load(files['known']);target=np.load(files['target']);require_target(gt['depth'],gt['mask']);require_target(target['depth'],target['mask'])
        model=Envelope(rig,f,camera,512);initial,labels=model.render(np.zeros(len(GROUPS)))
        control=metrics(initial,gt['depth'],gt['mask']);both=np.isfinite(initial)&gt['mask']
        control['unscaled_rmse']=float(np.sqrt(np.mean((initial[both]-gt['depth'][both])**2)))
        report['known_control']=control;report['phase']='known-control';save()
        np.savez_compressed(out/'known-control.npz',analytic=initial,ground_truth=gt['depth'],ground_truth_mask=gt['mask'],labels=labels)
        if control['iou']<.98 or control['unscaled_rmse']>.01*float(np.ptp(gt['depth'][gt['mask']])):
            raise ValueError('analytic route does not reproduce known Blender geometry/camera sufficiently')
        small=Envelope(rig,f,camera,128)
        td=np.asarray(Image.fromarray(target['depth']).resize((128,128),Image.Resampling.NEAREST))
        tm=np.asarray(Image.fromarray(target['mask']).resize((128,128),Image.Resampling.NEAREST))
        require_target(td,tm)
        report['phase']='fit';report['baseline']=metrics(initial,target['depth'],target['mask']);save()
        images=[Image.open(files['target_image']).convert('RGB'),overlay(target['mask'],initial)]
        titles=['Frozen generated target','Original authored envelope']
        report['arms']={}
        for name,weight in [('silhouette',0.),('silhouette-plus-depth',.15)]:
            logs,history=fit(small,td,tm,weight)
            depth,regions=model.render(logs)
            parameters={n:float(v) for n,v in zip(GROUPS,np.exp(logs))}
            joint_radii={n:float(r) for n,r in zip(model.names,model.radii*np.exp(logs)[model.groups])}
            result={'multipliers':parameters,'joint_radii':joint_radii,'metrics512':metrics(depth,target['depth'],target['mask']),
                    'metrics128':history[-1]['metrics'],'accepted_steps':history,'depth_weight':weight}
            (out/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n')
            np.savez_compressed(out/(name+'.npz'),depth=depth,regions=regions,mask=np.isfinite(depth),target_depth=target['depth'],target_mask=target['mask'])
            report['arms'][name]={k:v for k,v in result.items() if k!='accepted_steps'};save()
            images.append(overlay(target['mask'],depth));titles.append(name)
        sheet=Image.new('RGB',(1024,1140),(24,24,24));draw=ImageDraw.Draw(sheet)
        for i,(im,title) in enumerate(zip(images,titles)):
            x=(i%2)*512;y=(i//2)*570
            draw.text((x+12,y+10),title,fill='white',font_size=22);sheet.paste(im,(x,y+48))
        draw.text((12,1120),'Beige: overlap / Red: target only / Blue: envelope only',fill='white',font_size=16)
        sheet.save(out/'comparison.png')
        report['phase']='complete';report['status']='complete';save()
    except Exception:
        report['status']='failed';report['error']=traceback.format_exc();save();raise

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--evidence-root',required=True);parser.add_argument('--source-revision',required=True)
    main(parser.parse_args())
