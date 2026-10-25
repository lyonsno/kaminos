"""Export the upstream joint regressor locally; MANO-derived data stays off Git."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

REGRESSOR_SHA256 = '8de28f843240f88c836cd45104ae3203b0e8660180202ec8c44f926da42624bf'
MPII_FROM_MANO = [0, 13, 14, 15, 20, 1, 2, 3, 16, 4, 5, 6, 17, 10, 11, 12, 19, 7, 8, 9, 18]


def prepare(source, output):
    path = Path(source) / 'template/j_reg.npy'
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != REGRESSOR_SHA256:
        raise ValueError('unexpected upstream joint regressor')
    matrix = np.load(path, allow_pickle=False)
    if matrix.shape != (21, 778) or not np.isfinite(matrix).all():
        raise ValueError('invalid upstream regressor shape or values')
    resource = dict(schema='mobrecon.hand-registration.v0', jointOrder='mpii', vertexCount=778,
                    source=dict(repo='SeanChenxy/HandMesh', revision='3c87e958d4855f890e3884ec94bcfc0f99422c3d',
                                file='template/j_reg.npy', sha256=digest,
                                terms='MANO-derived local asset; same terms as prepared mesh topology'),
                    regressor=matrix[MPII_FROM_MANO].ravel().tolist())
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(resource, allow_nan=False) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    prepare(args.source, args.out)
