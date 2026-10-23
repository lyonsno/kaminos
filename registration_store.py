"""Explicit named registration versions alongside an asset; original bytes stay untouched."""
import hashlib
import json
import math
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs

SCHEMA = 'kaminos.asset-registration.v1'

def resolve(roots, url):
    parsed=urlparse(url)
    if parsed.scheme or parsed.netloc or parsed.path!='/api/read':
        raise ValueError('Registration requires mounted /api/read asset URLs')
    query=parse_qs(parsed.query)
    if len(query.get('root',[]))!=1 or len(query.get('path',[]))!=1:
        raise ValueError('Asset URL needs one root and path')
    root=next((r for r in roots if r['id']==query['root'][0]),None)
    if root is None:raise ValueError('Asset root is not mounted')
    base=Path(root['path']).expanduser().resolve();relative=Path(query['path'][0])
    if relative.is_absolute() or '..' in relative.parts:raise PermissionError('Path traversal')
    path=(base/relative).resolve()
    if not path.is_relative_to(base):raise PermissionError('Asset escaped its mounted root')
    if not path.is_file():raise FileNotFoundError('Registration asset is missing: '+url)
    return path

def fingerprint(path):
    digest=hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda:handle.read(1024*1024),b''):digest.update(block)
    return {'sha256':digest.hexdigest(),'bytes':path.stat().st_size}

def identify(roots,source,target):
    return {'source':fingerprint(resolve(roots,source)),'target':fingerprint(resolve(roots,target))}

def directory(path):
    return path.with_name(path.name+'.kaminos-registrations')

def checked_pose(value):
    if not isinstance(value,dict):raise ValueError('Missing registration pose')
    for key in ('position','rotation','scale'):
        v=value.get(key)
        if not isinstance(v,list) or len(v)!=3 or any(type(n) not in (int,float) or not math.isfinite(n) for n in v):raise ValueError('Invalid registration '+key)
        if key=='scale' and 0 in v:raise ValueError('Degenerate registration scale')

def checked_recipe(recipe):
    if not isinstance(recipe,dict):raise ValueError('Missing registration recipe')
    for key in ('sourceUrl','targetUrl'):
        if not isinstance(recipe.get(key),str):raise ValueError('Missing '+key)
    checked_pose(recipe.get('targetTransform'))
    settings=recipe.get('settings')
    if not isinstance(settings,dict):raise ValueError('Missing registration settings')
    checked_pose(settings.get('alignment'))
    guesses=recipe.get('jointGuesses')
    if not isinstance(guesses,dict):raise ValueError('Missing joint guesses')
    for guess in guesses.values():
        if guess is not None:checked_pose(guess)
    json.dumps(recipe,allow_nan=False)
    return recipe

def save(roots,request):
    recipe=checked_recipe(request.get('recipe'));name=request.get('name')
    if not isinstance(name,str) or not name.strip():raise ValueError('Name this registration')
    identity=identify(roots,recipe['sourceUrl'],recipe['targetUrl'])
    if request.get('identity')!=identity:raise ValueError('Source or target changed since loading; reopen before saving')
    folder=directory(resolve(roots,recipe['targetUrl']));folder.mkdir(parents=True,exist_ok=True)
    record={'schema':SCHEMA,'id':uuid.uuid4().hex,'name':name.strip(),'createdAt':datetime.now(timezone.utc).isoformat(),'identity':identity,'recipe':recipe}
    data=json.dumps(record,allow_nan=False,ensure_ascii=False,indent=2)+'\n'
    fd,temp=tempfile.mkstemp(prefix='.writing-',dir=folder)
    try:
        with os.fdopen(fd,'w') as handle:handle.write(data);handle.flush();os.fsync(handle.fileno())
        os.replace(temp,folder/(record['id']+'.json'))
    finally:
        if os.path.exists(temp):os.unlink(temp)
    return record

def catalog(roots,source,target,record_id=None):
    identity=identify(roots,source,target);folder=directory(resolve(roots,target))
    if record_id and not re.fullmatch('[0-9a-f]{32}',record_id):raise ValueError('Invalid registration id')
    records=[]
    paths=[folder/(record_id+'.json')] if record_id else sorted(folder.glob('*.json'))
    for path in paths:
        record=json.loads(path.read_text())
        if record.get('schema')!=SCHEMA or path.stem!=record.get('id'):raise ValueError('Invalid stored registration: '+path.name)
        checked_recipe(record.get('recipe'))
        matches=record['identity']==identity
        if record_id:
            if not matches:raise ValueError('Source or target changed; stored registration cannot be applied')
            # Mount locators may differ but the exact input bytes must match.
            record['recipe']['sourceUrl']=source;record['recipe']['targetUrl']=target
            return {'identity':identity,'registration':record}
        records.append({k:record[k] for k in ('id','name','createdAt')}|{'compatible':matches})
    return {'identity':identity,'registrations':records}
