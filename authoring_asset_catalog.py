"""Authoring projection over existing asset and generator output records."""
import json,re
from pathlib import Path
from urllib.parse import urlencode

COLLECTIONS = {'generated-meshes','image-inbox','greenroom','trellis2mlx','pixal3d'}
IMAGE_SUFFIXES = {'.png','.jpg','.jpeg','.webp'}

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

def read_catalog(collection, *, roots, image_entries, origins, output_resolver, label):
    if collection not in COLLECTIONS:raise ValueError('Unknown authoring asset collection')
    root=roots.get(collection)
    if root is None or not Path(root).is_dir():raise FileNotFoundError('Asset collection is not mounted')
    root=Path(root).resolve();entries=[];warnings=[];unavailable=0
    def warn(identity,error):warnings.append({'source':str(identity),'reason':str(error)})
    def append(path,source,*,name=None,title=None,job=None,generation=None):
        kind=asset_kind(path)
        if not kind:return
        stat=path.stat()
        entries.append({'id':source,'kind':kind,'root':collection,'path':path.relative_to(root).as_posix() if path.is_relative_to(root) else path.name,
            'name':name or path.name,'label':title or label(name or path.name), 'source':source,'size':stat.st_size,'mtime':stat.st_mtime,
            **({'jobId':job['job_id'],'producer':job.get('job_type'),'route':job.get('requested_route'),'assetOrigin':{'source':source,'jobId':job['job_id'],'producer':job.get('job_type'),'route':job.get('requested_route')}} if job else {}),
            **({'generation':generation} if generation else {})})
    if collection=='image-inbox':
        for entry in image_entries():
            if entry['root_id']!='image-inbox':continue
            entries.append({**entry,'root':collection,'label':entry['name'],'id':entry['source']})
    elif collection=='greenroom':
        done=root/'done'
        for directory in sorted(done.iterdir()) if done.is_dir() else []:
            receipt_path=directory/'receipt.json'
            if not directory.is_dir() or not receipt_path.is_file():continue
            try:
                receipt=json.loads(receipt_path.read_text())
                if receipt.get('status')!='done' or receipt.get('exit_code')!=0 or not generator_receipt(receipt):continue
                if receipt.get('job_id')!=directory.name:raise ValueError('Receipt identity differs from its job directory')
                if not receipt.get('output_dir') or not Path(receipt['output_dir']).is_dir():unavailable+=1;continue
                output=output_resolver(receipt.get('output_dir'))
                if output is None:raise ValueError('Recorded outputs are outside serving roots')
                metadata_path=output/'metadata.json';metadata=json.loads(metadata_path.read_text()) if metadata_path.is_file() else {}
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
                    name=label(title) if title else f'{family} {asset_kind(filename)}'
                    append(path,source,title=f'{name} · {label(filename)}' if title and Path(filename).stem not in ('output','asset') else name,job=receipt)
            except (OSError,ValueError,TypeError,KeyError) as error:warn(directory.name,error)
    else:
        for path in sorted(root.rglob('*')):
            if not path.is_file() or not asset_kind(path) or any(p.startswith('.') for p in path.relative_to(root).parts):continue
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
