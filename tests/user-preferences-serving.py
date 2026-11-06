# kaminos-test: python
"""Real Python host conformance for shared explicit user preferences."""
import json, os, socket, subprocess, sys, tempfile, time, unittest, urllib.request, urllib.error
from pathlib import Path

class PreferencesServing(unittest.TestCase):
    def test_shared_document_roundtrip_conflict_and_corruption(self):
        with tempfile.TemporaryDirectory() as temp:
            store=Path(temp)/'preferences.json'
            env={**os.environ,'KAMINOS_PREFERENCES_PATH':str(store),'KAMINOS_SHARED_BASIN_STORE':'off','KAMINOS_SCENES_DIR':temp+'/scenes'}
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            with open(Path(temp)/'server.log','w+') as log:
                process=subprocess.Popen([sys.executable,'serve.py',str(port)],cwd=Path(__file__).resolve().parents[1],env=env,stdout=log,stderr=subprocess.STDOUT)
                def request(value=None):
                    data=None if value is None else json.dumps(value).encode()
                    req=urllib.request.Request(f'http://127.0.0.1:{port}/api/preferences',data=data,headers={'Content-Type':'application/json'})
                    try:
                        with urllib.request.urlopen(req) as response:return response.status,json.loads(response.read())
                    except urllib.error.HTTPError as error:
                        body=error.read()
                        try:return error.code,json.loads(body)
                        except ValueError:return error.code,{'raw':body.decode()}
                try:
                    while True:
                        if process.poll() is not None:
                            log.seek(0);self.fail(log.read())
                        try:status,initial=request();break
                        except urllib.error.URLError:time.sleep(.05)
                    self.assertEqual(status,200,'the effective server must expose Preferences, not a missing static route')
                    self.assertIsNone(initial['revision']);self.assertIsNone(initial['preferences']['sceneDefaults'])
                    pref={**initial['preferences'],'navigationInput':'mouse','futureTool':{'enabled':True},'agentSceneDefaults':{'postprocessing':{'sceneGI':{'resolutionScale':.1,'slices':2,'steps':6,'estimator':{'aoContrast':1.5,'futureEstimator':{'enabled':True}}}}},'inferenceKiln':{'schema':'kaminos.inference-kiln-selection.v1','sceneFile':'authored.kaminos.json','promptObjectId':'prompt'}}
                    status,saved=request({'revision':None,'preferences':pref})
                    self.assertEqual(status,200);self.assertTrue(store.exists());self.assertEqual(saved['preferences'],pref)
                    status,reloaded=request();self.assertEqual(reloaded['revision'],saved['revision']);self.assertEqual(reloaded['preferences'],pref)
                    before=store.read_bytes()
                    for patch in ({'sceneFile':'../escape.kaminos.json'},{'promptObjectId':''},{'schema':'wrong'}):
                        bad={**pref,'inferenceKiln':{**pref['inferenceKiln'],**patch}}
                        self.assertEqual(request({'revision':saved['revision'],'preferences':bad})[0],400)
                        self.assertEqual(store.read_bytes(),before)
                    for agent in ([], {'objects':[]}):
                        self.assertEqual(request({'revision':saved['revision'],'preferences':{**pref,'agentSceneDefaults':agent}})[0],400)
                        self.assertEqual(store.read_bytes(),before)
                    for settings in (
                        {'postprocessing': {'sceneGI': {'estimator': {'aoContrast': -1}}}},
                        {'postprocessing': {'sceneGI': {'steps': 0}}},
                        {'postprocessing': {'sceneGI': {'steps': 10**400}}},
                        {'postprocessing': {'sceneGI': {'slices': 1.5}}},
                        {'postprocessing': {'sceneGI': {'temporal': 'true'}}},
                        {'postprocessing': {'sceneGI': {'estimator': {'depthPhi': 0}}}},
                        {'postprocessing': {'ao': {'intensity': -1}}},
                        {'postprocessing': {'dof': {'focus': 11}}},
                        {'environment': {'name': 'studio', 'exposure': -1}},
                        {'camera': {'fov': -1}},
                        {'editorDisplay': {'shading': 'typo'}},
                    ):
                        self.assertEqual(request({'revision':saved['revision'],'preferences':{**pref,'agentSceneDefaults':settings}})[0],400,settings)
                        self.assertEqual(store.read_bytes(),before)
                        self.assertEqual(request()[1]['revision'],saved['revision'])
                    accepted=request()[1]['preferences']
                    checked=subprocess.run(['node','--input-type=module','-e',"import {checkedPreferences} from './user-preferences.mjs';let body='';for await(const part of process.stdin)body+=part;checkedPreferences(JSON.parse(body));"],input=json.dumps(accepted),text=True,capture_output=True,cwd=Path(__file__).resolve().parents[1])
                    self.assertEqual(checked.returncode,0,checked.stderr)
                    self.assertEqual(request({'revision':None,'preferences':pref})[0],409)
                    self.assertEqual(request({'revision':saved['revision'],'preferences':{'schema':'wrong'}})[0],400)
                    self.assertEqual(store.read_bytes(),before,'refused saves preserve the existing document')
                    status,reset=request({'revision':saved['revision'],'preferences':{**pref,'sceneDefaults':None,'navigationInput':'trackpad'}})
                    self.assertEqual(status,200);self.assertTrue(reset['preferences']['futureTool']['enabled'])
                    store.write_text('{broken')
                    self.assertEqual(request()[0],500);self.assertEqual(store.read_text(),'{broken','corrupt preferences must not be silently replaced')
                finally:
                    process.terminate();process.wait()

if __name__=='__main__':unittest.main()
