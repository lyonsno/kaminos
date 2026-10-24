"""Authoring projection over existing asset and generator output records."""
import hashlib,json,re
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode,urlsplit,parse_qsl

COLLECTIONS = {'generated-meshes','image-inbox','greenroom','trellis2mlx','pixal3d'}
IMAGE_SUFFIXES = {'.png','.jpg','.jpeg','.webp'}
HOLDS_PATH = Path(__file__).with_name('asset-visibility-holds.json')

def source_key(source):
    url=urlsplit(source)
    return url.path,tuple(sorted(parse_qsl(url.query)))

@lru_cache(maxsize=None)
def content_digest(path,size,mtime_ns,ctime_ns):
    digest=hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b''):digest.update(chunk)
    after=path.stat()
    if (after.st_size,after.st_mtime_ns,after.st_ctime_ns)!=(size,mtime_ns,ctime_ns):
        raise OSError('Asset changed while checking its visibility hold')
    return digest.hexdigest()

def visibility_holds():
    # A missing/broken hold list fails the catalog request, never silently exposes it.
    manifest=json.loads(HOLDS_PATH.read_text())
    if not isinstance(manifest,dict) or manifest.get('schema')!='kaminos.asset-visibility-holds.v1' or not isinstance(manifest.get('holds'),list):
        raise ValueError('Invalid asset visibility hold list')
    sources={};digests={};sizes=set()
    for hold in manifest['holds']:
        if (not isinstance(hold,dict) or hold.get('kind') not in ('image','mesh')
            or not all(isinstance(hold.get(key),str) and hold[key] for key in ('id','label','basis'))
            or not re.fullmatch(r'[a-f0-9]{64}',str(hold.get('sha256','')))
            or not isinstance(hold.get('size'),int) or hold['size']<0
            or not isinstance(hold.get('sources'),list) or not hold['sources']
            or not all(isinstance(source,str) and source.startswith('/api/') for source in hold['sources'])):
            raise ValueError('Invalid asset visibility hold record')
        digests[hold['sha256']]=hold;sizes.add(hold['size'])
        for source in hold['sources']:sources[source_key(source)]=hold
    def apply(entry,path):
        hold=sources.get(source_key(entry['source']))
        if not hold:
            # Only candidate byte lengths need hashing. Cache by file identity so browsing
            # other collections finds renamed/copied aliases without rereading unchanged bytes.
            try:
                path=path.resolve();stat=path.stat()
                if stat.st_size in sizes:hold=digests.get(content_digest(path,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns))
            except OSError:
                entry['visibility']={'status':'withheld','reason':'Asset could not be checked. Awaiting further review.'}
                return entry
        if hold:
            entry['label']=hold['label']
            entry['visibility']={'status':'withheld','reason':'Hostile to eyesight. Awaiting further review.','holdId':hold['id'],'basis':hold['basis']}
        return entry
    return apply

def asset_kind(path):
    suffix=Path(path).suffix.lower()
    return 'mesh' if suffix=='.glb' else 'image' if suffix in IMAGE_SUFFIXES else None

def generator_receipt(receipt):
    # Registry jobs name their producer; structured commands record a model route.
    # A generic command's screenshots are not generation assets.
    kind=str(receipt.get('job_type') or '')
    route=str(receipt.get('requested_route') or '')
    return bool(re.match(r'^(mflux|flux|ideogram|trellis|pixal|sf3d)(?:[\d_.-]|$)',kind,re.I)
                or re.match(r'^(trellis|pixal|sf3d|flux|ideogram)(?:[\d_.-]|$)',route,re.I))

def read_catalog(collection, *, roots, image_entries, origins, output_resolver, label, levels=dict):
    if collection not in COLLECTIONS:raise ValueError('Unknown authoring asset collection')
    root=roots.get(collection)
    if root is None or not Path(root).is_dir():raise FileNotFoundError('Asset collection is not mounted')
    root=Path(root).resolve();entries=[];warnings=[];unavailable=0;apply_hold=visibility_holds()
    def warn(identity,error):warnings.append({'source':str(identity),'reason':str(error)})
    def append(path,source,*,name=None,title=None,job=None,generation=None):
        kind=asset_kind(path)
        if not kind:return
        stat=path.stat()
        entries.append(apply_hold({'id':source,'kind':kind,'root':collection,'path':path.relative_to(root).as_posix() if path.is_relative_to(root) else path.name,
            'name':name or path.name,'label':title or label(name or path.name), 'source':source,'size':stat.st_size,'mtime':stat.st_mtime,
            **({'jobId':job['job_id'],'producer':job.get('job_type'),'route':job.get('requested_route'),'assetOrigin':{'source':source,'jobId':job['job_id'],'producer':job.get('job_type'),'route':job.get('requested_route')}} if job else {}),
            **({'generation':generation} if generation else {})},path))
    if collection=='image-inbox':
        for entry in image_entries():
            if entry['root_id']!='image-inbox':continue
            path=root/dict(parse_qsl(urlsplit(entry['source']).query))['path']
            entries.append(apply_hold({**entry,'root':collection,'label':entry['name'],'id':entry['source']},path))
    elif collection=='greenroom':
        done=root/'done'
        for directory in sorted(done.iterdir()) if done.is_dir() else []:
            receipt_path=directory/'receipt.json'
            if not directory.is_dir() or not receipt_path.is_file():continue
            try:
                receipt=json.loads(receipt_path.read_text())
                if not isinstance(receipt,dict):raise ValueError('Generator receipt must be a JSON object')
                if receipt.get('status')!='done' or receipt.get('exit_code')!=0 or not generator_receipt(receipt):continue
                if receipt.get('job_id')!=directory.name:raise ValueError('Receipt identity differs from its job directory')
                if not receipt.get('output_dir') or not Path(receipt['output_dir']).is_dir():unavailable+=1;continue
                output=output_resolver(receipt.get('output_dir'))
                if output is None:raise ValueError('Recorded outputs are outside serving roots')
                metadata_path=output/'metadata.json';metadata=json.loads(metadata_path.read_text()) if metadata_path.is_file() else {}
                if not isinstance(metadata,dict):raise ValueError('Generator output metadata must be a JSON object')
                if metadata.get('job_id') not in (None,directory.name):
                    # A later run owns these same paths; do not misattribute its bytes.
                    continue
                files=metadata.get('output_files')
                if files is None:files=[path.name for path in output.iterdir() if path.is_file()]
                if not isinstance(files,list):raise ValueError('Generator output record must be a file list')
                title=metadata.get('name') or metadata.get('input_name') or receipt.get('input_name') or receipt.get('input_path')
                for filename in files:
                    if not isinstance(filename,str):raise ValueError('Output record contains a non-path entry')
                    if not asset_kind(filename):continue
                    path=(output/filename).resolve()
                    if not path.is_relative_to(output) or any(p.startswith('.') for p in Path(filename).parts):
                        warn(directory.name,'Output path escapes its artifact directory');continue
                    if not path.is_file():warn(directory.name,f'Recorded asset is missing: {filename}');continue
                    source='/api/job-output?'+urlencode({'job_id':directory.name,'file':filename})
                    producer=str(receipt.get('job_type') or '') if receipt.get('job_type')!='command' else str(receipt.get('requested_route') or '')
                    family=next((value for prefix,value in [('trellis','Trellis'),('pixal','Pixal'),('sf3d','SF3D'),('mflux','Flux'),('flux','Flux'),('ideogram','Ideogram')] if producer.lower().startswith(prefix)), 'Generated')
                    name=label(title) if title else (label(filename) if Path(filename).stem.lower() not in ('asset','output','mesh') else f'{family} · {label(output.name)}')
                    append(path,source,title=f'{name} · {label(filename)}' if title and Path(filename).stem not in ('output','asset') else name,job=receipt)
            except (OSError,ValueError,TypeError,KeyError) as error:warn(directory.name,error)
    else:
        # Registered LOD levels are coarse stand-ins of another stored mesh, not assets of their own.
        level_shas=set(levels()) if collection=='generated-meshes' else set()
        for path in sorted(root.rglob('*')):
            if not path.is_file() or not asset_kind(path) or any(p.startswith('.') for p in path.relative_to(root).parts):continue
            if path.stem in level_shas:continue
            resolved=path.resolve()
            if not resolved.is_relative_to(root):warn(path,'Asset symlink leaves its mounted collection');continue
            rel=path.relative_to(root).as_posix();source='/api/read?'+urlencode({'root':collection,'path':rel})
            generation=None;title=None
            if collection=='generated-meshes' and re.fullmatch(r'[a-f0-9]{64}\.glb',path.name):
                try:
                    record=origins(path.stem)
                    if record:
                        current=record['origins'][record['latestRunId']];generation=current['generation'];title=current['name']
                except (ValueError,OSError,KeyError) as error:warn(path,error)
                if not title:title=f'Saved mesh · {path.stem[:8]}'
            append(path,source,title=title,generation=generation)
    # Stable newest-first view; all records flow through, with no hidden result cap.
    entries.sort(key=lambda entry:(-entry['mtime'],entry['id']))
    return {'schema':'kaminos.authoring-assets.v1','collection':collection,'entries':entries,'warnings':warnings,'unavailableCount':unavailable}
