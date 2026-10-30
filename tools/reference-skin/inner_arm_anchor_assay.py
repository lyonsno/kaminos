"""Provisional same-cast assay: add a midline-facing surface seed to arm controls.

The pinned original trunk ray routine supplies intersections. This experiment
adds four seeds at most; it does not modify the product's binder or defaults.
"""
import argparse, importlib.util, json, sys, traceback
from pathlib import Path
import numpy as np

def inner_anchors(points, triangles, bones, trunk, derive):
    heads={b['name']:np.asarray(b['restMatrix'],dtype=float)[:3,3] for b in bones}
    seeds={};receipt=[];old_axis=trunk.AXIAL
    for side,other in [('left','right'),('right','left')]:
        for role,child in [('shoulder','elbow'),('elbow','wrist')]:
            name=f'forelimb-{side}-{role}';next_name=f'forelimb-{side}-{child}'
            head=heads[name];end=heads[next_name];origin=head+.55*(end-head)
            opposite=heads[f'forelimb-{other}-{role}']+.55*(heads[f'forelimb-{other}-{child}']-heads[f'forelimb-{other}-{role}'])
            tangent=end-head;tangent/=np.linalg.norm(tangent)
            toward=opposite-origin;normal=toward/np.linalg.norm(toward)
            direction=toward-tangent*np.dot(toward,tangent);direction/=np.linalg.norm(direction)
            if not np.isfinite(direction).all():raise ValueError('Degenerate transverse arm frame')
            midplane_distance=.5*np.linalg.norm(toward)/np.dot(direction,normal)
            matrix=np.eye(4);matrix[:3,0]=direction;matrix[:3,1]=tangent;matrix[:3,2]=np.cross(direction,tangent);matrix[:3,3]=origin
            endpoint=matrix.copy();endpoint[:3,3]=end
            try:
                trunk.AXIAL=('probe','endpoint')
                _,rays=derive(points,triangles,[{'name':'probe','restMatrix':matrix.tolist()},{'name':'endpoint','restMatrix':endpoint.tolist()}])
            finally:trunk.AXIAL=old_axis
            ray=next(r for r in rays['rays'] if r['bone']=='probe' and r['angularSample']==0)
            row={**ray,'bone':name,'midplaneDistance':float(midplane_distance)}
            if row['status']=='hit':
                if row['distance']>=midplane_distance:row['status']='rejected-cross-midplane'
                else:seeds[name]=[row['vertex']]
            receipt.append(row)
    return seeds,receipt

def main():
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--out',required=True);args=p.parse_args()
    root=Path(args.inputs).resolve();out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
    prep_path=Path(__file__).with_name('prepare.py');spec=importlib.util.spec_from_file_location('reference_prepare',prep_path);prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
    report={'status':'failed','phase':'inputs','scriptSha256':prep.sha(__file__),'preparationSha256':prep.sha(prep_path),'intervention':'Retain all existing seeds; add a midline-facing first-hit seed at .55 along upperarm/forearm on each side, refusing hits across the paired-segment midplane. Provisional diagnostic, no anatomical or repair adoption.','cases':[]}
    def write():prep.write(out/'report.json',report)
    write()
    try:
        for tag,original in [('cat','cat'),('dog','dog-r2')]:
            config=prep.read(root/(tag+'-inputs.json'));base=root/original/'package';baseline=root/'operator-dog-sheet-1029/ablation'/(tag+'-baseline')
            # Reuse the already reconstructed exact baseline; do not run it again.
            previous=prep.read(root/'operator-dog-sheet-1029/ablation/report.json');prior=next(c for c in previous['cases'] if c['id']==tag)
            if previous['status']!='completed' or not prior['baselineExact']:raise ValueError('Unproved baseline reconstruction')
            for n in ['rest.bin','triangles.bin','automatic-weights.bin']:
                if prep.sha(base/n)!=prep.sha(baseline/'package'/n):raise ValueError('Baseline differs: '+tag+' '+n)
            for source,expected in config['expected_sources'].items():
                if prep.sha(source)!=expected:raise ValueError('Pinned source differs: '+source)
            sys.path.insert(0,config['trunk']);import trunk_anchors
            original_derive=trunk_anchors.derive_trunk_anchors
            def added(points,triangles,bones):
                seeds,receipt=original_derive(points,triangles,bones)
                extra,rays=inner_anchors(points,triangles,bones,trunk_anchors,original_derive)
                for name,indices in extra.items():seeds[name]=sorted(set(seeds.get(name,[])+indices))
                receipt['seeds']=seeds;receipt['innerArmAssay']={'rays':rays,'seeds':extra,'authority':'Provisional directional surface support; not authored tissue labels','originalSeedsRetained':True}
                return seeds,receipt
            candidate=out/(tag+'-candidate');candidate.mkdir(exist_ok=True);data={'status':'failed','phase':'start'}
            report['phase']=tag+'-candidate';write();trunk_anchors.derive_trunk_anchors=added
            try:prep.prepare(config,candidate,data)
            finally:trunk_anchors.derive_trunk_anchors=original_derive;prep.write(candidate/'report.json',data)
            for n in ['rest.bin','triangles.bin']:
                if prep.sha(base/n)!=prep.sha(candidate/'package'/n):raise ValueError('Geometry changed: '+tag+' '+n)
            before=prep.read(base/'manifest.json');after=prep.read(candidate/'package/manifest.json')
            if before['bones']!=after['bones']:raise ValueError('Skeleton changed')
            report['cases'].append({'id':tag,'baselineManifestSha256':prep.sha(base/'manifest.json'),'candidateManifestSha256':prep.sha(candidate/'package/manifest.json'),'baselineReusedExact':True,'geometryAndSkeletonUnchanged':True,'anchors':after['bindingRule']['trunkAnchors']['innerArmAssay']});write()
        report.update(status='completed',phase='complete')
    except Exception:report['error']=traceback.format_exc();raise
    finally:write()
if __name__=='__main__':main()
