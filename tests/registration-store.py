# kaminos-test: python
import unittest, tempfile, json, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import importlib.util
import os, socket, subprocess, time, urllib.request, urllib.error
from urllib.parse import urlencode

class RegistrationStore(unittest.TestCase):
    def test_real_http_save_reopen_and_cross_origin_refusal(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'arm.glb').write_bytes(b'http witness');(root/'source.json').write_text('{}')
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            env={**os.environ,'KAMINOS_GENERATED_MESH_DIR':temp,'KAMINOS_SCENES_DIR':temp,'KAMINOS_SHARED_BASIN_STORE':'off'}
            with (root/'server.log').open('w+') as log:
                process=subprocess.Popen([sys.executable,'serve.py',str(port)],cwd=Path(__file__).resolve().parents[1],env=env,stdout=log,stderr=log)
                source='/api/read?root=scenes&path=source.json';target='/api/read?root=generated-meshes&path=arm.glb'
                def request(payload=None,record_id=None,origin=None):
                    query={'sourceUrl':source,'targetUrl':target}
                    if record_id:query['id']=record_id
                    headers={'Content-Type':'application/json'}
                    if origin:headers['Origin']=origin
                    req=urllib.request.Request(f'http://127.0.0.1:{port}/api/asset-registrations?'+urlencode(query),data=None if payload is None else json.dumps(payload).encode(),headers=headers)
                    try:
                        with urllib.request.urlopen(req) as response:return response.status,json.loads(response.read())
                    except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
                try:
                    while True:
                        if process.poll() is not None:log.seek(0);self.fail(log.read())
                        try:status,catalog=request();break
                        except urllib.error.URLError:time.sleep(.05)
                    self.assertEqual(status,200)
                    pose={'position':[3,4,5],'rotation':[0,.2,0],'scale':[-1,2,3]}
                    recipe={'sourceUrl':source,'targetUrl':target,'targetTransform':pose,'settings':{'alignment':pose},'jointGuesses':{'missing':None,'pin':pose}}
                    payload={'name':'HTTP fit','recipe':recipe,'identity':catalog['identity']}
                    self.assertEqual(request(payload,origin='https://another-site.test')[0],403)
                    status,saved=request(payload);self.assertEqual(status,200)
                    status,reopened=request(record_id=saved['registration']['id']);self.assertEqual(status,200)
                    self.assertEqual(reopened['registration']['recipe'],recipe)
                    bad={**payload,'identity':{}};self.assertEqual(request(bad)[0],400)
                    self.assertEqual(len(request()[1]['registrations']),1)
                finally:process.terminate();process.wait()

    def test_named_registration_roundtrip_and_identity(self):
        spec=importlib.util.find_spec('registration_store')
        self.assertIsNotNone(spec,'asset-associated registration storage is missing')
        import registration_store as store
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'arm.glb').write_bytes(b'glb witness');(root/'source.json').write_text('{}')
            roots=[{'id':'test','path':str(root)}]
            source='/api/read?root=test&path=source.json';target='/api/read?root=test&path=arm.glb'
            identity=store.identify(roots,source,target)
            pose={'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]}
            recipe={'sourceUrl':source,'targetUrl':target,'targetTransform':pose,'settings':{'alignment':pose,'falloff':.035,'threshold':.5},'jointGuesses':{'pin':pose}}
            receipt=store.save(roots,{'name':'Noah fit','recipe':recipe,'identity':identity})
            second=store.save(roots,{'name':'Noah fit','recipe':recipe,'identity':identity})
            self.assertNotEqual(receipt['id'],second['id'])
            reopened=store.catalog(roots,source,target,receipt['id'])
            self.assertEqual(reopened['registration']['recipe'],recipe)
            self.assertEqual(len(store.catalog(roots,source,target)['registrations']),2)
            self.assertEqual((root/'arm.glb').read_bytes(),b'glb witness')
            (root/'arm.glb').write_bytes(b'changed geometry')
            with self.assertRaisesRegex(ValueError,'changed'):store.save(roots,{'name':'stale','recipe':recipe,'identity':identity})
            with self.assertRaisesRegex(ValueError,'changed'):store.catalog(roots,source,target,receipt['id'])
            with self.assertRaises((ValueError,PermissionError)):store.identify(roots,source,'/api/read?root=test&path=../escape.glb')
            with self.assertRaises(ValueError):store.catalog(roots,source,target,'../escape')

if __name__=='__main__':unittest.main()
