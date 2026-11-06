"""Observe known open-channel sections for authored shape recovery."""

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import traceback


def observed_opening(lines, precision):
    import numpy as np
    edges=lines[:,1]-lines[:,0]
    levels=np.unique(lines[:,:,1])
    candidates=[]
    for y in (levels[:-1]+levels[1:])/2:
        crossing=(lines[:,0,1]>y)!=(lines[:,1,1]>y)
        t=(y-lines[crossing,0,1])/edges[crossing,1]
        hits=np.sort(lines[crossing,0,0]+t*edges[crossing,0])
        # Alternating material intervals leave the air gaps between the walls.
        if len(hits)%2:continue
        for i in range(1,len(hits)-2,2):
            width=hits[i+1]-hits[i]
            if width<=precision:continue
            x=(hits[i+1]+hits[i])/2
            crossing=(lines[:,0,0]>x)!=(lines[:,1,0]>x)
            t=(x-lines[crossing,0,0])/edges[crossing,0]
            vertical=lines[crossing,0,1]+t*edges[crossing,1]
            if np.any(vertical>y+precision):continue
            below=np.sort(vertical[vertical<y-precision])
            below=below[np.r_[True,np.diff(below)>precision]] if len(below) else below
            if len(below)<2:continue
            depth=y-below[-1]
            # This observer is for a bowl-like U carrier, not shallow surface
            # dents. A half-round opening has depth/width 1/2; require at least
            # half that observable depth before assigning the bowl identity.
            if depth<width/4:continue
            candidates.append(dict(center=[float(x),float(y)],width=float(width),
                depth=float(depth),minimumDepthWidthRatio=.25,
                walls=[float(v) for v in hits[i-1:i+3]],bottomHits=below.tolist()))
    if not candidates:raise ValueError('No observed upward opening between two channel walls')
    return max(candidates,key=lambda c:(c['width'],c['center'][1]))


def observe_section(lines, ellipse_fit, station):
    import numpy as np
    lines=np.asarray(lines,dtype=float)
    evidence=dict(segments=lines.tolist(),innerSegments=[],outerSegments=[],excluded=[])
    result=dict(observed=False,station=float(station),evidence=evidence)
    try:
        if lines.ndim!=3 or lines.shape[1:]!=(2,2) or not len(lines) or not np.isfinite(lines).all():
            raise ValueError('Finite observed section segments are required')
        points=lines.reshape(-1,2)
        precision=np.finfo(np.float32).eps*max(float(np.abs(points).max()),1.)
        opening=observed_opening(lines,precision)
        evidence['opening']=opening
        center=np.array(opening['center'])
        start=lines[:,0]-center
        edges=lines[:,1]-lines[:,0]
        cross=lambda a,b:a[...,0]*b[...,1]-a[...,1]*b[...,0]
        thickness={}
        for i,midpoint in enumerate(lines.mean(axis=1)):
            delta=midpoint-center
            distance=np.linalg.norm(delta)
            if distance<=precision or delta[1]>=-precision:
                evidence['excluded'].append(dict(segment=i,reason='Opening lip or unresolved ray'))
                continue
            direction=delta/distance
            denominator=cross(direction,edges)
            valid=np.abs(denominator)>np.finfo(float).eps
            t=np.divide(cross(start,edges),denominator,out=np.full(len(lines),np.nan),where=valid)
            u=np.divide(cross(start,direction),denominator,out=np.full(len(lines),np.nan),where=valid)
            hits=np.sort(t[valid&(t>precision)&(u>=-1e-10)&(u<=1+1e-10)])
            hits=hits[np.r_[True,np.diff(hits)>precision]] if len(hits) else hits
            hit=int(np.argmin(abs(hits-distance))) if len(hits) else -1
            if hit not in (0,1) or abs(hits[hit]-distance)>precision:
                evidence['excluded'].append(dict(segment=i,reason='Occluded or unresolved section surface'))
                continue
            role='innerSegments' if hit==0 else 'outerSegments'
            evidence[role].append(i)
            if hit==1:thickness[i]=float(hits[1]-hits[0])
        if thickness:
            q1,q3=np.quantile(list(thickness.values()),[.25,.75])
            limit=float(q3+1.5*(q3-q1)+precision)
            evidence['outerThicknessFence']=limit
            evidence['outerRadialThickness']=[dict(segment=i,thickness=v) for i,v in thickness.items()]
            kept=[]
            for i in evidence['outerSegments']:
                if thickness[i]<=limit:kept.append(i)
                else:evidence['excluded'].append(dict(segment=i,reason='Beyond observed shell-thickness population'))
            evidence['outerSegments']=kept
        for role in ('inner','outer'):
            ids=evidence[role+'Segments']
            if len(ids)<3:raise ValueError('Inner and outer section surfaces are not separately observed')
            directions=lines[ids].mean(axis=1)-center
            angles=np.arctan2(directions[:,1],directions[:,0])
            coverage=float(angles.max()-angles.min())
            evidence[role+'AngularCoverage']=coverage
            if coverage<np.pi/2:raise ValueError('Open-section arc coverage is insufficient')
            fitted=ellipse_fit(lines[ids],1.)
            result[role]=dict(center=fitted['center'],linear=np.asarray(fitted['linear']).reshape(4).tolist(),
                              ellipseAxes=fitted['ellipseAxes'],ellipseResidualRMS=fitted['ellipseResidualRMS'])
        inner,outer=result['inner'],result['outer']
        offset=np.array(inner['center'])-outer['center']
        if np.linalg.norm(np.array(outer['linear']).reshape(2,2)@offset)>=1:
            raise ValueError('Observed inner center is outside the outer section')
        result['observed']=True
    except (ValueError,TypeError,KeyError,IndexError,np.linalg.LinAlgError) as exc:
        result['error']=str(exc)
    return result


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_plan(plan):
    finite=lambda x:isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
    nominal=plan.get('nominal',{})
    center=nominal.get('center')
    inner,outer=nominal.get('innerRadius'),nominal.get('outerRadius')
    if not isinstance(center,list) or len(center)!=2 or not all(map(finite,center)) or not finite(inner) or not finite(outer) or not 0<inner<outer:
        raise ValueError('Positive ordered nominal radii and finite center are required')
    sources=plan.get('sources')
    if not isinstance(sources,list) or not sources:raise ValueError('Nonempty source plans are required')
    for source in sources:
        stations=source.get('stations')
        if not isinstance(stations,list) or not stations or not all(map(finite,stations)):
            raise ValueError('Nonempty finite section stations are required')
        if any(a>=b for a,b in zip(stations,stations[1:])):
            raise ValueError('Section stations must be strictly ordered')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    report=dict(ok=False,phase='dependencies',parts=[],plan=str(args.plan))
    args.report.parent.mkdir(parents=True,exist_ok=True)
    save=lambda:args.report.write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        import numpy as np
        report['phase']='plan'
        plan=json.loads(args.plan.read_text())
        report.update(planSha256=digest(args.plan),sourceSha256=digest(__file__),
                      python=sys.executable,numpy=np.__version__)
        report['phase']='plan-validation'
        validate_plan(plan)
        report['phase']='runtime-identity'
        runtime=plan['ellipseFitter']
        actual=digest(runtime['path'])
        report['ellipseFitter']=dict(path=runtime['path'],requestedSha256=runtime['sha256'],effectiveSha256=actual)
        if actual!=runtime['sha256']:raise ValueError('Ellipse fitter identity changed')
        spec=importlib.util.spec_from_file_location('known_section_ellipse_fitter',runtime['path'])
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for item in plan['normalizationModules']:
            if digest(item['path'])!=item['sha256']:raise ValueError('Source normalization identity changed: '+item['path'])
        report['normalizationModules']=plan['normalizationModules']
        normalizer=plan['normalizer']
        actual=digest(normalizer['path'])
        report['normalizer']=dict(path=normalizer['path'],requestedSha256=normalizer['sha256'],effectiveSha256=actual)
        if actual!=normalizer['sha256']:raise ValueError('Source normalizer identity changed')
        node=shutil.which('node')
        if not node:raise ValueError('Node is unavailable for the actual Stockroom source frame')
        report['node']=node
        for part in plan['sources']:
            report['phase']='load:'+part['name']
            save()
            import trimesh
            report['trimesh']=trimesh.__version__
            source=part['source']
            if digest(part['input'])!=source['sha256']:raise ValueError('Source mesh identity changed: '+part['input'])
            scene=trimesh.load(part['input'],force='scene',process=False)
            if len(scene.geometry)!=1:raise ValueError('Section recovery requires one identified source mesh')
            mesh=scene.to_geometry()
            payload=dict(source=source,positions=np.asarray(mesh.vertices).reshape(-1).tolist(),
                         normals=np.asarray(mesh.vertex_normals).reshape(-1).tolist())
            report['phase']='source-frame:'+part['name']
            framed=subprocess.run([node,normalizer['path']],input=json.dumps(payload),text=True,capture_output=True)
            if framed.returncode:
                report['normalizationFailure']=dict(returncode=framed.returncode,stdout=framed.stdout,stderr=framed.stderr)
                raise ValueError('Source normalization failed')
            geometry=json.loads(framed.stdout)
            if geometry['sourceSha256']!=source['sha256']:raise ValueError('Source frame returned another source identity')
            normalized=trimesh.Trimesh(vertices=np.array(geometry['positions']).reshape(-1,3),faces=mesh.faces,process=False)
            row=dict(name=part['name'],input=part['input'],source=source,profile=geometry['profile'],sections=[])
            report['parts'].append(row)
            report['phase']='observe:'+part['name']
            for station in part['stations']:
                segments=trimesh.intersections.mesh_plane(normalized,[0,0,1],[0,0,station])[:,:,:2]
                row['sections'].append(observe_section(segments,module.fit_bore_ellipse,station))
            observed=[s for s in row['sections'] if s['observed']]
            row['supportedStations']=[s['station'] for s in observed]
            if observed:
                row['recovery']=dict(schema='kaminos.stock-section.v1',nominal=plan['nominal'],
                    observations=[dict(station=s['station'],inner=s['inner'],outer=s['outer']) for s in observed])
                report['phase']='consumer-validation:'+part['name']
                checked=subprocess.run([node,normalizer['path']],input=json.dumps(dict(operation='validate-section',recovery=row['recovery'])),text=True,capture_output=True)
                row['consumerValidation']=dict(returncode=checked.returncode,stdout=checked.stdout,stderr=checked.stderr)
                if checked.returncode or json.loads(checked.stdout).get('valid') is not True:
                    raise ValueError('Runtime rejected the produced section descriptor')
            save()
        report['phase']='source-postflight'
        for item in [runtime,normalizer,*plan['normalizationModules']]:
            if digest(item['path'])!=item['sha256']:raise ValueError('Consumed source changed during observation: '+item['path'])
        for part in plan['sources']:
            if digest(part['input'])!=part['source']['sha256']:raise ValueError('Source mesh changed during observation')
        report['ok']=bool(report['parts']) and all('recovery' in p for p in report['parts'])
        report['phase']='complete' if report['ok'] else 'unresolved-sections'
        if not report['ok']:sys.exit(1)
    except BaseException as exc:
        report.update(error=str(exc),traceback=traceback.format_exc())
        raise
    finally:
        save()
        print(json.dumps(dict(ok=report['ok'],phase=report['phase'],parts=[dict(name=p['name'],
            supportedStations=p.get('supportedStations',[])) for p in report['parts']],error=report.get('error')),indent=2),flush=True)


if __name__=='__main__':
    main()
