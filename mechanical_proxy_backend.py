"""File-in/file-out mesher. --run supervises the exact owned meshing child."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time
from mechanical_proxy import ROUTE, validate_input, write_json


def mesh(directory):
    import numpy as np
    import wildmeshing as wm
    if importlib.metadata.version('wildmeshing') != '0.4.1':
        raise ValueError('wildmeshing 0.4.1 required')
    request = validate_input(json.loads((directory/'input.json').read_text()))
    vertices = np.array(request['positions'], dtype=np.float64)
    faces = np.array(request['triangles'], dtype=np.int32)
    settings = request['settings']; start = time.monotonic()
    mesher = wm.Tetrahedralizer(epsilon=settings['envelope'], edge_length_r=settings['spacing'])
    mesher.set_mesh(vertices, faces); mesher.tetrahedralize()
    positions, tetrahedra, flags = mesher.get_tet_mesh(use_input_for_wn=True)
    positions = np.asarray(positions); tetrahedra = np.asarray(tetrahedra)
    if positions.ndim != 2 or positions.shape[1] != 3 or not np.isfinite(positions).all() or tetrahedra.ndim != 2 or tetrahedra.shape[1] != 4 or not len(tetrahedra) or tetrahedra.min() < 0 or tetrahedra.max() >= len(positions):
        raise ValueError('Mesher returned an incomplete or nonfinite interior')
    corners = positions[tetrahedra]
    volumes = np.abs(np.linalg.det(np.stack([corners[:,i]-corners[:,0] for i in (1,2,3)],axis=2)))/6
    if not np.isfinite(volumes).all() or (volumes<=0).any():
        raise ValueError('Mesher returned degenerate elements')
    result = {'status':'passed','route':ROUTE,'sourceDigest':request['sourceDigest'],'settings':settings,'positions':positions.tolist(),'tetrahedra':tetrahedra.tolist(),'volume':float(volumes.sum()),'diagonal':request['diagonal'],'effective':{'backend':'CPU','wildmeshing':'0.4.1','epsilonRelative':settings['envelope'],'epsilonAbsolute':settings['envelope']*request['diagonal'],'edgeLengthRelative':settings['spacing'],'edgeLengthAbsolute':settings['spacing']*request['diagonal']},'meshingSeconds':time.monotonic()-start,'claim':'Generated tetrahedral proxy for inspection; not calibrated material or source topology equivalence'}
    write_json(directory/'mesh.json',result)


def run(directory):
    data = json.loads((directory/'input.json').read_text())
    report = {'status':'running','phase':'meshing','route':ROUTE,'requested':data['settings'],'sourceDigest':data['sourceDigest'],'startedAt':time.time()}
    write_json(directory/'report.json',report)
    start = time.monotonic(); process = None
    try:
        if (directory/'cancel').exists():
            report.update(status='cancelled',phase='before-meshing'); return
        with (directory/'mesher.log').open('wb') as log:
            process = subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--mesh',str(directory)],cwd=directory,stdout=log,stderr=subprocess.STDOUT)
            while process.poll() is None:
                cancelled = (directory/'cancel').exists()
                if cancelled or time.monotonic()-start >= data['settings']['budgetSeconds']:
                    process.terminate()
                    try: process.wait(timeout=2)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
                    report.update(status='cancelled' if cancelled else 'over-budget',phase='meshing'); return
                time.sleep(.05)
        if process.returncode:
            raise RuntimeError(f'Mesher exited {process.returncode}; full log retained at mesher.log')
        output = json.loads((directory/'mesh.json').read_text())
        if output.get('status')!='passed' or output.get('route')!=ROUTE or output.get('sourceDigest')!=data['sourceDigest'] or output.get('settings')!=data['settings']:
            raise ValueError('Complete matching mesher result required')
        report.update(status='passed',phase='complete',resultSha256=hashlib.sha256((directory/'mesh.json').read_bytes()).hexdigest(),points=len(output['positions']),tetrahedra=len(output['tetrahedra']),volume=output['volume'],effective=output['effective'],meshingSeconds=output['meshingSeconds'])
    except Exception as error:
        report.update(status='failed',error=str(error))
    finally:
        report['elapsedSeconds']=time.monotonic()-start
        write_json(directory/'report.json',report)
    if report['status']=='failed':
        raise SystemExit(1)


if __name__=='__main__':
    mode,path=sys.argv[1:]; directory=Path(path).resolve()
    if mode=='--mesh': mesh(directory)
    elif mode=='--run': run(directory)
    else: raise ValueError('Expected --run or --mesh')
