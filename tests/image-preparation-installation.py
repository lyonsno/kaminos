# kaminos-test: python
"""Ordinary serving consumes the shared preparation installation."""
import hashlib,json,os,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory).resolve(); config=root/'models.json'; executable=root/'prep-python'; model=root/'u2net.onnx'
    executable.write_text('fixture'); model.write_bytes(b'fixture weights')
    config.write_text(json.dumps({'schema':'kaminos.model-installations.v1','models':{},'imagePreparation':{'python':str(executable),'model':str(model)}}))
    env={'KAMINOS_MODEL_INSTALLATIONS':str(config)}
    with patch.dict(os.environ,env):
        import serve
        raw=b'retained input';digest=hashlib.sha256(raw).hexdigest();(root/'cutout.png').write_bytes(raw)
        calls=[]
        def execute(command,**kwargs):
            calls.append(command)
            if '-c' in command:
                value={'python':str(executable),'packages':{'pillow':'1','rembg':'2','onnxruntime':'3'}}
            else:
                value={'status':'complete','original':{'sha256':digest},'prepared':{'path':'cutout.png','sha256':digest}}
            return SimpleNamespace(returncode=0,stdout=json.dumps(value).encode(),stderr=b'')
        with patch.object(serve.subprocess,'run',side_effect=execute),patch.object(serve,'KAMINOS_IMAGE_PREPARATION_DIR',root),patch.object(serve,'ingest_image_asset',return_value={'source':'original'}):
            serve.prepare_authoring_image(raw,source='/api/read?root=image-inbox&path=input.png',name='input.png',expected_sha256=digest)
        preparation=[row for row in calls if any('authoring_image_preparation.py' in str(arg) for arg in row)][0]
        assert preparation[0]==str(executable),f'normal startup ignored registered interpreter: {preparation[0]}'
        assert preparation[-1]==str(model),'normal startup ignored registered weights'
print('Shared preparation installation is consumed by ordinary serving')

from image_preparation_installation import ImagePreparationInstallation,register
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory).resolve();config=root/'models.json';weights=root/'u2net.onnx';weights.write_bytes(b'fixture')
    catalog={'schema':'kaminos.model-installations.v1','models':{'unrelated':{'root':'retained'}},'extra':{'retained':True},'imagePreparation':{'python':'venv/bin/python3','model':'u2net.onnx'}}
    config.write_text(json.dumps(catalog))
    metadata={'python':str(root/'venv/bin/python3'),'packages':{'pillow':'1','rembg':'2','onnxruntime':'3'}}
    calls=[]
    def probe(command,**kwargs):
        calls.append(command);return SimpleNamespace(returncode=0,stdout=json.dumps(metadata).encode(),stderr=b'')
    with patch('image_preparation_installation.subprocess.run',side_effect=probe):
        installed=ImagePreparationInstallation(environ={},config_path=config)
        assert installed.command()==(str(root/'venv/bin/python3'),str(weights))
        assert installed.availability()['status']=='available'
        assert installed.availability()['effectivePython']==metadata['python']
        assert len(calls)==1,'availability requests must not repeatedly launch dependency probes'
        # Model absence does not remove alpha-preserving preparation.
        weights.unlink();partial=installed.availability()
        assert partial['status']=='partial' and partial['routes']['input-alpha']['available']
        weights.write_bytes(b'fixture')
        overridden=ImagePreparationInstallation(environ={'KAMINOS_IMAGE_PREPARATION_PYTHON':str(root/'other-python')},config_path=config)
        assert overridden.command()==(str(root/'other-python'),str(weights))
        assert overridden.choices['python']['source']=='environment'
        missing=ImagePreparationInstallation(environ={'KAMINOS_IMAGE_PREPARATION_PYTHON':''},config_path=config)
        assert missing.availability()['status']=='unavailable'
        assert len(calls)==1,'invalid explicit override cannot silently fall back or execute'
        # Keep executable symlinks, which identify the virtual environment.
        target=root/'base-python';target.write_text('fixture');link=root/'venv-python';link.symlink_to(target)
        register(link,weights,config)
        stored=json.loads(config.read_text())
        assert stored['imagePreparation']['python']==str(link)
        assert stored['models']==catalog['models'] and stored['extra']==catalog['extra']
    metadata['packages']['rembg']=None
    with patch('image_preparation_installation.subprocess.run',side_effect=probe):
        partial=ImagePreparationInstallation(environ={},config_path=config).availability()
        assert partial['status']=='partial' and 'rembg' in partial['routes']['rembg-u2net-cpu']['reason']
    config.write_text('{broken')
    assert ImagePreparationInstallation(environ={},config_path=config).availability()['status']=='unavailable'
print('Resolution, explicit override, capability degradation, caching and registration preservation passed')

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory).resolve();config=root/'models.json';config.symlink_to(config.name)
    for env,path in [({'KAMINOS_MODEL_INSTALLATIONS':str(config)},None),({},config)]:
        selected=ImagePreparationInstallation(environ=env,config_path=path)
        report=selected.availability()
        assert report['status']=='unavailable' and str(config) in report['installationFile']
        assert report['python']['error'],'unresolvable catalog must be diagnosed, not treated as absent'
        explicit={**env,'KAMINOS_IMAGE_PREPARATION_PYTHON':sys.executable,'KAMINOS_BACKGROUND_MODEL_PATH':str(root/'u2net.onnx')}
        selected=ImagePreparationInstallation(environ=explicit,config_path=path)
        assert selected.command()==(sys.executable,str(root/'u2net.onnx')),'explicit choices remain independent of registry failure'
print('Unresolvable preparation registry is isolated from server startup and explicit choices')
