"""Fit a displacement field from explicit generated/authored section features."""

def fit_profile_field(points,targets):
    import numpy as np
    points,targets=np.asarray(points,dtype=float),np.asarray(targets,dtype=float)
    if points.ndim!=2 or points.shape[1]!=2 or len(points)<3 or points.shape!=targets.shape or not np.isfinite(points).all() or not np.isfinite(targets).all():
        raise ValueError('Finite matching source and target profile features are required')
    if len(np.unique(points,axis=0))!=len(points):raise ValueError('Profile correspondences must have distinct source points; conflicting features refuse')
    origin=(points.min(0)+points.max(0))/2
    scale=float(np.ptp(points,axis=0).max())
    if not scale>0:raise ValueError('Profile feature rank is unresolved')
    centers=(points-origin)/scale
    polynomial=np.column_stack([np.ones(len(points)),centers])
    if np.linalg.matrix_rank(polynomial)!=3:raise ValueError('Profile features are collinear or rank deficient')
    r2=((centers[:,None,:]-centers[None,:,:])**2).sum(2)
    kernel=np.zeros_like(r2)
    positive=r2>0
    kernel[positive]=.5*r2[positive]*np.log(r2[positive])
    # Standard thin-plate interpolation with a degree-one polynomial tail.
    system=np.block([[kernel,polynomial],[polynomial.T,np.zeros((3,3))]])
    coefficients=np.linalg.solve(system,np.vstack([targets-points,np.zeros((3,2))]))
    if not np.isfinite(coefficients).all():raise ValueError('Nonfinite profile solve')
    return dict(origin=origin.tolist(),scale=scale,centers=centers.tolist(),weights=coefficients[:-3].tolist(),affine=coefficients[-3:].tolist())


def evaluate_field(field,points):
    import numpy as np
    points=np.asarray(points,dtype=float)
    normalized=(points-field['origin'])/field['scale']
    r2=((normalized[:,None,:]-np.array(field['centers'])[None,:,:])**2).sum(2)
    kernel=np.zeros_like(r2)
    positive=r2>0
    kernel[positive]=.5*r2[positive]*np.log(r2[positive])
    return points+kernel@field['weights']+np.column_stack([np.ones(len(points)),normalized])@field['affine']


def section_features(section,nominal,parameters,rim_inset=0,minimum_separation=0):
    import numpy as np
    origin=np.array(section['evidence']['opening']['center'],dtype=float)
    if not np.isfinite(rim_inset) or rim_inset<0:raise ValueError('Finite nonnegative rim inset required')
    if not np.isfinite(minimum_separation) or minimum_separation<0:raise ValueError('Finite nonnegative feature separation required')
    origin[1]-=rim_inset
    lines=np.array(section['evidence']['segments'])
    edges=lines[:,1]-lines[:,0];start=lines[:,0]-origin
    precision=np.finfo(np.float32).eps*max(float(abs(lines).max()),1.)
    cross=lambda a,b:a[...,0]*b[...,1]-a[...,1]*b[...,0]
    controls={'inner':[],'outer':[]};hits_record=[]
    for u in parameters:
        angle=-np.pi+np.pi*u
        direction=np.array([np.cos(angle),np.sin(angle)])
        den=cross(direction,edges)
        valid=np.abs(den)>np.finfo(float).eps
        t=np.divide(cross(start,edges),den,out=np.full(len(lines),np.nan),where=valid)
        v=np.divide(cross(start,direction),den,out=np.full(len(lines),np.nan),where=valid)
        hits=np.sort(t[valid&(t>precision)&(v>=-1e-10)&(v<=1+1e-10)])
        hits=hits[np.r_[True,np.diff(hits)>precision]] if len(hits) else hits
        if len(hits)<2:raise ValueError('Inner and outer wall are unresolved at profile ray '+str(u))
        controls['inner'].append((origin+direction*hits[0]).tolist())
        resolved=hits[1]-hits[0]>=minimum_separation
        controls['outer'].append((origin+direction*hits[1]).tolist() if resolved else None)
        hits_record.append(dict(parameter=float(u),distances=hits.tolist(),outerResolved=bool(resolved)))
    points,targets,raw,roles=[],[],[],[]
    angles=-np.pi+np.pi*np.array(parameters)
    for role in ['inner','outer']:
        authored=np.array(nominal['center'])+nominal[role+'Radius']*np.column_stack([np.cos(angles),np.sin(angles)])
        for observed,target in zip(controls[role],authored):
            if observed is not None:points.append(observed);targets.append(target.tolist())
        samples=np.unique(lines[section['evidence'][role+'Segments']].reshape(-1,2),axis=0)
        raw.extend(samples.tolist());roles.extend([role]*len(samples))
    return dict(points=points,targets=targets,raw=raw,roles=roles,rayOrigin=origin.tolist(),rimInset=rim_inset,minimumFeatureSeparation=minimum_separation,rays=hits_record)


def main():
    import argparse
    import hashlib
    import json
    from pathlib import Path
    import subprocess
    import sys
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    args.report.parent.mkdir(parents=True,exist_ok=True)
    report=dict(ok=False,phase='load',parts=[])
    save=lambda:args.report.write_text(json.dumps(report,indent=2)+'\n')
    digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
    save()
    try:
        import numpy as np
        plan=json.loads(args.plan.read_text())
        report.update(planSha256=digest(args.plan),producerSha256=digest(__file__),input=plan['observations'],inputSha256=digest(plan['observations']))
        original=json.loads(Path(plan['observations']).read_text())
        if original.get('ok') is not True or original.get('phase')!='complete' or not original.get('parts'):raise ValueError('Complete observed source sections are required')
        parameters=np.array(plan['parameters'],dtype=float)
        if parameters.ndim!=1 or len(parameters)<3 or not np.isfinite(parameters).all() or parameters[0]!=0 or parameters[-1]!=1 or np.any(np.diff(parameters)<=0):raise ValueError('Ordered authored profile parameters from zero to one required')
        nominal=plan['nominal']
        if not np.isfinite([*nominal['center'],nominal['innerRadius'],nominal['outerRadius']]).all() or not 0<nominal['innerRadius']<nominal['outerRadius']:raise ValueError('Invalid nominal profile')
        runtime=plan['runtimeValidator']
        for item in [runtime,*runtime['modules']]:
            if digest(item['path'])!=item['sha256']:raise ValueError('Runtime validator identity mismatch')
        report.update(runtimeValidator=runtime,normalizer=original['normalizer'],ellipseFitter=original['ellipseFitter'],parameters=parameters.tolist())
        for part in original['parts']:
            selected=[next(s for s in part['sections'] if s['station']==station) for station in plan['stations']]
            if not selected or any(not s['observed'] for s in selected):raise ValueError('Requested profile section is unobserved')
            row=dict(name=part['name'],source=part['source'],profile=part['profile'],sections=selected)
            report['parts'].append(row)
            observations=[]
            for section in selected:
                report['phase']='fit:'+part['name']+':'+str(section['station'])
                save()
                features=section_features(section,nominal,parameters,plan.get('rimInset',0),plan.get('minimumFeatureSeparation',0))
                field=fit_profile_field(features['points'],features['targets'])
                corrected=evaluate_field(field,np.array(features['raw']))
                error=np.array([abs(np.linalg.norm(p-nominal['center'])-nominal[role+'Radius']) for p,role in zip(corrected,features['roles'])])
                section['profileFit']=dict(features=features,maxRadiusError=float(error.max()),radiusErrorRMS=float(np.sqrt(np.mean(error**2))))
                observations.append(dict(station=section['station'],field=field))
            row['recovery']=dict(schema='kaminos.stock-profile.v1',nominal=nominal,observations=observations)
            if 'outside' in plan:row['recovery']['outside']=plan['outside']
            report['phase']='consumer-validation:'+part['name']
            checked=subprocess.run(['node',runtime['path']],input=json.dumps(dict(operation='validate-section',recovery=row['recovery'])),capture_output=True,text=True)
            row['consumerValidation']=dict(returncode=checked.returncode,stdout=checked.stdout,stderr=checked.stderr)
            if checked.returncode or json.loads(checked.stdout).get('valid') is not True:raise ValueError('Runtime rejected profile descriptor')
            save()
        report['phase']='postflight'
        if digest(plan['observations'])!=report['inputSha256']:raise ValueError('Input observation changed')
        for item in [runtime,*runtime['modules']]:
            if digest(item['path'])!=item['sha256']:raise ValueError('Consumed runtime changed')
        report.update(ok=True,phase='complete')
    except BaseException as error:
        report['error']=str(error)
        raise
    finally:
        save()
        print(json.dumps(dict(ok=report['ok'],phase=report['phase'],error=report.get('error')),indent=2))


if __name__=='__main__':main()
