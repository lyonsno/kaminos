"""Authenticated, caller-owned offline fit/correction execution.

Run real casts through Greenroom. Inputs stay read-only; every failure produces
an independent report unless that destination itself aliases retained input.
Optional offline dependency: scipy (not part of the browser/runtime contract).
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import platform
import subprocess
import sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from pose_normalization import tree,fit_skeleton,canonical_joints,deform_points,quadruped_foot_targets


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,value):
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    Path(path).write_text(json.dumps(value,indent=2,default=lambda a:a.tolist() if isinstance(a,np.ndarray) else a)+'\n')


def record(path): return {'path':str(Path(path).resolve()),'sha256':sha(path)}


def referenced_records(value):
    if isinstance(value,dict):
        if isinstance(value.get('path'),str) and isinstance(value.get('sha256'),str):yield value
        for child in value.values():yield from referenced_records(child)
    elif isinstance(value,list):
        for child in value:yield from referenced_records(child)


def authenticate(value):
    path=Path(value['path']).resolve()
    if sha(path)!=value['sha256']: raise ValueError('source digest mismatch: '+str(path))
    return path


def load_case(value):
    path=authenticate(value); manifest=json.loads(path.read_text()); root=path.parent
    arrays={}
    for name,asset in manifest['assets'].items():
        target=(root/name).resolve()
        if target.parent!=root: raise ValueError('asset escapes package')
        if sha(target)!=asset['sha256']: raise ValueError('case asset digest mismatch: '+str(target))
        if target.stat().st_size!=asset['bytes']: raise ValueError('case asset size mismatch')
        arrays[name]=np.fromfile(target,dtype=asset['dtype']).reshape(asset['shape'])
    return manifest,arrays


def source_radii(names,values,scale):
    result=[]
    for name in names:
        key=name.split('-')[-1]
        if name.startswith('tail-'): value=values['tail'][int(key)-1]
        elif name in values: value=values[name]
        elif name=='spine-lumbar': value=values['spine-lumbar']
        elif name=='spine-chest': value=values['spine-chest']
        elif name.endswith('toe-tip'): value=values['toe-tip']
        elif key=='toe': value=values['fore-toe' if name.startswith('forelimb') else 'hind-toe']
        else: value=values[key]
        result.append(value*scale)
    return np.array(result)


def surface_area(points,triangles):
    tri=points[triangles]
    area=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)/6
    mass=np.zeros(len(points))
    for k in range(3): np.add.at(mass,triangles[:,k],area)
    return mass


def diagnostic(path,points,rest,fitted,parents):
    # Orthographic projections are fit diagnostics, not a deformed-body smoke.
    image=Image.new('RGB',(1800,850),'#242932'); draw=ImageDraw.Draw(image)
    for panel,(ax,label) in enumerate([((2,1),'SIDE · depth/up'),((0,1),'FRONT · lateral/up'),((2,0),'TOP · depth/lateral')]):
        lo=points[:,ax].min(axis=0); hi=points[:,ax].max(axis=0)
        for q in [rest,fitted]: lo=np.minimum(lo,q[:,ax].min(axis=0));hi=np.maximum(hi,q[:,ax].max(axis=0))
        scale=min(540/max(hi[0]-lo[0],1e-9),740/max(hi[1]-lo[1],1e-9))
        def project(q):
            p=(q[:,ax]-lo)*scale
            return np.column_stack([panel*600+30+p[:,0],800-p[:,1]])
        pix=project(points).astype(int)
        pixels=image.load()
        for x,y in pix:
            if 0<=x<1800 and 0<=y<850: pixels[x,y]=(150,132,100)
        for q,color in [(rest,'#ff7766'),(fitted,'#44efff')]:
            p=project(q)
            for i,parent in enumerate(parents[1:],1): draw.line([tuple(p[parent]),tuple(p[i])],fill=color,width=3)
            for x,y in p: draw.ellipse((x-3,y-3,x+3,y+3),fill=color)
        draw.text((panel*600+20,15),label+'  RED source / CYAN fitted',fill='white')
    image.save(path)


def protected_destination(out,report,protected):
    out=Path(out).resolve(); report=Path(report).absolute()
    if report.is_symlink() or (report.exists() and report.stat().st_nlink>1):
        raise ValueError('report aliases another file')
    report=report.resolve()
    for source in protected:
        source=Path(source).resolve()
        if out==source or out in source.parents or report==source:
            raise ValueError('output overlaps retained input')
    if report==out or out in report.parents: raise ValueError('report must be outside generated package')
    if out.exists() and any(out.iterdir()): raise ValueError('preserve nonempty output')
    return out,report


def run(args):
    report={'status':'running','phase':'input-discovery','requested':vars(args),'casts':[]}
    report_path=Path(args.report).absolute(); plan_path=Path(args.plan).resolve();out_path=Path(args.out).resolve()
    # A new, independent file cannot alias an existing retained input. Existing
    # destinations are not writable until source discovery establishes that.
    explicit_fit=Path(args.fit_report).resolve() if getattr(args,'fit_report',None) else None
    safe_report=(not report_path.exists() and not report_path.is_symlink()
                 and report_path.resolve()!=plan_path and report_path.resolve()!=out_path
                 and report_path.resolve()!=explicit_fit
                 and out_path not in report_path.resolve().parents)
    try:
        plan=json.loads(plan_path.read_text())
        # Exclude every direct plan reference before any later key lookup,
        # hashing or nested discovery can fail. The explicit fit-report path
        # was already excluded before even opening the plan.
        direct_paths=[plan_path,*[Path(r['path']).resolve() for r in referenced_records(plan)]]
        safe_report=safe_report and report_path.resolve() not in direct_paths
        records=[plan['frame'],plan['radii'],*plan['binderFiles'],*[c['case'] for c in plan['casts']]]
        if args.stage=='correct':
            if not args.fit_report:raise ValueError('explicit fit report required for correction')
            records.append(record(args.fit_report))
        protected=[*direct_paths,*[Path(r['path']).resolve() for r in records]]
        safe_report=safe_report and report_path.resolve() not in protected
        if args.stage=='correct':
            fit_report=json.loads(Path(args.fit_report).read_text())
            protected.extend(Path(r['path']).resolve() for r in referenced_records(fit_report))
            safe_report=safe_report and report_path.resolve() not in protected
        for case in plan['casts']:
            manifest_path=Path(case['case']['path']).resolve()
            manifest=json.loads(manifest_path.read_text())
            for name in manifest.get('assets',{}):
                protected.append((manifest_path.parent/name).resolve())
            safe_report=safe_report and report_path.resolve() not in protected
        # Validate the report independently, even when the output path is bad.
        safe_report=(not report_path.is_symlink() and not report_path.is_dir()
                     and not (report_path.exists() and report_path.stat().st_nlink>1)
                     and report_path.resolve() not in protected
                     and report_path.resolve()!=out_path and out_path not in report_path.resolve().parents)
        out,report_path=protected_destination(args.out,args.report,protected)
        if plan['schema']!='kaminos.pose-normalization-inputs.v1': raise ValueError('unknown plan schema')
        if len(plan['casts'])!=2 or len({c['slug'] for c in plan['casts']})!=2: raise ValueError('both retained casts required')
        report['phase']='authentication'
        for item in records: authenticate(item)
        report['inputs']=[record(plan_path),*records]
        frame=json.loads(Path(plan['frame']['path']).read_text())
        bones=frame['bones']; names=[b['name'] for b in bones]
        parents=np.array([-1 if b['parent'] is None else names.index(b['parent']) for b in bones])
        rest=np.array([np.array(b['restMatrix'])[:3,3] for b in bones]);tree(rest,parents)
        radii=source_radii(names,json.loads(Path(plan['radii']['path']).read_text()),np.linalg.norm(np.array(frame['sourceArmatureLocalToNormalized'])[:3,0]))
        report['runtime']={'python':sys.executable,'version':platform.python_version(),'numpy':np.__version__,
                           'sourceRevision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=Path(__file__).resolve().parents[1],text=True).strip()}
        out.mkdir(parents=True,exist_ok=True)
        if args.stage=='correct':
            fit_report=json.loads(Path(args.fit_report).read_text())
            if fit_report['status']!='completed' or fit_report['phase']!='complete': raise ValueError('fit report not completed')
            if fit_report['inputs']!=[record(plan_path),*records[:-1]]:
                raise ValueError('fit/correction input identity changed')
            binder_root=Path(plan['binderFiles'][0]['path']).parent
            sys.path.insert(0,str(binder_root))
            spec=importlib.util.spec_from_file_location('retained_full_binding',binder_root/'full-creature-binding.py')
            full=importlib.util.module_from_spec(spec);spec.loader.exec_module(full)
        for case in plan['casts']:
            slug=case['slug']
            if not slug.replace('-','').isalnum(): raise ValueError('invalid cast slug')
            report['phase']=args.stage+'-'+slug;write(report_path,report)
            manifest,arrays=load_case(case['case']);points=arrays['rest.bin'].astype(float);triangles=arrays['triangles.bin']
            if manifest['bones']!=bones: raise ValueError('case/frame identity differs')
            leaf=out/slug;leaf.mkdir()
            if args.stage=='fit':
                mass=surface_area(points,triangles)
                anchors=quadruped_foot_targets(points,mass,rest,names)
                fit=fit_skeleton(points,mass,rest,parents,radii,voxel_size=args.voxel_size,anchors=anchors)
                fitted=fit['joints']
                fit['names']=names;fit['parents']=parents
                fit['segmentLengthRatios']= (np.linalg.norm(fitted[1:]-fitted[parents[1:]],axis=1)/np.linalg.norm(rest[1:]-rest[parents[1:]],axis=1)).tolist()
                fit['sourceCase']=case['case'];write(leaf/'fit.json',fit)
                diagnostic(leaf/'fit-projections.png',points,rest,fitted,parents)
                report['casts'].append({'slug':slug,'fit':record(leaf/'fit.json'),'diagnostic':record(leaf/'fit-projections.png'),
                    'before':fit['before'],'after':fit['after'],'solver':fit['solver']})
                if not fit['solver']['success']: raise ValueError('fit did not converge: '+str(fit['solver']))
            else:
                fit_row=next(r for r in fit_report['casts'] if r['slug']==slug)
                fit=json.loads(authenticate(fit_row['fit']).read_text());fitted=np.array(fit['joints'])
                if fit['sourceCase']!=case['case'] or fit['names']!=names: raise ValueError('fit names/case changed')
                fitted_bones=copy.deepcopy(bones)
                for b,p in zip(fitted_bones,fitted):
                    for k in range(3): b['restMatrix'][k][3]=float(p[k])
                control={'paintedWeightsIncluded':False,'domainMethod':'surface','surfaceConnectivity':'coincident','articulated':True,
                         'joints':dict(zip(names,fitted.tolist())), 'bounds':{'min':points.min(axis=0).tolist(),'max':points.max(axis=0).tolist()}}
                rear=full.bind_geometry(points,triangles,control)
                binding=full.distributed_trunk_weights(points,triangles,rear['edges'],rear['jointWeights'],fitted_bones)
                # Resolve joint influence into its outgoing segment(s). Leaves
                # inherit their incoming segment. The root follows the spine,
                # not an average of unrelated limb branch rotations.
                ew=np.zeros((len(points),len(bones)-1))
                for ci,name in enumerate(binding['channels']):
                    if name=='fixed': continue
                    joint=names.index(name); children=np.flatnonzero(parents==joint)
                    if joint==0 and 'spine-lumbar' in names: children=np.array([names.index('spine-lumbar')])
                    edges=children-1 if len(children) else np.array([joint-1])
                    ew[:,edges]+=binding['weights'][:,ci,None]/len(edges)
                ew/=ew.sum(axis=1)[:,None]
                for match in [False,True]:
                    variant='rig-proportions' if match else 'pose-only'
                    target=canonical_joints(rest,fitted,parents,match_lengths=match)
                    corrected=deform_points(points,fitted,target,parents,ew)
                    variant_root=leaf/variant;variant_root.mkdir()
                    np.savez(variant_root/'surface.npz',positions=corrected,triangles=triangles)
                    write(variant_root/'correction.json',{'variant':variant,'targetJoints':target,'sourceFit':fit_row['fit'],
                        'segmentLengthRatios':fit['segmentLengthRatios'],'maxDisplacement':float(np.linalg.norm(corrected-points,axis=1).max()),
                        'mapping':'surface-geodesic segment partition; blended radial-preserving segment transport; NOT a full ARAP/embedded-deformation solve',
                        'unknownPelvisCarriedVertices':len(binding['unknownVertices']), 'sourceCase':case['case'],
                        'scope':'derived rest surface; pose-only preserves fitted lengths and requires its own retargeted rig for motion'})
                    if match:
                        new_control={**control,'joints':dict(zip(names,rest.tolist())),'bounds':{'min':corrected.min(axis=0).tolist(),'max':corrected.max(axis=0).tolist()}}
                        rear2=full.bind_geometry(corrected,triangles,new_control)
                        bound=full.distributed_trunk_weights(corrected,triangles,rear2['edges'],rear2['jointWeights'],bones)
                        new_arrays={'rest.bin':corrected.astype('<f4'),'triangles.bin':triangles.astype('<u4'),
                                    'automatic-weights.bin':bound['weights'].astype('<f4'),'automatic-presets.bin':corrected.astype('<f4')[None]}
                        assets={}
                        for name,array in new_arrays.items():
                            path=variant_root/name;array.tofile(path);assets[name]={'sha256':sha(path),'bytes':path.stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
                        derived={**manifest,'assets':assets,'channels':bound['channels'],
                                 'sourceCast':manifest['sourceCast']+' · derived pose + rig proportions',
                                 'provenance':{**manifest['provenance'],'normalizationFit':fit_row['fit'],'normalizationPlan':record(plan_path)},
                                 'bindingRule':{k:v for k,v in bound.items() if k not in ['weights','channels']},
                                 'scope':'derived pose AND proportion correction; same generating rig and retained clip, no source mutation or anatomical admission'}
                        write(variant_root/'manifest.json',derived)
                        report['casts'].append({'slug':slug,'case':record(variant_root/'manifest.json'),
                                                'correction':record(variant_root/'correction.json')})
        for item in records: authenticate(item)
        report.update(status='completed',phase='complete',output=str(out))
    except Exception as error:
        report.update(status='failed',error=repr(error));raise
    finally:
        if safe_report: write(report_path,report)
        else: print(json.dumps({**report,'reportWriteRefused':True}),file=sys.stderr)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ['plan','out','report']: parser.add_argument('--'+key,required=True)
    parser.add_argument('--stage',choices=['fit','correct'],required=True)
    parser.add_argument('--fit-report')
    parser.add_argument('--voxel-size',type=float,default=.08)
    run(parser.parse_args())
