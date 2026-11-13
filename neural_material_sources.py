"""Caller-owned training recipes shared by the Workbench and headless tools."""
import argparse
import fcntl
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path

def location(root, name):
    if not isinstance(name, str): raise ValueError('Training source path must be a string')
    root = Path(root).resolve()
    target = (root / name).resolve()
    if Path(name).is_absolute() or not target.is_relative_to(root) or target.suffix != '.json':
        raise ValueError('Choose a relative .json path within the training source directory')
    return target

def register(root, name, recipe):
    if not isinstance(recipe, dict) or recipe.get('sourceKind') != 'causeway' or not isinstance(recipe.get('source'), dict):
        raise ValueError('A Causeway source recipe is required')
    allowed={'width','depth','seed','relief','shoulder','dish','grain','sheetGap','layoutJitter','slant','contextRadius'}
    if any(k not in allowed or isinstance(v,bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for k,v in recipe['source'].items()):
        raise ValueError('Finite nonnegative source values required')
    source=recipe['source']
    if any(source.get(k,1)<=0 for k in ['width','depth']) or source.get('shoulder',0)>.3 or source.get('dish',0)>.5 or source.get('grain',0)>1 or any(not float(source.get(k,1)).is_integer() for k in ['seed','contextRadius']) or source.get('contextRadius',1)<1:
        raise ValueError('Invalid Causeway shape')
    if 'provenance' in recipe:
        provenance=recipe['provenance']
        if not isinstance(provenance,dict) or not isinstance(provenance.get('revision'),str): raise ValueError('Source revision required in provenance')
        if 'sourceRevision' in recipe and recipe['sourceRevision'] != provenance['revision']: raise ValueError('Conflicting source revisions')
        recipe={**recipe,'sourceRevision':provenance['revision']}
    target = location(root, name)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = json.loads(target.read_text()) if target.exists() else {}
        current.update(recipe)
        current.update(schema='kaminos.neural-material-source.v1', path=str(target))
        fd, temporary = tempfile.mkstemp(prefix=target.name+'.', dir=target.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(current, stream, indent=2, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if Path(temporary).exists(): Path(temporary).unlink()
    return current

def catalogue(root):
    root = Path(root)
    return [json.loads(p.read_text()) for p in sorted(root.rglob('*.json'))] if root.exists() else []

def handle(handler, method, repo_root):
    root = Path(os.environ.get('KAMINOS_NEURAL_MATERIAL_SOURCES_DIR', Path.home()/'.local/state/kaminos/neural-material-sources')).resolve()
    try:
        if method == 'GET':
            return handler.send_json({'root':str(root), 'sources':catalogue(root)})
        request = json.loads(handler.rfile.read(int(handler.headers.get('Content-Length', '0'))))
        if not isinstance(request,dict) or not isinstance(request.get('recipe'),dict) or not isinstance(request.get('path'),str): raise ValueError('Recipe object and relative path required')
        recipe = request['recipe']
        recipe['provenance'] = {'repoRoot':str(repo_root), 'revision':subprocess.check_output(['git','rev-parse','HEAD'], cwd=repo_root, text=True).strip(), 'dirty':bool(subprocess.check_output(['git','status','--porcelain'], cwd=repo_root, text=True))}
        recipe['sourceRevision']=recipe['provenance']['revision']
        handler.send_json(register(root, request['path'], recipe))
    except (ValueError, KeyError, TypeError) as error:
        handler.send_json({'error':str(error)}, 400)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--path')
    parser.add_argument('--input', type=Path)
    args = parser.parse_args()
    print(json.dumps(register(args.root,args.path,json.loads(args.input.read_text())) if args.input else catalogue(args.root), indent=2))
