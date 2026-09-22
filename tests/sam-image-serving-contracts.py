import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

assert hasattr(serve, 'ingest_image_asset'), 'Kaminos must persist caller images and mask outputs in its image asset inbox'
with TemporaryDirectory() as directory:
    root = next(row for row in serve.ASSET_ROOTS if row['id'] == 'image-inbox')
    previous = root['path']
    root['path'] = Path(directory)
    try:
        first = serve.ingest_image_asset('cutout.png', b'first-image')
        second = serve.ingest_image_asset('cutout.png', b'second-image')
        assert first['path'] != second['path'], 'saving a later mask must not overwrite an earlier asset'
        assert (Path(directory) / first['path']).read_bytes() == b'first-image'
        assert first['source'].startswith('/api/read?')
        assert first['name'] == 'cutout.png', 'asset identity must not replace its human name'
        assert serve.ingest_image_asset('cutout.png', b'first-image')['path'] == first['path']
        long_name = 'a' * 230 + '.png'
        assert serve.ingest_image_asset(long_name, b'long-name')['name'] == long_name
        for name in ['../escaped.png', '/escaped.png', 'script.html']:
            try:
                serve.ingest_image_asset(name, b'data')
            except (ValueError, PermissionError):
                pass
            else:
                raise AssertionError(f'unsupported image name accepted: {name}')
    finally:
        root['path'] = previous
print('SAM image asset serving contracts passed')
