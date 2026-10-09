from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve
assert hasattr(serve,'prepare_authoring_image'), 'selected images need a server preparation operation, not original-image passthrough'
from tempfile import TemporaryDirectory
from unittest.mock import patch
from types import SimpleNamespace
import hashlib,json,io
from PIL import Image
from authoring_image_preparation import prepare

with TemporaryDirectory() as directory:
    root=Path(directory);image=Image.new('RGBA',(12,10),(120,80,40,0));image.putpixel((6,5),(140,80,40,200));stream=io.BytesIO();image.save(stream,format='PNG');raw=stream.getvalue()
    result=prepare(raw,root,root/'absent-model')
    assert result['route']=='input-alpha' and result['modelCalls']==0
    assert result['prepared']['width']==12 and result['prepared']['height']==10
    assert (root/result['original']['path']).read_bytes()==raw
    assert Image.open(root/result['prepared']['path']).getpixel((6,5))==(140,80,40,200)
    assert prepare(raw,root,root/'absent-model')['cached'] is True
    (root/result['prepared']['path']).write_bytes(b'corrupt')
    try:prepare(raw,root,root/'absent-model')
    except ValueError as error:assert 'identity' in str(error)
    else:raise AssertionError('cached corruption must fail')
    blank=io.BytesIO();Image.new('RGBA',(4,4),(0,0,0,0)).save(blank,format='PNG')
    try:prepare(blank.getvalue(),root,root/'absent-model')
    except ValueError as error:assert 'nonempty foreground' in str(error)
    else:raise AssertionError('blank cutout must fail')
    assert any(json.loads(p.read_text()).get('status')=='failed' for p in root.glob('*/report.json'))
    for source,digest in [('https://example.com/input.png',hashlib.sha256(raw).hexdigest()),('/api/read?root=image-inbox&path=a.png','wrong')]:
        with patch.object(serve.subprocess,'run',side_effect=AssertionError('must refuse before preparation')):
            try:serve.prepare_authoring_image(raw,source=source,name='a.png',expected_sha256=digest)
            except ValueError:pass
            else:raise AssertionError('invalid source or bytes admitted')
    entry={'source':'/api/read?root=image-inbox&path=original.png'}
    claimed={'status':'complete','original':{'sha256':hashlib.sha256(raw).hexdigest()},'prepared':{'path':'cutout.png','sha256':'wrong'}}
    (root/'cutout.png').write_bytes(raw)
    with patch.object(serve,'ingest_image_asset',return_value=entry),patch.object(serve,'KAMINOS_IMAGE_PREPARATION_DIR',root),patch.object(serve.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(claimed).encode(),stderr=b'')):
        try:serve.prepare_authoring_image(raw,source='/api/read?root=image-inbox&path=a.png',name='a.png',expected_sha256=hashlib.sha256(raw).hexdigest())
        except RuntimeError as error:assert 'identity' in str(error)
        else:raise AssertionError('wrong prepared bytes admitted')
print('Preparation retention, alpha reuse, blank/corrupt/source refusal passed')
