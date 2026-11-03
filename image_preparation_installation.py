"""Resolve the installed image-preparation runtime for every Kaminos checkout.

Registration shares models.json with weight packages; no dependency installation
or inference runs here. Keep a venv executable's spelling: resolving its symlink
would silently select the base interpreter instead of that environment.
"""
import argparse
import fcntl
import importlib.util
from functools import cached_property
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
_spec = importlib.util.spec_from_file_location('preparation_model_installations', Path(__file__).with_name('model_installations.py'))
_catalog = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_catalog)
installation_path, read_installations = _catalog.installation_path, _catalog.read_installations

PROBE = '''import importlib.util,json,sys
from importlib import metadata
packages={}
for module,distribution in [('PIL','pillow'),('rembg','rembg'),('onnxruntime','onnxruntime')]:
 try: packages[distribution]=metadata.version(distribution) if importlib.util.find_spec(module) else None
 except metadata.PackageNotFoundError: packages[distribution]=None
print(json.dumps({'python':sys.executable,'packages':packages}))
'''

class ImagePreparationInstallation:
    def __init__(self, environ=None, config_path=None, default_python=None):
        self.environ = dict(os.environ if environ is None else environ)
        self.path = Path(config_path) if config_path is not None else _catalog._installation_location(self.environ)
        self.error = None
        try:
            self.path = self.path.expanduser().resolve()
            entry = read_installations(self.path).get('imagePreparation', {})
            if not isinstance(entry, dict):
                raise ValueError('imagePreparation must contain python and model paths')
        except (OSError,ValueError,UnicodeError,RuntimeError) as error:
            entry = {}; self.error = str(error)
        self.choices = {}
        defaults = {'python': default_python or sys.executable,
                    'model': str(Path(self.environ.get('HOME') or Path.home()) / '.u2net/u2net.onnx')}
        for field, variable in [('python','KAMINOS_IMAGE_PREPARATION_PYTHON'),('model','KAMINOS_BACKGROUND_MODEL_PATH')]:
            source = 'environment' if variable in self.environ else 'installation' if field in entry else 'default'
            value = self.environ[variable] if variable in self.environ else entry.get(field, defaults[field])
            error = self.error if self.error and source != 'environment' else None
            path = None
            try:
                if not isinstance(value,str) or not value.strip():
                    raise ValueError(f'{variable} / imagePreparation.{field} requires a nonempty path')
                path = Path(value).expanduser()
                if not path.is_absolute():
                    path = (self.path.parent if source == 'installation' else Path.cwd()) / path
                path = Path(os.path.abspath(path))
            except (OSError,ValueError,RuntimeError) as invalid:
                error = str(invalid)
            self.choices[field] = {'path':str(path) if path else None,'source':source,'error':error}

    def command(self):
        errors = [c['error'] for c in self.choices.values() if c['error']]
        if errors:
            raise ValueError('Image preparation configuration: ' + '; '.join(errors))
        return self.choices['python']['path'], self.choices['model']['path']

    @cached_property
    def dependencies(self):
        # Metadata-only subprocess: do not import ONNX/rembg or load weights in
        # the serving interpreter. Report the distinction from actual execution.
        packages = {}; runtime = None; problem = None
        try:
            executable, model = self.command()
            completed = subprocess.run([executable,'-c',PROBE],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            if completed.returncode:
                raise ValueError(completed.stderr.decode(errors='replace') or 'Python dependency probe failed')
            value = json.loads(completed.stdout)
            runtime, packages = value['python'], value['packages']
            if not isinstance(runtime,str) or not isinstance(packages,dict):
                raise ValueError('Python dependency probe returned invalid metadata')
        except (OSError,ValueError,TypeError,KeyError) as error:
            problem = str(error)
        return {'packages':packages,'runtime':runtime,'problem':problem}

    def availability(self):
        packages, runtime, problem = (self.dependencies[key] for key in ('packages','runtime','problem'))
        alpha_problem = problem or (None if packages.get('pillow') else 'Pillow is not installed in the selected preparation Python')
        background_problem = alpha_problem
        if not background_problem:
            missing = [name for name in ('rembg','onnxruntime') if not packages.get(name)]
            if missing:
                background_problem = 'Missing preparation dependencies: ' + ', '.join(missing)
            else:
                try:
                    weights = Path(self.choices['model']['path'])
                    if weights.name != 'u2net.onnx' or not weights.is_file() or weights.stat().st_size == 0:
                        background_problem = 'Existing nonempty u2net.onnx weights are required'
                except OSError as error:
                    background_problem = str(error)
        return {'status':'unavailable' if alpha_problem else 'partial' if background_problem else 'available',
                'installationFile':str(self.path),'python':self.choices['python'],'model':self.choices['model'],
                'effectivePython':runtime,'packages':packages,'validation':'dependency-metadata-and-weight-presence',
                'routes':{'input-alpha':{'available':not bool(alpha_problem),'reason':alpha_problem},
                          'rembg-u2net-cpu':{'available':not bool(background_problem),'reason':background_problem}}}


def register(executable, model, config_path=None):
    path = Path(config_path).expanduser().resolve() if config_path is not None else installation_path()
    entry = {'python':os.path.abspath(os.path.expanduser(str(executable))),
             'model':str(Path(model).expanduser().resolve())}
    selection = ImagePreparationInstallation(environ={'KAMINOS_IMAGE_PREPARATION_PYTHON':entry['python'],
        'KAMINOS_BACKGROUND_MODEL_PATH':entry['model']},config_path=path)
    report = selection.availability()
    if report['status'] != 'available':
        raise ValueError(report['routes']['rembg-u2net-cpu']['reason'])
    path.parent.mkdir(parents=True,exist_ok=True)
    with Path(str(path)+'.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        value = read_installations(path)
        value['imagePreparation'] = {**value.get('imagePreparation',{}),**entry}
        with tempfile.NamedTemporaryFile('w',dir=path.parent,prefix=path.name+'.',delete=False) as pending:
            json.dump(value,pending,indent=2);pending.write('\n');pending.flush();os.fsync(pending.fileno());temporary=Path(pending.name)
        try: os.replace(temporary,path)
        finally: temporary.unlink(missing_ok=True)
    return {'installationFile':str(path),**entry}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    status=sub.add_parser('status');status.add_argument('--config',type=Path)
    add=sub.add_parser('register');add.add_argument('--python',required=True);add.add_argument('--model',required=True);add.add_argument('--config',type=Path)
    args=parser.parse_args()
    try:
        result=ImagePreparationInstallation(config_path=args.config).availability() if args.command=='status' else register(args.python,args.model,args.config)
    except (OSError,ValueError,TypeError) as error: parser.exit(1,json.dumps({'ok':False,'error':str(error)})+'\n')
    print(json.dumps(result,indent=2))
