# kaminos-test: python
import base64, importlib.util, json, struct, tempfile, zlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('basin_cover_store',root/'basin_cover_store.py')
if not spec or not spec.loader or not (root/'basin_cover_store.py').exists():
    raise AssertionError('Basin cover persistence is unavailable')
cover=importlib.util.module_from_spec(spec);spec.loader.exec_module(cover)
def png(width=2,height=2):
    chunk=lambda kind,data:struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes([220,40,10,255,10,20,30,255]))*height))+chunk(b'IEND',b'')
preset='vsp-'+'a'*64
portrait={'schema':'kaminos.flame-portrait.v1','image':'data:image/png;base64,'+base64.b64encode(png()).decode(),'width':2,'height':2,'capturedAt':'2026-10-26T12:00:00.000Z','framing':'domain-front-v1','camera':{'position':[0,1,4],'target':[0,1,0],'up':[0,1,0],'fov':35},'simulation':{'simStepCount':50,'backend':'webgpu','effectiveRoute':'ordinary'},'origin':'current-field'}
with tempfile.TemporaryDirectory() as d:
    shared=Path(d)/'shared'; local=Path(d)/'local'
    for p in [shared,local]:
        (p/'presets').mkdir(parents=True);(p/'presets'/f'{preset}.json').write_text('{"presetId":"'+preset+'"}')
    original=(shared/'presets'/f'{preset}.json').read_bytes()
    one=cover.write_cover(shared,preset,portrait,{'commit':'first'})
    assert one['presetId']==preset and one['imageHash'].startswith('sha256:')
    assert (shared/'presets'/f'{preset}.json').read_bytes()==original,'cover cannot change immutable basin'
    read=cover.read_cover([('shared',shared),('local',local)],preset,include_image=True)
    assert read['portrait']['image']==portrait['image'];assert read['storeRole']=='shared'
    assert cover.read_cover([('local',local)],preset) is None
    two=cover.write_cover(shared,preset,{**portrait,'capturedAt':'2026-10-26T12:01:00Z'},{'commit':'second'})
    assert two['imageHash']==one['imageHash']
    for bad in [{**portrait,'width':3},{**portrait,'image':'data:image/png;base64,AAAA'},{**portrait,'simulation':{'simStepCount':0}},{**portrait,'framing':'invented'}]:
        try:cover.write_cover(shared,preset,bad,{})
        except ValueError:pass
        else:raise AssertionError('invalid portrait accepted')
    assert cover.read_cover([('shared',shared)],preset)['portrait']['capturedAt']=='2026-10-26T12:01:00Z','bad write retained preceding cover'
    try:cover.write_cover(shared,'vsp-'+'b'*64,portrait,{})
    except FileNotFoundError:pass
    else:raise AssertionError('cover accepted for missing basin')
    try:cover.read_cover([('shared',shared)],'../outside')
    except ValueError:pass
    else:raise AssertionError('unsafe id accepted')
print('Basin covers preserve immutable basins, match PNG dimensions, retain provenance and reject false captures')
