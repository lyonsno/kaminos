# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.4.6", "scipy==1.17.1", "safetensors==0.8.0"]
# ///
"""Acquire, prepare and open the hand demo. Model files stay on this computer."""
import argparse
import concurrent.futures
import fcntl
import hashlib
import http.server
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import sys
import urllib.parse
import urllib.request
import webbrowser

MODEL_SOURCE = '3c87e958d4855f890e3884ec94bcfc0f99422c3d'
DETECTOR_SOURCE = '6114001491512c790f950934be776b99a88504b0'
ASSETS = {
    'mobrecon_densestack.pt': ('https://drive.usercontent.google.com/download?id=1QKtt5x-8Xe_afjpMTBIk2TI3G5QGk_iu&export=download&confirm=t', '2b634114dadb324802c9e55a8b7a9236f0e7b476157ac0b175f0eb258d9d276c'),
    'transform.pkl': (f'https://raw.githubusercontent.com/SeanChenxy/HandMesh/{MODEL_SOURCE}/template/transform.pkl', '78877f06e9858bedd5fbca13692ccee25cfe09b6314e7ee3b3d0827c39979f3c'),
    'hand-detector.safetensors': (f'https://huggingface.co/BasinShapers/wilor-mlx/resolve/{DETECTOR_SOURCE}/hand-detector.safetensors', '266890896e0ac1b46c39fe48035c09e90e41b36cd8d79c11e483234fafc5bdf3'),
}
EXPECTED_BUNDLES = {'mobrecon.bin': 'f1dcc913dc033819fb88676d936af9fa45d89a16b4fabf14fac4025fa280f970',
                    'hand-detector.bin': '6605792d9ffae6a873a98d68f701f1e5c8f54ecfeb28cae4806fe878a950d475'}
MODEL_FILES = {'mobrecon.package.json', 'detector.package.json', *EXPECTED_BUNDLES}


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.writing')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def download(url, path, expected=None):
    path = Path(path)
    if path.exists() and expected and digest(path) == expected:
        return {'url': url, 'path': str(path), 'sha256': expected, 'cache': 'verified'}
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.download')
    with urllib.request.urlopen(url) as response, temporary.open('wb') as stream:
        shutil.copyfileobj(response, stream)
        effective_url = response.geturl()
    actual = digest(temporary)
    if expected and actual != expected:
        rejected = path.with_suffix(path.suffix + '.rejected-' + actual)
        temporary.replace(rejected)
        raise ValueError(f'{path.name}: downloaded SHA-256 {actual} differs from {expected}; source response retained at {rejected}')
    temporary.replace(path)
    return {'url': url, 'effectiveUrl': effective_url, 'path': str(path), 'sha256': actual, 'cache': 'downloaded'}


def client_path(root, name):
    value = PurePosixPath(name)
    if value.is_absolute() or '..' in value.parts or '\\' in name:
        raise ValueError(f'Invalid client path {name}')
    return root.joinpath(*value.parts)


def fetch_client(state_dir, revision, source_base=None):
    if len(revision) != 40 or any(c not in '0123456789abcdef' for c in revision):
        raise ValueError('The client revision must be a full Git commit SHA')
    base = source_base or f'https://raw.githubusercontent.com/lyonsno/kaminos/{revision}/'
    root = state_dir / 'client'
    manifest_path = state_dir / 'client-manifest.json'
    # Source identity is explicit even on an idempotent repeat; an old cached
    # manifest is never substituted for a requested different revision.
    record = download(base + 'demos/hand-mesh/setup-client.json', manifest_path)
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('schema') != 'kaminos.hand-demo-client.v1' or not manifest.get('files'):
        raise ValueError('Invalid hand demo client manifest')
    tasks = []
    with concurrent.futures.ThreadPoolExecutor() as pool:
        for row in manifest['files']:
            target = client_path(root, row['path'])
            tasks.append(pool.submit(download, base + row['path'], target, row['sha256']))
        records = [task.result() for task in tasks]
    return root, {'revision': revision, 'manifest': record, 'files': records}


def import_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prepared_models_valid(root):
    try:
        for kind, schema in [('mobrecon', 'mobrecon.browser-weight-package.v0'), ('detector', 'wilor-hand-detector.browser-weight-package.v0')]:
            package = json.loads((root / f'{kind}.package.json').read_text())
            if package['schema'] != schema or package['status'] != 'succeeded' or len(package['resources']) != 1:
                return False
            row = package['resources'][0]
            expected_name = 'mobrecon.bin' if kind == 'mobrecon' else 'hand-detector.bin'
            if row['file'] != expected_name or digest(root / row['file']) != EXPECTED_BUNDLES[row['file']]:
                return False
            if row['manifest']['bundle']['sha256'] != EXPECTED_BUNDLES[row['file']] or row['manifest']['bundle']['byteLength'] != (root / row['file']).stat().st_size:
                return False
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def prepare_models(state_dir, client, state):
    models = state_dir / 'models'
    if prepared_models_valid(models):
        state['preparation'] = 'verified-existing-packages'
        return models
    assets = state_dir / 'assets'
    state['phase'] = 'upstream-downloads'
    write_json(state_dir / 'setup-state.json', state)
    print('Downloading the original model files (about 156 MB).', flush=True)
    state['assets'] = [download(url, assets / name, sha) for name, (url, sha) in ASSETS.items()]
    state['phase'] = 'model-preparation'
    write_json(state_dir / 'setup-state.json', state)
    print('Preparing browser models. No model framework or compiler is needed.', flush=True)
    packer = import_file('hand_portable_pack', client / 'models/mobrecon/portable_pack.py')
    packer.prepare(assets / 'mobrecon_densestack.pt', assets / 'transform.pkl', client / 'models/mobrecon/fixtures/tensor-shapes.json', models / 'mobrecon')
    detector = import_file('hand_detector_pack', client / 'models/wilor-hand-detector/pack-weights.py')
    import numpy as np
    from safetensors.numpy import load_file
    arrays = load_file(str(assets / 'hand-detector.safetensors'))
    tensors = detector.fold(arrays)
    detector_out = models / 'detector'
    detector_out.mkdir(parents=True, exist_ok=True)
    revision = f'BasinShapers/wilor-mlx:hand-detector:{ASSETS["hand-detector.safetensors"][1][:16]}:f32-bn-folded'
    resource = detector.write_bundle(detector_out, 'hand-detector', tensors, revision)
    package = {'schema': detector.SCHEMA, 'status': 'succeeded', 'revision': revision, 'dtype': 'f32', 'resources': [resource],
               'provenance': {'weightsSha256': ASSETS['hand-detector.safetensors'][1], 'sourceRevision': detector.SOURCE_REVISION,
                              'source': 'WiLoR-MLX hand detector', 'preparation': 'numpy-safetensors-no-mlx-no-inference'}}
    write_json(detector_out / 'package.json', package)
    for kind in ['mobrecon', 'detector']:
        metadata = json.loads((models / kind / 'package.json').read_text())
        resource = metadata['resources'][0]
        expected = EXPECTED_BUNDLES.get(resource['file'])
        if not expected or resource['manifest']['bundle']['sha256'] != expected:
            raise ValueError(f'{kind}: prepared package differs from the accepted browser model')
        (models / kind / resource['file']).replace(models / resource['file'])
        write_json(models / f'{kind}.package.json', metadata)
    if not prepared_models_valid(models):
        raise ValueError('Prepared model validation failed')
    state['preparation'] = 'numpy-scipy-safetensors-byte-identical'
    state['versions'] = {'python': platform.python_version(), 'numpy': np.__version__}
    return models


def acknowledge_terms(state_dir, accepted):
    path = state_dir / 'model-terms.json'
    if path.exists() and json.loads(path.read_text()).get('acknowledged') is True:
        return
    print('Model files are fetched directly from their original sources and stay on this computer.\n'
          'This route includes MANO-derived data, with noncommercial use and other restrictions.\n'
          'Read the terms before continuing:\n'
          '  https://mano.is.tue.mpg.de/license.html\n'
          '  https://github.com/SeanChenxy/HandMesh\n'
          '  https://huggingface.co/BasinShapers/wilor-mlx\n', flush=True)
    if not accepted:
        try:
            with open('/dev/tty', 'r') as terminal_input, open('/dev/tty', 'w') as terminal_output:
                terminal_output.write('Continue under the applicable model terms? Type yes: ')
                terminal_output.flush()
                accepted = terminal_input.readline().strip().lower() == 'yes'
        except OSError:
            raise ValueError('Model terms need acknowledgement; rerun in a terminal or pass --accept-model-terms after reviewing them')
    if not accepted:
        raise ValueError('Model download declined; no model files were acquired')
    write_json(path, {'acknowledged': True, 'manoTerms': 'https://mano.is.tue.mpg.de/license.html'})


def make_server(client, models, state, port=0):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(client), **kwargs)

        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.headers.get('Host') not in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'):
                self.send_error(403)
                return
            path = urllib.parse.urlsplit(self.path).path
            if path == '/api/runtime-config':
                body = json.dumps({'schema': 'kaminos.hand-demo-runtime.v1', 'source': {'kind': 'verified-client-download', 'repoRoot': str(client), 'commit': state['revision'], 'manifestSha256': state['client']['manifest']['sha256']}}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path.startswith('/__hand-models/'):
                name = path.removeprefix('/__hand-models/')
                if name not in MODEL_FILES:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'application/json' if name.endswith('.json') else 'application/octet-stream')
                self.send_header('Content-Length', str((models / name).stat().st_size))
                self.end_headers()
                with (models / name).open('rb') as stream:
                    shutil.copyfileobj(stream, self.wfile)
                return
            super().do_GET()
    return http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=Path.home() / '.local/share/kaminos/hand-demo')
    parser.add_argument('--revision', required=True)
    parser.add_argument('--accept-model-terms', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args(argv)
    state_dir = args.state_dir.expanduser().resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    # A second command must not rewrite files beneath an already serving demo.
    lock = (state_dir / 'setup.lock').open('a+')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(f'This setup is already running. Use its terminal, or choose a different --state-dir. State: {state_dir / "setup-state.json"}', file=sys.stderr)
        lock.close()
        return 1
    state = {'schema': 'kaminos.hand-demo-setup.v1', 'status': 'failed', 'phase': 'terms', 'revision': args.revision, 'stateDir': str(state_dir)}
    try:
        acknowledge_terms(state_dir, args.accept_model_terms)
        state['phase'] = 'client-download'
        write_json(state_dir / 'setup-state.json', state)
        print('Getting the hand demo…', flush=True)
        client, state['client'] = fetch_client(state_dir, args.revision)
        models = prepare_models(state_dir, client, state)
        state.update(status='prepared', phase='complete', modelBundles=EXPECTED_BUNDLES)
        write_json(state_dir / 'setup-state.json', state)
        if args.prepare_only:
            print(f'Prepared: {state_dir}', flush=True)
            return 0
        server = make_server(client, models, state, args.port)
        state.update(status='serving', url=f'http://127.0.0.1:{server.server_port}/demos/hand-mesh/?models=/__hand-models/')
        write_json(state_dir / 'setup-state.json', state)
        print(f'\n{state["url"]}\nClick Start camera. No folder selection is needed.\nKeep this terminal open. Press Ctrl-C to stop; your models stay cached.\n', flush=True)
        if not args.no_open:
            webbrowser.open(state['url'])
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            state['status'] = 'prepared'
            write_json(state_dir / 'setup-state.json', state)
        return 0
    except Exception as error:
        state['status'] = 'failed'
        state['error'] = f'{type(error).__name__}: {error}'
        write_json(state_dir / 'setup-state.json', state)
        print(f'\nSetup stopped during {state["phase"]}: {error}\nDetails: {state_dir / "setup-state.json"}\nRerun the same command to resume.', file=sys.stderr)
        return 1
    finally:
        lock.close()


if __name__ == '__main__':
    sys.exit(main())
