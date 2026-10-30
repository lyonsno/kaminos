# kaminos-test: python
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scene_catalogue import SceneCatalogue

with TemporaryDirectory() as directory:
    root=Path(directory).resolve(); scenes=root/'scenes'; scenes.mkdir()
    path=scenes/'one.kaminos.json'; path.write_text(json.dumps({'label':'One','timestamp':'today','objects':['large']}))
    catalogue=SceneCatalogue(root/'cache')
    original=Path.read_text; reads=[]
    def read(self,*args,**kwargs):
        if self.suffixes[-2:]==['.kaminos','.json']: reads.append(self)
        return original(self,*args,**kwargs)
    with patch.object(Path,'read_text',read):
        assert catalogue.list(scenes)[0]['metadata']=='pending'
        assert reads==[], 'cold listing must not read payloads'
        assert catalogue.list(scenes,hydrate=True)[0]['label']=='One'
        assert reads==[path]
        assert SceneCatalogue(root/'cache').list(scenes,hydrate=True)[0]['label']=='One'
        assert reads==[path], 'warm summaries survive server restart without payload reads'
        path.write_text('{"label":"Two"}')
        assert catalogue.list(scenes)[0]['label']=='', 'external edits invalidate old metadata immediately'
        assert catalogue.list(scenes,hydrate=True)[0]['label']=='Two'
        path.write_text('broken')
        assert catalogue.list(scenes,hydrate=True)[0]['metadata']=='error'
        assert 'error' in catalogue.list(scenes)[0]
        path.unlink(); assert catalogue.list(scenes)==[]
    (root/'outside.kaminos.json').write_text('{"label":"Secret"}')
    (scenes/'escape.kaminos.json').symlink_to(root/'outside.kaminos.json')
    assert catalogue.list(scenes,hydrate=True)[0]['metadata']=='error'
print('scene catalogue contracts passed')

# Effective server save/import routes seed summaries without a second payload read.
import io
import serve
with TemporaryDirectory() as directory:
    root=Path(directory).resolve(); serve.SCENES_DIR=root/'scenes';serve.SCENES_DIR.mkdir()
    handler=serve.KaminosHandler.__new__(serve.KaminosHandler)
    replies=[]; handler.send_json=lambda body,*args:replies.append(body)
    body=json.dumps({'label':'Seeded','_saveAsName':'seeded','objects':[]}).encode()
    handler.headers={'Content-Length':str(len(body))};handler.rfile=io.BytesIO(body)
    handler.handle_save_scene()
    assert replies[-1]['saved']=='seeded.kaminos.json'
    path=serve.SCENES_DIR/replies[-1]['saved']
    original=Path.read_text
    def no_payload(self,*args,**kwargs):
        assert self!=path,'save must seed metadata from its accepted document'
        return original(self,*args,**kwargs)
    with patch.object(Path,'read_text',no_payload):
        handler.handle_scene_catalogue({})
        assert replies[-1]['scenes'][0]['label']=='Seeded'
        handler.handle_scene_catalogue({'metadata':['1']})
        assert replies[-1]['scenes'][0]['metadata']=='complete'
    # A competing replacement must not inherit a stale writer's label.
    old_stat=path.stat();path.write_text('{"label":"Concurrent"}')
    serve.scene_catalogue().remember(path,{'label':'Old writer'},old_stat)
    assert serve.scene_catalogue().list(serve.SCENES_DIR)[0]['metadata']=='pending'
    assert serve.scene_catalogue().list(serve.SCENES_DIR,hydrate=True)[0]['label']=='Concurrent'

# Preview bytes stay out of every summary while actual saved pictures remain usable.
import base64
with TemporaryDirectory() as directory:
    root=Path(directory).resolve(); scenes=root/'scenes';scenes.mkdir()
    catalogue=SceneCatalogue(root/'cache'); image=b'\x89PNG\r\n\x1a\nfixture'
    document={'label':'Picture','capture':{'label':'View','capturedAt':'now','image':'data:image/png;base64,'+base64.b64encode(image).decode()},'provenance':{'source_group':'local','greenroom_job_id':'job'},'composition':{'flame':{'label':'Basin','presetId':'vsp-example'}}}
    path=scenes/'picture.kaminos.json';path.write_text(json.dumps(document))
    row=catalogue.list(scenes,hydrate=True)[0]
    assert 'image' not in row['capture']; assert row['provenance']['source_group']=='local'
    assert row['composition']['flame']['label']=='Basin'
    assert catalogue.thumbnail(scenes,path.name,row['capture']['imageSha256'])==image
    path.write_text('{"label":"Changed"}')
    try: catalogue.thumbnail(scenes,path.name,row['capture']['imageSha256'])
    except FileNotFoundError: pass
    else: raise AssertionError('stale picture must not claim to describe a changed scene')
