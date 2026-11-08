"""Durable TRELLIS voxel histories. A run owns one manifest and immutable frames."""
import base64,fcntl,hashlib,json,math,os,struct,tempfile
from pathlib import Path

SCHEMA='trellis2.voxel-history.v1'
FRAME='trellis2.voxel-frame.v1'
def identity(value):
    if not isinstance(value,str) or not value.strip():raise ValueError('History identity required')
    return hashlib.sha256(value.encode()).hexdigest()
def run_directory(root,run_id):
    root=Path(root).resolve();target=root/identity(run_id)
    if target.is_symlink():raise ValueError('History directory may not be a symlink')
    return target
def atomic_json(path,value):
    with tempfile.NamedTemporaryFile('w',dir=path.parent,prefix='.history-',delete=False) as handle:
        temporary=Path(handle.name);json.dump(value,handle,allow_nan=False)
    try:os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)
def atomic_bytes(path,data):
    with tempfile.NamedTemporaryFile('wb',dir=path.parent,prefix='.frame-',delete=False) as handle:
        temporary=Path(handle.name);handle.write(data)
    try:os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)
def read_history(root,run_id):
    path=run_directory(root,run_id)/'history.json'
    value=json.loads(path.read_text())
    if value.get('schema')!=SCHEMA or value.get('runId')!=run_id or not isinstance(value.get('frames'),list):raise ValueError('History run identity is corrupt')
    return value
def read_frame(root,run_id,frame_id):
    value=read_history(root,run_id);frame=next((f for f in value['frames'] if f['id']==frame_id),None)
    if frame is None:raise FileNotFoundError('History frame does not exist')
    path=run_directory(root,run_id)/(identity(frame_id)+'.i32')
    if path.is_symlink():raise ValueError('History frame may not be a symlink')
    data=path.read_bytes()
    if len(data)!=frame['coordinates']['byteLength'] or hashlib.sha256(data).hexdigest()!=frame['coordinates']['sha256']:raise ValueError('Retained history frame is partial or changed')
    return data
def validate_frame(frame,data,run_id):
    if not isinstance(frame,dict) or frame.get('schema')!=FRAME or frame.get('representation')!='occupied-cells' or frame.get('runId')!=run_id:raise ValueError('Matching occupied-cell frame required')
    for key in ('id','stage','routeId'):identity(frame.get(key))
    for key in ('grid','layout','spatial'):
        if not isinstance(frame.get(key),dict):raise ValueError('Voxel '+key+' object required')
    dims=frame['grid'].get('dimensions');n=frame.get('count');layout=frame['layout'];spatial=frame['spatial']
    integer=lambda x:isinstance(x,int) and not isinstance(x,bool)
    if not isinstance(dims,list) or len(dims)!=3 or not all(integer(d) and d>0 for d in dims) or not integer(n) or n<0 or n>math.prod(dims):raise ValueError('Complete voxel dimensions/count required')
    if len(data)!=n*12 or layout.get('dtype')!='int32' or layout.get('shape')!=[n,3] or layout.get('rowOrder')!='z-y-x-lexicographic':raise ValueError('Complete packed Int32 coordinates required')
    if not integer(frame.get('step')) or frame['step']<0 or not integer(frame.get('steps')) or frame['steps']<frame['step'] or not isinstance(frame.get('atSeconds'),(int,float)) or not math.isfinite(frame['atSeconds']) or frame['atSeconds']<0:raise ValueError('Sampling clock required')
    def vector(x,size):return isinstance(x,list) and len(x)==size and all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in x)
    transform=spatial.get('gridToSource',{})
    if not isinstance(transform,dict):raise ValueError('Voxel gridToSource object required')
    if spatial.get('frame')!='trellis-source' or not vector(transform.get('scale'),3) or min(transform['scale'])<=0 or not vector(transform.get('offset'),3) or not vector(spatial.get('cellCenterOffset'),3) or not vector(spatial.get('sourceToGltf'),16):raise ValueError('Explicit voxel spatial frame required')
    previous=-1
    for z,y,x in struct.iter_unpack('<iii',data):
        key=(z*dims[1]+y)*dims[2]+x
        if min(z,y,x)<0 or z>=dims[0] or y>=dims[1] or x>=dims[2] or key<=previous:raise ValueError('Voxel rows must be in-grid, source-ordered and unique')
        previous=key
def save_history(root,payload):
    if not isinstance(payload,dict) or payload.get('schema')!=SCHEMA:raise ValueError('TRELLIS history body required')
    run_id=payload.get('runId');directory=run_directory(root,run_id)
    label=payload.get('label');source=payload.get('source')
    if not isinstance(label,str) or not label.strip() or not isinstance(source,dict) or source.get('kind') not in ('live-generation','retained-reference-replay'):raise ValueError('History label and actual source kind required')
    frame=payload.get('frame');data=None
    if frame is not None:
        try:data=base64.b64decode(payload.get('coordinatesBase64',''),validate=True)
        except (ValueError,TypeError) as error:raise ValueError('Complete base64 coordinate bytes required') from error
        validate_frame(frame,data,run_id)
        frame={**frame,'coordinates':{'sha256':hashlib.sha256(data).hexdigest(),'byteLength':len(data)}}
    elif payload.get('status') not in ('completed','failed','stopped','incomplete'):raise ValueError('Frame or terminal history status required')
    if 'status' in payload and payload['status'] not in ('completed','failed','stopped','incomplete'):raise ValueError('Invalid history status')
    gaps=payload.get('gaps',[])
    if not isinstance(gaps,list) or any(not isinstance(g,dict) or not all(isinstance(g.get(k),str) and g[k] for k in ('id','stage','reason')) for g in gaps):raise ValueError('Explicit history gaps required')
    directory.mkdir(parents=True,exist_ok=True)
    with (directory/'.lock').open('a+b') as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
        try:value=read_history(root,run_id)
        except FileNotFoundError:value={'schema':SCHEMA,'runId':run_id,'label':label,'source':source,'status':'capturing','frames':[]}
        if value['source']!=source or value['label']!=label:raise ValueError('History source identity is immutable')
        if frame is not None:
            previous=next((f for f in value['frames'] if f['id']==frame['id']),None)
            if previous is not None and previous!=frame:raise ValueError('Retained history frame is immutable')
            if previous is None:
                path=directory/(identity(frame['id'])+'.i32')
                if path.is_symlink():raise ValueError('History frame may not be a symlink')
                if path.exists() and path.read_bytes()!=data:raise ValueError('Retained history bytes differ')
                atomic_bytes(path,data);value['frames'].append(frame);value['frames'].sort(key=lambda f:(f['atSeconds'],f['step'],f['id']))
        if 'status' in payload:value['status']=payload['status']
        if gaps:
            existing={g['id']:g for g in value.get('gaps',[])}
            for gap in gaps:
                if gap['id'] in existing and existing[gap['id']]!=gap:raise ValueError('History gap identity differs')
                existing[gap['id']]=gap
            value['gaps']=list(existing.values())
        if value.get('status')=='completed' and (not value['frames'] or value.get('gaps')):
            value['status']='incomplete';value['error']='No complete snapshot was retained' if not value['frames'] else 'Some emitted snapshots were not captured'
        if payload.get('error'):value['error']=str(payload['error'])
        elif 'error' in payload and value['status']=='completed':value.pop('error',None)
        atomic_json(directory/'history.json',value)
    return {'schema':SCHEMA,'runId':run_id,'frameId':frame['id'] if frame else None,'frames':len(value['frames']),'status':value['status']}
