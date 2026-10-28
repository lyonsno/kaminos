# kaminos-test: python
"""Metadata admission and real HTTP serving for the observed BFL ONNX package layout."""
import http.client
import http.server
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import threading
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve
from model_installations import ModelInstallations
with TemporaryDirectory() as directory:
    root = (Path(directory) / 'pup').resolve()
    root.mkdir()
    external = {'decoder_model_merged_q4f16.onnx': 3, 'vision_encoder_fp16.onnx': 1, 'embed_tokens_q4f16.onnx': 1}
    required = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'chat_template.jinja', 'system_prompts.json']
    files = []
    for name in required:
        (root/name).write_text('{}')
    for graph, count in external.items():
        (root/'onnx').mkdir(exist_ok=True)
        (root/'onnx'/graph).write_bytes(b'graph')
        for i in range(count):
            name = 'onnx/' + graph + '_data' + (f'_{i}' if i else '')
            (root/name).write_bytes(bytes(range(128)))
            files.append({'path': name, 'bytes': 128})
    provenance = {'status':'complete','source':'fixture/3f3edb52b2c55de0d49feab28598b68f7f8e4830','external_data':external,'files':files,'future_field':True}
    (root/'provenance.json').write_text(json.dumps(provenance))
    prior = serve.MODEL_INSTALLATIONS
    serve.MODEL_INSTALLATIONS = ModelInstallations(environ={'KAMINOS_PUP_WEIGHTS_ROOT':str(root)}, config_path=root.parent/'no-installations.json')
    server = http.server.ThreadingHTTPServer(('127.0.0.1',0),serve.KaminosHandler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    def get(path,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',server.server_address[1]);c.request('GET',path,headers=headers or {});r=c.getresponse();body=r.read();c.close();return r,body
    try:
        assert serve.runtime_config()['pup'] == {'modelUrl':'/pup-weights','modelRoot':str(root),'mounted':True,'keepLoadedDefault':False}
        response,body=get('/pup-weights/onnx/embed_tokens_q4f16.onnx_data',{'Range':'bytes=10-19'})
        assert response.status==206 and body==bytes(range(10,20))
        assert response.getheader('Content-Range')=='bytes 10-19/128'
        for name in required+['onnx/vision_encoder_fp16.onnx','onnx/decoder_model_merged_q4f16.onnx_data_2']:
            target=root/name;saved=target.read_bytes();target.unlink();assert not serve.runtime_config()['pup']['mounted'],name;target.write_bytes(saved)
        target=root/files[0]['path'];target.write_bytes(b'truncated');assert not serve.runtime_config()['pup']['mounted'];target.write_bytes(bytes(range(128)))
        # Required external lengths cannot use the graph-only optional-size sentinel.
        for invalid in (None, 0, -1, True, '128'):
            target=root/files[0]['path'];target.write_bytes(b'x')
            malformed=[dict(entry) for entry in files];malformed[0]['bytes']=invalid
            (root/'provenance.json').write_text(json.dumps({**provenance,'files':malformed}))
            assert not serve.runtime_config()['pup']['mounted'],('external bytes',invalid)
            target.write_bytes(bytes(range(128)))
        (root/'provenance.json').write_text(json.dumps(provenance))
        for patch in [{'status':'partial'},{'source':'different/model'},{'external_data':{}},{'files':[]}]:
            (root/'provenance.json').write_text(json.dumps({**provenance,**patch}));assert not serve.runtime_config()['pup']['mounted'],patch
        (root/'provenance.json').write_text(json.dumps(provenance))
        (Path(directory)/'outside').write_text('secret')
        for path in ['/pup-weights/../outside','/pup-weights/%2e%2e/outside']:
            response,body=get(path);assert response.status==404 and b'secret' not in body
        serve.MODEL_INSTALLATIONS=ModelInstallations(environ={}, config_path=root.parent/'no-installations.json');assert serve.runtime_config()['pup'] is None
        response,_=get('/pup-weights/config.json');assert response.status==404
    finally:
        server.shutdown();server.server_close();serve.MODEL_INSTALLATIONS=prior
print('BFL PUP explicit mount, missing-package admission and HTTP contracts pass')
