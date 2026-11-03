"""Named stock recipes over content-addressed meshes already retained by Kaminos."""
import fcntl, hashlib, json, re, uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

class StockConflict(ValueError):
    pass

def save_family(root, payload, write_json):
    root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True)
    if not isinstance(payload,dict):raise ValueError('Stock family object required')
    name=payload.get('name');recipe=payload.get('recipe')
    if not isinstance(name,str) or not name.strip():raise ValueError('Family name required')
    if not isinstance(recipe,dict) or recipe.get('schema')!='kaminos.stock-family.v1' or not isinstance(recipe.get('variants'),list) or not recipe['variants']:
        raise ValueError('Stock family recipe required')
    # The domain loader validates the deformation contract. The store validates
    # its envelope and every retained dependency, not semantic passage geometry.
    json.dumps(recipe,allow_nan=False)
    sources=recipe.get('sources',[])
    if not isinstance(sources,list):raise ValueError('Source library must be a list')
    for source in [recipe.get('source'),*sources]:
        if not isinstance(source,dict) or not re.fullmatch(r'[a-f0-9]{64}',str(source.get('sha256',''))):raise ValueError('Source digest required')
        if not isinstance(source.get('url'),str):raise ValueError('Source URL required')
        sha=source['sha256'];url=urlsplit(source['url']);query=parse_qs(url.query)
        if url.scheme or url.netloc or url.path!='/api/read' or query!={'root':['generated-meshes'],'path':[sha+'.glb']}:
            raise ValueError('Retain every source in Kaminos before saving the family')
        path=root/(sha+'.glb')
        if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
            raise ValueError('Stored source missing or content identity changed: '+sha)
    identity=payload.get('id') if payload.get('id') is not None else str(uuid.uuid4())
    if not isinstance(identity,str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',identity):raise ValueError('Invalid family identity')
    target=root/(identity+'.stock-family.json')
    with (root/'.stock-family.lock').open('a+') as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
        if target.is_symlink():raise ValueError('Invalid family storage target')
        prior=None
        if target.exists():
            try:
                prior=json.loads(target.read_text())
                if not isinstance(prior,dict) or prior.get('schema')!='kaminos.stock-family-asset.v1' or prior.get('id')!=identity or not re.fullmatch(r'[a-f0-9]{64}',str(prior.get('revision',''))):
                    raise ValueError('Invalid stored family envelope')
                expected=hashlib.sha256(json.dumps({k:v for k,v in prior.items() if k!='revision'},sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
                if prior['revision']!=expected:raise ValueError('Stored family content changed')
            except (ValueError,TypeError) as error:
                raise OSError('Stored family is corrupt; refusing to overwrite it') from error
        if prior and payload.get('revision')!=prior.get('revision'):raise StockConflict('Family changed in another tab; reopen it before saving')
        if not prior and payload.get('revision') is not None:raise StockConflict('Saved family is missing; save a new family')
        result={'schema':'kaminos.stock-family-asset.v1','id':identity,'name':name.strip(),'recipe':recipe}
        result['revision']=hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
        write_json(target,result)
    return result
