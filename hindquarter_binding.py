"""Geometry-only binding against a provisional rig-relative support carrier."""
import argparse
import hashlib
import json
import time
from pathlib import Path
import numpy as np

def unit(vector):
    return vector / max(np.linalg.norm(vector), 1e-12)

def transform(points, matrix):
    return points @ matrix[:3,:3].T + matrix[:3,3]

def support_specs(control):
    j={name:np.asarray(point,dtype=float) for name,point in control['joints'].items()}
    hip,knee,hock=(j['hindlimb-left-'+name] for name in ['hip','stifle','hock'])
    pelvis=j['pelvis']; thigh=knee-hip
    # These are explicit assay constructions, not anatomical muscle identities.
    muscles=[{'name':'proximal-pelvis-thigh-bridge','origin':hip+[-.08,.20,.12],
              'insertion':hip+.38*thigh+[-.08,0,.07],'radius':.20},
             {'name':'anterior-thigh-support','origin':hip+[0,.08,-.16],
              'insertion':hip+.85*thigh+[0,0,-.08],'radius':.17},
             {'name':'posterior-thigh-support','origin':hip+[0,.12,.15],
              'insertion':hip+.72*thigh+[0,0,.12],'radius':.18}]
    static=[{'kind':'ellipsoid','name':'fixed-torso-support','center':pelvis+[0,.08,-.65],'axes':[.40,.46,.95]},
            {'kind':'ellipsoid','name':'fixed-pelvic-support','center':pelvis+[0,-.06,.08],'axes':[.30,.32,.36]}]
    bones=[]
    for side,mobile in [('left',1),('right',0)]:
        a,b,c=(j['hindlimb-'+side+'-'+name] for name in ['hip','stifle','hock'])
        bones += [{'kind':'capsule','name':side+'-hip-stifle-chord','a':a,'b':b,'radius':.075,'mobile':mobile},
                  {'kind':'capsule','name':side+'-stifle-hock-chord','a':b,'b':c,'radius':.065,'mobile':mobile},
                  {'kind':'capsule','name':side+'-distal-chord','a':c,'b':c+[0,-.4,.10],'radius':.075,'mobile':mobile}]
    return {'muscles':muscles,'static':static,'bones':bones,'blend':.06,
            'authority':'provisional rig-relative three-support arrangement; no anatomical adoption'}

def ellipsoid(points,center,axes,basis):
    local=(points-center)@basis
    a=np.asarray(axes);k0=np.linalg.norm(local/a,axis=1);k1=np.linalg.norm(local/(a*a),axis=1)
    d=np.where(k1>1e-12,k0*(k0-1)/np.maximum(k1,1e-12),-np.min(a))
    dk0=local/(a*a)/np.maximum(k0[:,None],1e-12)
    dk1=local/(a**4)/np.maximum(k1[:,None],1e-12)
    grad=((2*k0-1)[:,None]*dk0*k1[:,None]-(k0*(k0-1))[:,None]*dk1)/np.maximum(k1[:,None]**2,1e-12)
    return d,grad@basis.T

def capsule(points,a,b,radius):
    delta=b-a;t=np.clip((points-a)@delta/max(delta@delta,1e-12),0,1)
    offset=points-(a+t[:,None]*delta);length=np.linalg.norm(offset,axis=1)
    return length-radius,offset/np.maximum(length[:,None],1e-12)

def primitives(specs,matrix):
    result=[]
    for s in specs['static']:
        result.append({**s,'center':np.asarray(s['center']),'basis':np.eye(3),'mobile':0})
    for s in specs['bones']:
        a,b=s['a'],s['b']
        if s['mobile']:a,b=transform(np.array([a,b]),matrix)
        result.append({**s,'a':a,'b':b})
    for s in specs['muscles']:
        origin=s['origin'];insertion=transform(s['insertion'][None,:],matrix)[0]
        delta=insertion-origin;length=np.linalg.norm(delta);axis=unit(delta)
        side=unit(np.cross(axis,[1,0,0]));normal=unit(np.cross(axis,side))
        radius=s['radius']*np.sqrt(np.linalg.norm(s['insertion']-origin)/max(length,1e-12))
        result.append({'kind':'ellipsoid','name':s['name'],'center':(origin+insertion)/2,
            'axes':[length*.58,radius,radius*.85],'basis':np.column_stack([axis,side,normal]),
            'origin':origin,'insertion':insertion,'mobile':'longitudinal'})
    return result

def field(points,specs,matrix,partition=False):
    values=[];gradients=[];mobilities=[]
    for p in primitives(specs,matrix):
        if p['kind']=='capsule':d,g=capsule(points,p['a'],p['b'],p['radius'])
        else:d,g=ellipsoid(points,p['center'],p['axes'],p['basis'])
        values.append(d);gradients.append(g)
        if partition:
            if p['mobile']=='longitudinal':
                axis=p['insertion']-p['origin'];t=np.clip((points-p['origin'])@axis/(axis@axis),0,1)
                mobilities.append(t*t*(3-2*t))
            else:mobilities.append(np.full(len(points),p['mobile']))
    values=np.asarray(values);minimum=values.min(axis=0);blend=specs['blend']
    weights=np.exp(-(values-minimum)/blend);weights/=weights.sum(axis=0)
    d=minimum-blend*np.log(np.exp(-(values-minimum)/blend).sum(axis=0))
    g=np.sum(weights[:,:,None]*np.asarray(gradients),axis=0)
    return (d,g,np.sum(weights*np.asarray(mobilities),axis=0)) if partition else (d,g)

def bind_geometry(positions,triangles,control):
    positions=np.asarray(positions,dtype=np.float64);triangles=np.asarray(triangles)
    if control.get('paintedWeightsIncluded') is not False:raise ValueError('painted weights must be excluded')
    if positions.ndim!=2 or positions.shape[1]!=3 or not np.isfinite(positions).all():raise ValueError('invalid geometry')
    if triangles.ndim!=2 or triangles.shape[1]!=3 or triangles.min()<0 or triangles.max()>=len(positions):raise ValueError('invalid topology')
    specs=support_specs(control);rest_values,_,weights=field(positions,specs,np.eye(4),partition=True)
    edges=np.unique(np.sort(np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]]),axis=1),axis=0)
    rest_edges=positions[edges[:,1]]-positions[edges[:,0]]
    degree=np.bincount(edges.ravel(),minlength=len(positions))
    return {'positions':positions.copy(),'triangles':triangles.copy(),'specs':specs,'weights':weights,
            'restValues':rest_values,'edges':edges,'restEdges':rest_edges,'degree':degree}

def partial_rotation(points,matrix,weights):
    # One active joint at the normalized origin. Normalized quaternion blending
    # supplies a coarse rigid transport; no painted fields enter this operation.
    r=matrix[:3,:3];u,_,vt=np.linalg.svd(r);r=u@vt
    angle=np.arccos(np.clip((np.trace(r)-1)/2,-1,1))
    if angle<1e-10:return points.copy()+weights[:,None]*matrix[:3,3]
    axis=unit(np.array([r[2,1]-r[1,2],r[0,2]-r[2,0],r[1,0]-r[0,1]]))
    qw=1-weights+weights*np.cos(angle/2);qv=weights[:,None]*axis*np.sin(angle/2)
    length=np.sqrt(qw*qw+np.sum(qv*qv,axis=1));qw/=length;qv/=length[:,None]
    t=2*np.cross(qv,points)
    return points+qw[:,None]*t+np.cross(qv,t)+weights[:,None]*matrix[:3,3]

def project(points,binding,matrix,iterations=8):
    points=points.copy()
    for _ in range(iterations):
        value,gradient=field(points,binding['specs'],matrix)
        error=value-binding['restValues']
        if np.max(np.abs(error))<1e-6:break
        displacement=gradient*(error/np.maximum(np.sum(gradient*gradient,axis=1),1e-10))[:,None]
        lengths=np.linalg.norm(displacement,axis=1)
        displacement*=np.minimum(1,.05/np.maximum(lengths,1e-12))[:,None]
        points-=displacement
    return points

def solve_pose(binding,frame):
    matrix=np.asarray(frame['movingMatrix'],dtype=float)
    if matrix.shape!=(4,4) or not np.isfinite(matrix).all() or not np.allclose(matrix[3],[0,0,0,1]):raise ValueError('invalid pose matrix')
    auto=partial_rotation(binding['positions'],matrix,binding['weights'])
    candidate=project(auto,binding,matrix)
    # Tangential rest-length relaxation preserves topology and uses no manual
    # vertex constraints. This is intentionally a small geometric solver.
    edges=binding['edges'];a,b=edges.T;rest_lengths=np.linalg.norm(binding['restEdges'],axis=1)
    for _ in range(4):
        delta=candidate[b]-candidate[a];lengths=np.linalg.norm(delta,axis=1)
        edge_force=delta*(.35*(lengths-rest_lengths)/np.maximum(lengths,1e-12))[:,None]
        forces=np.zeros_like(candidate);np.add.at(forces,a,edge_force);np.add.at(forces,b,-edge_force)
        forces/=np.maximum(binding['degree'],1)[:,None]
        _,gradient=field(candidate,binding['specs'],matrix)
        tangent=forces-gradient*(np.sum(forces*gradient,axis=1)/np.maximum(np.sum(gradient*gradient,axis=1),1e-10))[:,None]
        candidate=project(candidate+tangent,binding,matrix,iterations=3)
    values,_=field(candidate,binding['specs'],matrix)
    ratios=np.linalg.norm(candidate[b]-candidate[a],axis=1)/np.maximum(rest_lengths,1e-12)
    return {'candidate':candidate,'automatic':auto,'metrics':{'fieldErrorMax':float(np.max(np.abs(values-binding['restValues']))),
            'fieldErrorMean':float(np.mean(np.abs(values-binding['restValues']))),
            'edgeRatioMin':float(ratios.min()),'edgeRatioMax':float(ratios.max()),
            'fieldErrorQ95':float(np.quantile(np.abs(values-binding['restValues']),.95))}}

def json_value(value):
    if isinstance(value,np.ndarray):return value.tolist()
    if isinstance(value,dict):return {key:json_value(item) for key,item in value.items()}
    if isinstance(value,list):return [json_value(item) for item in value]
    return value

def build(args):
    out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
    report={'schema':'kaminos.hindquarter-binding-build.v1','status':'running','phase':'input-authentication',
            'input':str(Path(args.input).resolve()),'output':str(out),'effectiveSolver':'numpy-cpu-rest-referenced-field-v1'}
    digest=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
    try:
        control=json.loads(Path(args.input).read_text())
        for key in ['geometry','reference']:
            if digest(control[key]['path'])!=control[key]['sha256']:raise ValueError(key+' digest mismatch')
        geom=np.load(control['geometry']['path'])
        if set(geom.files)!={'positions','triangles'}:raise ValueError('candidate geometry includes forbidden fields')
        rest,triangles=geom['positions'],geom['triangles']
        report['phase']='geometry-only-binding';start=time.monotonic();binding=bind_geometry(rest,triangles,control)
        report['bindingSeconds']=time.monotonic()-start
        # Reference is read only after candidate binding is fixed.
        reference=np.load(control['reference']['path'])
        if reference.shape!=(len(control['frames']),len(rest),3):raise ValueError('reference shape mismatch')
        neutral_error=float(np.max(np.abs(reference[0]-rest)))
        if neutral_error>2e-5:raise ValueError('reference neutral geometry mismatch: '+str(neutral_error))
        report.update(referenceNeutralMaxError=neutral_error,phase='pose-solve',metrics=[])
        candidate=[];automatic=[]
        for index,frame in enumerate(control['frames']):
            start=time.monotonic();result=solve_pose(binding,frame)
            if not np.isfinite(result['candidate']).all():raise ValueError('non-finite candidate')
            candidate.append(result['candidate'].astype('<f4'));automatic.append(result['automatic'].astype('<f4'))
            report['metrics'].append({'frame':index,**frame,'solveSeconds':time.monotonic()-start,**result['metrics']})
            (out/'build-report.json').write_text(json.dumps(report,indent=2))
            print(json.dumps({'frame':index,'frames':len(control['frames']),'seconds':report['metrics'][-1]['solveSeconds'],'fieldQ95':result['metrics']['fieldErrorQ95']}),flush=True)
        arrays={'rest.bin':rest.astype('<f4'),'triangles.bin':triangles.astype('<u4'),
                'candidate.bin':np.asarray(candidate,dtype='<f4'),'automatic.bin':np.asarray(automatic,dtype='<f4'),
                'reference.bin':reference.astype('<f4'),'binding.bin':binding['weights'].astype('<f4')}
        assets={}
        for name,array in arrays.items():
            path=out/name;array.tofile(path);assets[name]={'sha256':digest(path),'bytes':path.stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
        manifest={'schema':'kaminos.hindquarter-binding-assay.v1','status':'completed','sourceSha256':control['sourceSha256'],
            'sourceCast':control['cast'],'sourceArmature':control['armature'],'vertices':len(rest),'triangles':len(triangles),
            'frames':control['frames'],'joints':control['joints'],'assets':assets,'supports':json_value(binding['specs']),
            'candidatePaintedWeights':False,'referenceRoute':control['referenceRoute'],
            'candidateRoute':'automatic support-partition rotation + iso-value projection + tangential edge relaxation',
            'stateRule':'each pose solved from independently generated cast rest state; no temporal sliding memory',
            'bounds':control['bounds'],'metrics':report['metrics'],'sourceGeometrySha256':control['geometry']['sha256'],
            'claim':'provisional three-support hip experiment; no anatomical, packing, production or binding-quality admission'}
        (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
        report.update(status='completed',phase='completed',manifestSha256=digest(out/'manifest.json'),assets=assets)
    except Exception as error:
        report.update(status='failed',error=str(error));(out/'build-report.json').write_text(json.dumps(report,indent=2));raise
    (out/'build-report.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--out',required=True)
    build(parser.parse_args())
