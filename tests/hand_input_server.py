# kaminos-test: python
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ENTRY=Path(__file__).resolve().parents[1]/'hand_input.py'
class HandInputServerTests(unittest.TestCase):
    def test_configuration_and_paths(self):
        self.assertTrue(ENTRY.is_file(), 'shared hand input needs an explicit server route for existing packages and native WiLoR')
        spec=importlib.util.spec_from_file_location('hand_input_under_test',ENTRY)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);config=root/'hands.json'
            config.write_text('{"schema":"wrong"}')
            service=module.HandInputService(config)
            self.assertEqual(service.status()['status'],'invalid-configuration')
            package=root/'spiral';package.mkdir()
            (package/'package.json').write_text(json.dumps({'schema':'mobrecon.browser-weight-package.v0','models':[{'manifest':{'modelId':'mobrecon.densestack-spiralconv'}}]}))
            config.write_text(json.dumps({'schema':'kaminos.hand-input-installation.v1','packages':{'spiralconv':str(package)}}))
            service=module.HandInputService(config)
            self.assertIsNone(service.package_file('spiralconv','../hands.json'))
            self.assertEqual(service.package_file('spiralconv','package.json'),(package/'package.json').resolve())
            self.assertIsNone(service.package_file('unknown','package.json'))
            with self.assertRaisesRegex(ValueError,'session'):
                service.retain({'sessionId':'../escape','captureId':'a'})
            with self.assertRaisesRegex(ValueError,'WiLoR'):
                service.open('a')
    def test_worker_failure_has_durable_report(self):
        if not ENTRY.is_file():self.skipTest('route absent')
        spec=importlib.util.spec_from_file_location('hand_input_under_test2',ENTRY)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            worker=module.NativeWorker({'python':'/absent/python'},root)
            with self.assertRaises(OSError):worker.open()
            report=json.loads((root/'report.json').read_text())
            self.assertEqual(report['phase'],'launch')
            self.assertEqual(report['status'],'failed')
            self.assertNotIn('identity',report)

class HandInputFailures(unittest.TestCase):
    def module(self):
        spec=importlib.util.spec_from_file_location('hand_input_failures',ENTRY)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
    def test_malformed_json_returns_400(self):
        import io
        module=self.module()
        class Handler:
            def send_json(self,value,status=200):self.result=(status,value)
        for payload in [[],None,3,{'sessionId':'safe','captureId':'one','request':None}]:
            handler=Handler();body=json.dumps(payload).encode();handler.rfile=io.BytesIO(body);handler.headers={'Content-Length':str(len(body))}
            module.handle(handler,'record');self.assertEqual(handler.result[0],400)
    def test_native_open_progress_is_flushed_before_the_terminal_result(self):
        import http.client
        import http.server
        import threading
        module=self.module()
        release=threading.Event()
        result={'identity':{'model':'wilor','backend':'mlx-metal'},'faces':[0,1,2]}
        calls=[]
        class Service:
            def open(self, session, on_progress=None):
                calls.append(session)
                if on_progress is not None:
                    on_progress({'phase':'native-pose'})
                    if not release.wait(3):raise RuntimeError('test never received progress')
                return result
        module._service=Service()
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                module.handle(self,'open')
            def send_json(self,data,status=200):
                body=json.dumps(data).encode()
                self.send_response(status);self.send_header('Content-Length',str(len(body)))
                self.end_headers();self.wfile.write(body)
        with http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
            thread=threading.Thread(target=server.serve_forever);thread.start()
            conn=http.client.HTTPConnection(*server.server_address,timeout=4)
            try:
                conn.request('POST','/api/hand-input/open',json.dumps({'sessionId':'stream'}),
                             {'Accept':'application/x-ndjson'})
                response=conn.getresponse()
                self.assertEqual(response.getheader('Content-Type'),'application/x-ndjson')
                self.assertEqual(json.loads(response.readline()),{'type':'progress','phase':'native-pose'})
                release.set()
                self.assertEqual(json.loads(response.readline()),{'type':'result','result':result})
                self.assertEqual(response.read(),b'')
                conn.request('POST','/api/hand-input/open',json.dumps({'sessionId':'legacy'}))
                self.assertEqual(json.loads(conn.getresponse().read()),result)
                self.assertEqual(calls,['stream','legacy'])
            finally:
                release.set();conn.close();server.shutdown();thread.join()
    def test_worker_open_distinguishes_progress_from_result(self):
        import io
        from types import SimpleNamespace
        module=self.module()
        worker=module.NativeWorker({},ENTRY.parent)
        result={'identity':{'model':'wilor','backend':'mlx-metal'}}
        event={'phase':'native-check','loadedBytes':8,'totalBytes':16}
        worker.process=SimpleNamespace(stdin=io.StringIO(), stdout=io.StringIO(
            json.dumps({'progress':event})+'\n'+json.dumps(result)+'\n'))
        seen=[]
        self.assertEqual(worker.request({'action':'load'}, seen.append),result)
        self.assertEqual(seen,[event])
        self.assertEqual(json.loads(worker.process.stdin.getvalue()),{'action':'load'})
        worker.process.stdout=io.StringIO(json.dumps({'progress':event})+'\n')
        with self.assertRaisesRegex(RuntimeError,'ended before its response'):
            worker.request({'action':'load'},seen.append)
    def test_png_is_single_canonical_source(self):
        import base64,hashlib
        module=self.module()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);config=root/'hands.json';config.write_text(json.dumps({'schema':module.SCHEMA,'evidenceRoot':str(root/'evidence')}))
            service=module.HandInputService(config)
            raw=b'\x89PNG\r\n\x1a\n' + b'fixture';image=base64.b64encode(raw).decode()
            first=service.retain({'sessionId':'camera','captureId':'camera_1','request':{'image':image},'outcome':{'state':'submitted'}})
            self.assertEqual(first['source']['sha256'],hashlib.sha256(raw).hexdigest())
            path=root/'evidence/camera/captures/camera_1.json';d=json.loads(path.read_text());self.assertNotIn('image',d['request'])
            service.retain({'sessionId':'camera','captureId':'camera_1','request':{},'outcome':{'state':'presented'}})
            d=json.loads(path.read_text());self.assertEqual(d['source'],first['source']);self.assertEqual(d['outcome']['state'],'presented')
            class Worker:
                def request(self,payload):return payload
                def close(self):pass
            service.workers['native']=Worker()
            result=service.infer({'sessionId':'native','captureSessionId':'camera','captureId':'camera_1','frameId':1})
            self.assertEqual(result['image'],image,'native inference consumes the retained exact source')

if __name__=='__main__':unittest.main()
