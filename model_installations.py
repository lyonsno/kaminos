"""Shared local model installations, resolved once for each server invocation.

Registration records existing packages; it does not copy weights or start models.
Availability checks inspect the current package metadata and file lengths only.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

SCHEMA = 'kaminos.model-installations.v1'
MODELS = {
    'klein': {'env': 'KAMINOS_KLEIN_WEIGHTS_ROOT', 'url': '/klein-weights', 'urlField': 'weightsUrl', 'label': 'FLUX.2 Klein'},
    'flux3': {'env': 'KAMINOS_FLUX3_WEIGHTS_ROOT', 'url': '/flux3-weights', 'urlField': 'weightsUrl', 'label': 'FLUX.3'},
    'pup': {'env': 'KAMINOS_PUP_WEIGHTS_ROOT', 'url': '/pup-weights', 'urlField': 'modelUrl', 'label': 'PUP prompt expansion'},
    'sam3': {'env': 'KAMINOS_SAM3_PACKET_ROOT', 'url': '/sam3-packet', 'urlField': 'manifestUrl', 'label': 'SAM3'},
    'trellisPage': {'env': 'KAMINOS_TRELLIS_CHECKPOINT_ROOT', 'url': '/trellis-checkpoints', 'urlField': 'checkpointUrl', 'label': 'TRELLIS'},
}


def installation_path(environ=None):
    env = os.environ if environ is None else environ
    if env.get('KAMINOS_MODEL_INSTALLATIONS'):
        return Path(env['KAMINOS_MODEL_INSTALLATIONS']).expanduser().resolve()
    config = Path(env.get('XDG_CONFIG_HOME') or Path(env.get('HOME') or Path.home()) / '.config')
    return (config / 'kaminos' / 'models.json').expanduser().resolve()


def read_installations(path):
    if not path.exists():
        return {'schema': SCHEMA, 'models': {}}
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or value.get('schema') != SCHEMA or not isinstance(value.get('models'), dict):
        raise ValueError(f'Expected {SCHEMA} with a models object in {path}')
    return value


def _manifest(root, relative, schema=None):
    path = root / relative
    if not path.is_file():
        raise ValueError(f'Missing {relative} in {root}')
    try:
        value = json.loads(path.read_text())
    except (ValueError, UnicodeError) as error:
        raise ValueError(f'Invalid JSON in {relative}: {error}') from error
    if not isinstance(value, dict):
        raise ValueError(f'{relative} must contain an object')
    if schema is not None and value.get('schema') != schema:
        raise ValueError(f'{relative}: expected schema {schema}; found {value.get("schema")!r}')
    return value


def _payload(root, relative, expected=None):
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise ValueError(f'Missing or inaccessible payload {relative}')
    size = target.stat().st_size
    if size <= 0 or (expected is not None and (type(expected) is not int or expected <= 0 or size != expected)):
        raise ValueError(f'Empty or truncated payload {relative}: expected {expected}, found {size} bytes')


def _image_package(root, family):
    def component(part, schema):
        value = _manifest(root, part + '/manifest.json', schema)
        if not isinstance(value.get('config'), dict) or not value['config']:
            raise ValueError(f'{part}/manifest.json is missing component configuration')
        return value

    def payload(part, entry, expected=None):
        if not isinstance(entry, dict) or not isinstance(entry.get('file'), str) or not entry['file']:
            raise ValueError(f'{part}/manifest.json is missing a payload descriptor')
        # Preserve the loader's component boundary as well as its package boundary.
        base = root / part
        if not (base / entry['file']).resolve().is_relative_to(base):
            raise ValueError(f'{part} payload escapes its component: {entry["file"]}')
        _payload(root, part + '/' + entry['file'], entry.get('bytes', expected))

    def bundles(part, manifest, names):
        entries = manifest.get('bundles')
        if not isinstance(entries, dict) or not entries or not set(names).issubset(entries):
            raise ValueError(f'{part}/manifest.json is missing required weight bundles')
        for entry in entries.values():
            if not isinstance(entry, dict) or not isinstance(entry.get('tensors'), list) or not entry['tensors']:
                raise ValueError(f'{part}/manifest.json is missing tensor descriptions')
            payload(part, entry)

    te = component('te', f'kaminos.{family}-klein.text-encoder-weights.v1')
    dit = component('dit', f'kaminos.{family}-klein.transformer-weights.v1')
    vae = component('vae', 'kaminos.flux2-klein.vae-decoder-weights.v0')
    layers = te.get('layers')
    if type(layers) is not int or layers <= 0 or not isinstance(te.get('taps'), list) or not te['taps']:
        raise ValueError('te/manifest.json is missing layer or tap metadata')
    bundles('te', te, (f'layer{i:02d}' for i in range(layers)))
    embedding = te.get('embedding', {})
    shape, row_bytes = embedding.get('shape'), embedding.get('row_bytes')
    if not isinstance(shape, list) or len(shape) != 2 or not all(type(n) is int and n > 0 for n in shape) or type(row_bytes) is not int or row_bytes <= 0:
        raise ValueError('te/manifest.json is missing embedding shape or row bytes')
    payload('te', embedding, shape[0] * row_bytes)
    payload('te', te.get('tokenizer'))
    counts = [dit['config'].get('num_layers'), dit['config'].get('num_single_layers')]
    if not all(type(n) is int and n >= 0 for n in counts) or not any(counts):
        raise ValueError('dit/manifest.json has invalid layer counts')
    modes = ['double'] if family == 'flux2' else ['txt', 'img']
    names = ['globals'] + [f'{mode}{i:02d}' for mode in modes for i in range(counts[0])] + [f'single{i:02d}' for i in range(counts[1])]
    bundles('dit', dit, names)
    bundle = vae.get('bundle')
    if not isinstance(bundle, dict) or not isinstance(bundle.get('tensors'), list) or not bundle['tensors']:
        raise ValueError('vae/manifest.json is missing tensor descriptions')
    payload('vae', bundle)


def _pup_package(root):
    external = {'decoder_model_merged_q4f16.onnx': 3, 'vision_encoder_fp16.onnx': 1, 'embed_tokens_q4f16.onnx': 1}
    provenance = _manifest(root, 'provenance.json')
    if provenance.get('status') != 'complete' or not provenance.get('source', '').endswith('/3f3edb52b2c55de0d49feab28598b68f7f8e4830') or provenance.get('external_data') != external:
        raise ValueError('provenance.json does not identify the supported complete PUP browser package')
    sizes = {entry['path']: entry['bytes'] for entry in provenance['files']}
    for name in ('config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'chat_template.jinja', 'system_prompts.json'):
        _payload(root, name)
    for graph, count in external.items():
        _payload(root, 'onnx/' + graph)
        for index in range(count):
            name = 'onnx/' + graph + '_data' + (f'_{index}' if index else '')
            if name not in sizes or type(sizes[name]) is not int or sizes[name] <= 0:
                raise ValueError(f'provenance.json is missing the byte length for {name}')
            _payload(root, name, sizes[name])


def check_package(name, root):
    if name in ('klein', 'flux3'):
        _image_package(root, 'flux2' if name == 'klein' else 'flux3')
    elif name == 'pup':
        _pup_package(root)
    elif name == 'trellisPage':
        _manifest(root, 'manifest.json', 'trellis2.generation-inputs.v0')
    elif name == 'sam3':
        # SAM owns tensor/model admission; startup only establishes this manifest.
        _manifest(root, 'tensor-manifest.json')
    else:
        raise ValueError(f'Unknown local model: {name}')


class ModelInstallations:
    def __init__(self, environ=None, config_path=None):
        self.environ = dict(os.environ if environ is None else environ)
        self.path = Path(config_path).expanduser().resolve() if config_path is not None else installation_path(self.environ)
        self.configuration_error = None
        try:
            catalog = read_installations(self.path)
        except (OSError, ValueError, UnicodeError) as error:
            catalog = {'models': {}}
            self.configuration_error = str(error)
        self._choices = {}
        for name, spec in MODELS.items():
            source, root, error, disabled, requested = 'none', None, None, False, None
            try:
                if spec['env'] in self.environ:
                    source, requested = 'environment', self.environ[spec['env']]
                    if requested.strip():
                        root = Path(requested).expanduser().resolve()
                    else:
                        disabled, error = True, 'Disabled by the explicit environment override'
                elif self.configuration_error:
                    source, error = 'installation', self.configuration_error
                elif name in catalog['models']:
                    source, entry = 'installation', catalog['models'][name]
                    if isinstance(entry, dict) and isinstance(entry.get('root'), str) and entry['root'].strip():
                        requested = entry['root']
                        candidate = Path(requested).expanduser()
                        root = (candidate if candidate.is_absolute() else self.path.parent / candidate).resolve()
                    else:
                        error = f'{self.path}: {name} requires a nonempty root path'
            except (OSError, ValueError, RuntimeError) as invalid:
                error = f'Invalid {name} package path: {invalid}'
            self._choices[name] = {'root': root, 'source': source, 'error': error, 'disabled': disabled, 'requested': requested}

    def root(self, name):
        return self._choices[name]['root']

    def availability(self, name):
        choice = self._choices[name]
        root, source = choice['root'], choice['source']
        status, reason = 'available', None
        if choice['error']:
            status = 'disabled' if choice['disabled'] else 'invalid-configuration'
            reason = choice['error']
        elif root is None:
            status = 'not-installed'
            reason = f'{MODELS[name]["label"]} is not installed. Register an existing package with python3 model_installations.py register {name} --root <package>.'
        else:
            try:
                check_package(name, root)
            except (OSError, ValueError, TypeError, AttributeError, KeyError, UnicodeError) as error:
                status, reason = 'unavailable', str(error)
        return {'root': str(root) if root else None, 'source': source, 'status': status, 'reason': reason,
                'installationFile': str(self.path), 'requestedRoot': choice['requested'], 'validation': 'manifest' if name in ('sam3', 'trellisPage') else 'loader-layout'}

    def browser_config(self):
        reports = {name: self.availability(name) for name in MODELS}
        result = {'modelAvailability': reports}
        for name, spec in MODELS.items():
            root, report = self.root(name), reports[name]
            entry = {spec['urlField']: spec['url'], 'modelRoot': str(root), 'mounted': report['status'] == 'available'} if root else None
            if entry is not None and name == 'sam3':
                entry['manifestUrl'] += '/tensor-manifest.json'
            if entry is not None and name == 'pup':
                entry['keepLoadedDefault'] = self.environ.get('KAMINOS_PUP_KEEP_LOADED', '').lower() in ('1', 'true', 'yes')
            if entry is not None and name == 'trellisPage':
                manifest = root / 'manifest.json'
                try:
                    entry['manifestSha256'] = hashlib.sha256(manifest.read_bytes()).hexdigest() if manifest.is_file() else None
                except OSError as error:
                    entry['manifestSha256'], entry['mounted'] = None, False
                    report['status'], report['reason'] = 'unavailable', str(error)
            result[name] = entry
        return result


def register_model(name, root, config_path=None):
    if name not in MODELS:
        raise ValueError(f'Unknown local model: {name}')
    root = Path(root).expanduser().resolve()
    check_package(name, root)
    path = Path(config_path).expanduser().resolve() if config_path is not None else installation_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with Path(str(path) + '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        value = read_installations(path)
        previous = value['models'].get(name, {})
        value['models'][name] = {**(previous if isinstance(previous, dict) else {}), 'root': str(root)}
        with tempfile.NamedTemporaryFile('w', dir=path.parent, prefix=path.name + '.', delete=False) as pending:
            json.dump(value, pending, indent=2); pending.write('\n'); pending.flush(); os.fsync(pending.fileno())
            pending_path = Path(pending.name)
        try:
            os.replace(pending_path, path)
        finally:
            pending_path.unlink(missing_ok=True)
    return {'model': name, 'root': str(root), 'installationFile': str(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    status = commands.add_parser('status', help='Show resolved local packages and their availability')
    status.add_argument('--config', type=Path)
    register = commands.add_parser('register', help='Register an existing package once for every working copy')
    register.add_argument('model', choices=MODELS)
    register.add_argument('--root', required=True, type=Path)
    register.add_argument('--config', type=Path)
    args = parser.parse_args()
    try:
        value = ModelInstallations(config_path=args.config).browser_config() if args.command == 'status' else register_model(args.model, args.root, args.config)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, UnicodeError, RuntimeError) as error:
        parser.exit(1, json.dumps({'ok': False, 'error': str(error)}) + '\n')
    print(json.dumps(value, indent=2))


if __name__ == '__main__':
    main()
