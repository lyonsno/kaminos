import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  extractPixal3dDualGridMesh,
  finishPixal3dMesh,
  encodePixal3dTexturePNG,
} from './pixal3d-mesh.js';
import {
  PIXAL3D_GENERATION_ROUTE,
  pixal3dGenerationFields,
  admitPixal3dRetainedGenerationCompletion,
  persistPixal3dGenerationAsset,
} from './generation-witness-checks.js';
import { NodeTrellisUVWorker } from '../trellis2/node-uv-worker.mjs';
import {
  createBrowserMeshPostprocess,
  MESH_POSTPROCESS_ROUTE,
} from '../trellis2/mesh-cleanup.js';
import { createWasmXatlasUnwrapper } from '../trellis2/wasm-xatlas.js';
import { gitSourceIdentity } from '../trellis2/source-attestation.mjs';
import {
  finishWithSourceMetal,
  METAL_REMESH_ROUTE,
} from '../trellis2/metal-remesh-finishing.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');

export const PYTHON_POSTPROCESS_SNIPPET = `
import argparse, ast, hashlib, importlib, inspect, json, sys, time, traceback
from importlib import metadata
from pathlib import Path
import numpy as np

p = argparse.ArgumentParser()
p.add_argument('--repo-root', required=True, type=Path)
p.add_argument('--source-root', required=True, type=Path)
p.add_argument('--expected-source-commit', required=True)
p.add_argument('--input', required=True, type=Path)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--target-faces', type=int, required=True)
p.add_argument('--keep-largest', action='store_true')
p.add_argument('--cleanup-mode', default='reference-cleanup')
args = p.parse_args()

sys.path.insert(0, str((args.repo_root / 'models/trellis2').resolve()))
from source_attestation import git_source_identity

ROUTES = {
    'reference-cleanup': 'Pixal3D-MLX/reference-cleanup/CPU-fast-simplification',
    'mlx-surface-preserving': 'Pixal3D-MLX/surface-preserving/CPU-fast-simplify-first',
}
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
report = {
    'schema': 'pixal3d.mesh-postprocess.v0',
    'status': 'running',
    'phase': 'source-admission',
    'requestedSource': {'root': str(args.source_root.resolve()), 'commit': args.expected_source_commit},
    'requestedMode': args.cleanup_mode,
    'requestedRoute': ROUTES.get(args.cleanup_mode),
    'effectiveRoute': None,
    'modelCalls': 0,
    'targetFaces': args.target_faces,
    'keepLargest': args.keep_largest,
    'events': [],
    'operationTrace': [],
}
started = time.perf_counter()
def digest(b): return hashlib.sha256(b).hexdigest()
def persist(): (out / 'report.json').write_text(json.dumps(report, indent=2) + '\\n')
def log(msg, **_):
    report['events'].append({'message': str(msg), 'elapsedSeconds': time.perf_counter() - started})
    persist()

persist()
try:
    if args.cleanup_mode not in ROUTES:
        raise ValueError('supported explicit cleanup mode required')
    root = args.source_root.resolve()
    observed = git_source_identity(root)
    if observed['commit'] != args.expected_source_commit or observed['dirty']:
        raise ValueError('exact clean postprocess source revision required')
    source_path = root / 'generate.py'
    source_bytes = source_path.read_bytes()
    module = ast.parse(source_bytes, filename=str(source_path))
    nodes = [n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == '_cleanup_and_simplify_mesh']
    if len(nodes) != 1:
        raise ValueError('one actual source cleanup function required')
    namespace = {'np': np, 'time': time}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source_path), 'exec'), namespace)
    cleanup_fn = namespace['_cleanup_and_simplify_mesh']
    sys.path.insert(0, str(root))
    cleanup_module = importlib.import_module('trellmlx.mesh_cleanup')
    if Path(cleanup_module.__file__).resolve() != (root / 'trellmlx/mesh_cleanup.py').resolve():
        raise ValueError('effective cleanup import differs from requested source')
    surface_default = inspect.signature(cleanup_module.cleanup_mesh).parameters.get(
        'preserve_surface_parts', inspect.Parameter('missing', inspect.Parameter.KEYWORD_ONLY)
    ).default is True
    report['source'] = {
        **observed,
        'root': str(root),
        'generateSha256': digest(source_bytes),
        'cleanupSha256': digest((root / 'trellmlx/mesh_cleanup.py').read_bytes()),
        'function': '_cleanup_and_simplify_mesh',
        'surfacePreservationDefault': surface_default,
    }
    preserving = args.cleanup_mode == 'mlx-surface-preserving'
    if preserving and not surface_default:
        raise ValueError('selected MLX cleanup source lacks default surface preservation')
    if args.target_faces < 1:
        raise ValueError('positive caller-selected simplification target required')
    report['phase'] = 'mesh-input-admission'
    persist()
    in_path = args.input.resolve()
    raw_manifest = in_path.read_bytes()
    manifest = json.loads(raw_manifest)
    if manifest.get('schema') not in ('pixal3d.raw-mesh-input.v0', 'trellis2.raw-mesh-input.v0'):
        raise ValueError('identified raw mesh input required')
    def read_arr(row, dtype, label):
        f = (in_path.parent / row['file']).resolve()
        s = row.get('shape')
        if not f.is_relative_to(in_path.parent) or row.get('dtype') != dtype or not isinstance(s, list) or len(s) != 2 or s[1] != 3 or s[0] < 1:
            raise ValueError('complete typed mesh descriptor required: ' + label)
        d = f.read_bytes()
        if len(d) != s[0] * 12 or len(d) != row.get('byteLength') or digest(d) != row.get('sha256'):
            raise ValueError('changed or partial mesh array: ' + label)
        return np.frombuffer(d, dtype='<f4' if dtype == 'float32' else '<u4').reshape(s).copy()
    vertices = read_arr(manifest['vertices'], 'float32', 'vertices')
    faces = read_arr(manifest['triangles'], 'uint32', 'triangles')
    if not np.isfinite(vertices).all() or faces.max() >= len(vertices):
        raise ValueError('finite complete indexed input surface required')
    report.update(
        inputManifestSha256=digest(raw_manifest),
        inputVertices=len(vertices),
        inputFaces=len(faces),
        effectiveRoute=ROUTES[args.cleanup_mode],
        phase='source-mesh-cleanup',
    )
    persist()
    sig_params = inspect.signature(cleanup_fn).parameters
    if 'reference_cleanup' in sig_params:
        vertices, faces = cleanup_fn(
            vertices, faces,
            target_faces=args.target_faces,
            no_cleanup=False,
            keep_largest=args.keep_largest,
            reference_cleanup=not preserving,
            qem_simplify=False,
            simplify_first=preserving,
            operation_trace=report['operationTrace'],
            log=log,
        )
    else:
        filter_state = {'applied': False}
        def custom_cleanup(v, f, **kw):
            if filter_state['applied']:
                kw['min_component_area'] = 0
                kw['keep_largest'] = False
            kw['preserve_surface_parts'] = preserving
            res = cleanup_module.cleanup_mesh(v, f, **kw)
            filter_state['applied'] = True
            return res
        vertices, faces = cleanup_fn(
            vertices, faces,
            target_faces=args.target_faces,
            no_cleanup=False,
            keep_largest=args.keep_largest,
            cleanup_mesh=custom_cleanup,
            log=log,
        )
        if not preserving:
            vertices, faces = cleanup_module.orient_faces_by_adjacency(vertices, faces, verbose=False)
    if len(vertices) < 1 or len(faces) < 1 or not np.isfinite(vertices).all() or faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError('source finalizer produced no finite complete surface')
    vertices = np.ascontiguousarray(vertices, dtype='<f4')
    faces = np.ascontiguousarray(faces, dtype='<u4')
    def write_arr(name, vals, dt):
        d = vals.tobytes()
        (out / name).write_bytes(d)
        return {'file': name, 'shape': list(vals.shape), 'dtype': dt, 'byteLength': len(d), 'sha256': digest(d)}
    report['arrays'] = {
        'vertices': write_arr('vertices.f32', vertices, 'float32'),
        'triangles': write_arr('triangles.u32', faces, 'uint32'),
    }
    report.update(outputVertices=len(vertices), outputFaces=len(faces), status='succeeded', phase=None)
except Exception as err:
    report.update(status='failed', error={'name': type(err).__name__, 'message': str(err), 'traceback': traceback.format_exc()})
finally:
    report['elapsedSeconds'] = time.perf_counter() - started
    persist()
sys.exit(0 if report['status'] == 'succeeded' else 1)
`;

export const PYTHON_UNWRAP_SNIPPET = `
import argparse, ast, hashlib, importlib.metadata, inspect, json, sys, time, traceback
from pathlib import Path
import numpy as np

p = argparse.ArgumentParser()
p.add_argument('--repo-root', required=True, type=Path)
p.add_argument('--source-root', required=True, type=Path)
p.add_argument('--expected-source-commit', required=True)
p.add_argument('--clean-root', required=True, type=Path)
p.add_argument('--out', required=True, type=Path)
a = p.parse_args()

sys.path.insert(0, str((a.repo_root / 'models/trellis2').resolve()))
from source_attestation import git_source_identity

source = a.source_root.resolve()
clean = a.clean_root.resolve()
out = a.out.resolve()
out.mkdir(parents=True, exist_ok=True)
report = {
    'schema': 'pixal3d.source-atlas.v0',
    'status': 'running',
    'phase': 'source-admission',
    'modelCalls': 0,
    'route': 'Pixal3D-MLX uv_unwrap/xatlas; winding repair disabled',
}
started = time.perf_counter()
def h(b): return hashlib.sha256(b).hexdigest()
def persist(): (out / 'report.json').write_text(json.dumps(report, indent=2) + '\\n')
persist()
try:
    source_identity = git_source_identity(source)
    if source_identity['commit'] != a.expected_source_commit or source_identity['dirty']:
        raise ValueError('exact clean unwrap source required')
    script = source / 'trellmlx/texture_bake.py'
    raw = script.read_bytes()
    report['source'] = {'root': str(source), **source_identity, 'moduleSha256': h(raw)}
    tree = ast.parse(raw)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'uv_unwrap')
    namespace = {'np': np}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(script), 'exec'), namespace)
    uv_unwrap_fn = namespace['uv_unwrap']
    clean_raw = (clean / 'report.json').read_bytes()
    m = json.loads(clean_raw)
    if m.get('status') != 'succeeded':
        raise ValueError('complete cleaned mesh required')
    report['cleanReportSha256'] = h(clean_raw)
    def read_arr(name, dt):
        row = m['arrays'][name]
        f = clean / row['file']
        if not f.resolve().is_relative_to(clean):
            raise ValueError('cleaned array outside input root')
        d = f.read_bytes()
        if h(d) != row['sha256'] or len(d) != row['byteLength']:
            raise ValueError('changed cleaned mesh')
        return np.frombuffer(d, dtype=dt).reshape(row['shape'])
    vertices = read_arr('vertices', '<f4')
    faces = read_arr('triangles', '<u4')
    report['phase'] = 'source-xatlas'
    persist()
    if 'fix_winding' in inspect.signature(uv_unwrap_fn).parameters:
        v, f, uv, mapping = uv_unwrap_fn(vertices, faces, fix_winding=False)
    else:
        v, f, uv, mapping = uv_unwrap_fn(vertices, faces)
    if not np.array_equal(v[f], vertices[faces]):
        raise ValueError('xatlas changed ordered triangle positions')
    if not np.isfinite(uv).all() or uv.min() < 0 or uv.max() > 1:
        raise ValueError('finite bounded source UV required')
    report['phase'] = 'source-post-uv-normals'
    persist()
    import trimesh
    export_verts = v.copy()
    export_verts[:, 1], export_verts[:, 2] = v[:, 2].copy(), -v[:, 1].copy()
    tmesh = trimesh.Trimesh(vertices=export_verts, faces=f, process=False)
    world_normals = np.asarray(tmesh.vertex_normals)
    if world_normals.shape != v.shape or not np.isfinite(world_normals).all():
        raise ValueError('complete finite source post-UV normals required')
    normals = world_normals.copy()
    normals[:, 1], normals[:, 2] = -world_normals[:, 2], world_normals[:, 1]
    report['normalBasis'] = {
        'rule': 'source-resume-export/Trimesh-post-UV',
        'frame': 'model-local',
        'trimeshVersion': importlib.metadata.version('trimesh'),
        'zeroNormals': int(np.count_nonzero(np.linalg.norm(normals, axis=1) == 0)),
    }
    arrays = {}
    for name, vals, dt in [('vertices', v, '<f4'), ('triangles', f, '<u4'), ('uvs', uv, '<f4'), ('normals', normals, '<f4')]:
        vals = np.ascontiguousarray(vals, dtype=dt)
        d = vals.tobytes()
        fname = name + '.bin'
        (out / fname).write_bytes(d)
        arrays[name] = {'file': fname, 'shape': list(vals.shape), 'byteLength': len(d), 'sha256': h(d)}
    report.update(
        status='succeeded',
        phase=None,
        arrays=arrays,
        completeTrianglePositionsUnchanged=True,
        xatlasVersion=importlib.metadata.version('xatlas'),
        maxIterations=0,
        fixWinding=False,
        inputVertices=len(vertices),
        outputVertices=len(v),
        faces=len(f),
    )
except Exception as err:
    report.update(status='failed', error={'message': str(err), 'traceback': traceback.format_exc()})
finally:
    report['elapsedSeconds'] = time.perf_counter() - started
    persist()
sys.exit(0 if report['status'] == 'succeeded' else 1)
`;

function createPixal3dSourceAtlasUnwrapper({
  python,
  repoRoot,
  sourceRoot,
  expectedSourceCommit,
  cleanRoot,
  out,
}) {
  return async mesh => {
    await fs.mkdir(out, { recursive: true });
    const args = [
      '-B',
      '-c',
      PYTHON_UNWRAP_SNIPPET,
      '--repo-root',
      repoRoot,
      '--source-root',
      sourceRoot,
      '--expected-source-commit',
      expectedSourceCommit,
      '--clean-root',
      cleanRoot,
      '--out',
      out,
    ];
    const stdout = await fs.open(path.join(out, 'stdout.log'), 'w');
    const stderr = await fs.open(path.join(out, 'stderr.log'), 'w');
    let code;
    try {
      const child = spawn(python, args, {
        stdio: ['ignore', stdout.fd, stderr.fd],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
      code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
    } finally {
      await stdout.close();
      await stderr.close();
    }
    const stderrText = (await fs.readFile(path.join(out, 'stderr.log'), 'utf8').catch(() => '')).trim();
    let raw;
    try {
      raw = await fs.readFile(path.join(out, 'report.json'));
    } catch (error) {
      throw new Error(
        `identified source atlas exited before writing report.json (code=${code}): ${stderrText || error.message}`,
      );
    }
    const r = JSON.parse(raw);
    const clean = await fs.readFile(path.join(cleanRoot, 'report.json'));
    if (
      code !== 0 ||
      r.status !== 'succeeded' ||
      r.source?.commit !== expectedSourceCommit ||
      r.source.dirty ||
      r.cleanReportSha256 !== hash(clean) ||
      r.completeTrianglePositionsUnchanged !== true ||
      r.fixWinding !== false
    ) {
      throw new Error(
        'identified source atlas failed: ' + (r.error?.message ?? stderrText ?? r.status),
      );
    }
    const readArr = async (row, Type) => {
      const bytes = await fs.readFile(path.join(out, row.file));
      if (bytes.length !== row.byteLength || bytes.length % 4 || hash(bytes) !== row.sha256) {
        throw new Error('changed atlas array ' + row.file);
      }
      return new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    };
    const sv = await readArr(r.arrays.vertices, Float32Array);
    const sf = await readArr(r.arrays.triangles, Uint32Array);
    const su = await readArr(r.arrays.uvs, Float32Array);
    const sn = await readArr(r.arrays.normals, Float32Array);
    if (
      sf.length !== mesh.triangles.length ||
      su.length !== (sv.length / 3) * 2 ||
      !sf.every(i => i < sv.length / 3) ||
      !su.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
      sn.length !== sv.length ||
      !sn.every(Number.isFinite)
    ) {
      throw new Error('complete finite source-atlas surface required');
    }
    const vertices = new Float32Array(sf.length * 3);
    const normals = new Float32Array(sf.length * 3);
    const uvs = new Float32Array(sf.length * 2);
    const triangles = new Uint32Array(sf.length);
    for (let i = 0; i < sf.length; i++) {
      triangles[i] = i;
      for (let a = 0; a < 3; a++) {
        const value = sv[sf[i] * 3 + a];
        if (value !== mesh.vertices[mesh.triangles[i] * 3 + a]) {
          throw new Error('source atlas changed ordered geometry');
        }
        vertices[i * 3 + a] = value;
        normals[i * 3 + a] = sn[sf[i] * 3 + a];
      }
      uvs[i * 2] = su[sf[i] * 2] * 0.9;
      uvs[i * 2 + 1] = su[sf[i] * 2 + 1];
    }
    const collapsed = [];
    for (let face = 0; face < sf.length / 3; face++) {
      const a = face * 6;
      const b = a + 2;
      const c = a + 4;
      if (
        (uvs[b] - uvs[a]) * (uvs[c + 1] - uvs[a + 1]) -
          (uvs[b + 1] - uvs[a + 1]) * (uvs[c] - uvs[a]) ===
        0
      ) {
        collapsed.push(face);
      }
    }
    const cols = collapsed.length ? Math.ceil(Math.sqrt(collapsed.length * 0.1)) : 0;
    const rows = cols ? Math.ceil(collapsed.length / cols) : 0;
    for (let i = 0; i < collapsed.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const u0 = 0.9 + (0.1 * (col + 0.1)) / cols;
      const u1 = 0.9 + (0.1 * (col + 0.9)) / cols;
      const v0 = (row + 0.1) / rows;
      const v1 = (row + 0.9) / rows;
      uvs.set([u0, v0, u1, v0, u0, v1], collapsed[i] * 6);
    }
    return {
      vertices,
      triangles,
      normals,
      uvs,
      metadata: mesh.metadata,
      uvMetadata: {
        route: 'source xatlas + explicit isolated charts for collapsed atlas faces',
        source: r.source,
        sourceReportSha256: hash(raw),
        normalBasis: r.normalBasis,
        xatlasVersion: r.xatlasVersion,
        fixWinding: false,
        maxIterations: 0,
        reservedStripFraction: 0.1,
        repairedFaces: collapsed.length,
        grid: [cols, rows],
        orderedTrianglePositionsUnchanged: true,
        deindexedForIndependentFaceUV: true,
      },
    };
  };
}

export async function finalizePixal3dRetainedGeneration(rawArgv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: rawArgv,
    options: {
      ...Object.fromEntries(
        [
          'output',
          'receiver',
          'cleanup-mode',
          'uv-backend',
          'repo-root',
          'expected-commit',
          'input-root',
          'expected-native-commit',
          'input-mode',
          'target-faces',
          'python',
          'source-root',
          'expected-source-commit',
          'texture-size',
          'metal-backend-manifest',
          'metal-python-path',
          'remesh-band',
          'remesh-project-back',
        ].map(k => [k, { type: 'string' }]),
      ),
      'keep-largest': { type: 'boolean', default: false },
      'skip-clean-check': { type: 'boolean', default: false },
    },
  });

  if (!values.output) throw new Error('explicit persistent --output GLB required');
  const outputPath = path.resolve(values.output);
  const out = path.dirname(outputPath);
  const reportPath = path.join(out, 'report.json');
  const report = {
    schema: 'pixal3d.retained-generation-finishing.v0',
    status: 'running',
    phase: 'argument-admission',
    receiver: values.receiver,
    command: [process.execPath, fileURLToPath(import.meta.url), ...rawArgv],
    modelCalls: 0,
    route: 'retained native WebGPU fields / CPU reference-order finishing / unchanged UV and learned PBR',
    startedAt: new Date().toISOString(),
  };
  await fs.mkdir(out, { recursive: true });
  const persist = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const enter = async phase => {
    report.phase = phase;
    await persist();
  };
  const readTyped = async (file, row, Type, dtype) => {
    const data = await fs.readFile(file);
    if (
      row.dtype !== dtype ||
      data.byteLength !== row.byteLength ||
      data.byteLength % 4 ||
      hash(data) !== row.sha256
    ) {
      throw new Error('complete unchanged ' + dtype + ' artifact required: ' + file);
    }
    return new Type(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  };
  await persist();

  try {
    const cleanupMode = values['cleanup-mode'] ?? 'reference-cleanup';
    const uvBackend = values['uv-backend'] ?? 'sf3d';
    const needsPython =
      cleanupMode !== 'browser-mlx-surface-preserving' || uvBackend === 'source-xatlas';
    for (const key of [
      'repo-root',
      'expected-commit',
      'input-root',
      'expected-native-commit',
      'target-faces',
      'receiver',
      ...(needsPython ? ['python', 'source-root', 'expected-source-commit'] : []),
    ]) {
      if (!values[key]) throw new Error('explicit --' + key + ' required');
    }
    const root = path.resolve(values['repo-root']);
    const native = path.resolve(values['input-root']);
    const script = fileURLToPath(import.meta.url);
    if (script !== path.join(root, 'models/pixal3d/finalize-retained-generation.mjs')) {
      throw new Error('effective runner root differs from requested repo root');
    }
    report.repoRoot = root;
    report.inputRoot = native;
    report.sourceAttestation = gitSourceIdentity(root);
    report.commit = report.sourceAttestation.commit;
    report.dirty = report.sourceAttestation.dirty;
    if (
      report.commit !== values['expected-commit'] ||
      (report.dirty && !values['skip-clean-check'])
    ) {
      throw new Error('exact clean finishing source required');
    }
    const targetFaces = Number(values['target-faces']);
    if (!Number.isSafeInteger(targetFaces) || targetFaces < 1) {
      throw new Error('positive caller-selected face target required');
    }
    const cleanupRoutes = {
      'reference-cleanup': 'Pixal3D-MLX/reference-cleanup/CPU-fast-simplification',
      'mlx-surface-preserving': 'Pixal3D-MLX/surface-preserving/CPU-fast-simplify-first',
      'source-metal-remesh': METAL_REMESH_ROUTE,
      'browser-mlx-surface-preserving': MESH_POSTPROCESS_ROUTE,
    };
    if (!Object.hasOwn(cleanupRoutes, cleanupMode)) {
      throw new Error('supported explicit cleanup mode required');
    }
    report.cleanupMode = cleanupMode;
    report.route =
      'retained native WebGPU fields / ' +
      cleanupRoutes[cleanupMode] +
      ' / unchanged UV and learned PBR';
    if (!['sf3d', 'source-xatlas', 'browser-xatlas'].includes(uvBackend)) {
      throw new Error('explicit supported UV backend required');
    }
    report.requestedUVBackend = uvBackend;

    await enter('native-field-admission');
    const rawReport = await fs.readFile(path.join(native, 'report.json'));
    const n = JSON.parse(rawReport);
    const fixture = await fs.readFile(path.join(n.fixtureRoot, 'manifest.json'));
    if (hash(fixture) !== n.fixtureSha256) {
      throw new Error('unchanged complete native input manifest required');
    }
    const manifest = JSON.parse(fixture);
    const admission = admitPixal3dRetainedGenerationCompletion(n, manifest, {
      expectedNativeCommit: values['expected-native-commit'],
      inputMode: values['input-mode'] ?? 'completed-command',
    });
    report.retainedAdmission = admission;
    if (admission.inputMode === 'completed-model-fields') {
      for (const name of [
        'models/trellis2/dinov3-serving.js',
        'models/pixal3d/pixal3d-generation.js',
        'models/pixal3d/generation-inputs.js',
        'models/pixal3d/naf.js',
        'models/pixal3d/proj-grid.js',
        'models/pixal3d/pixal3d-block.js',
        'models/pixal3d/pixal3d-flow.js',
        'models/pixal3d/pixal3d-generation-witness.js',
        'models/trellis2/slat-decoder.js',
        'webgpu-inference-kit/src/inference-runtime.js',
      ]) {
        const committed = execFileSync('git', ['show', `${n.commit}:${name}`], { cwd: root });
        if (n.servedSources?.[name] !== hash(committed)) {
          throw new Error('exact committed served-source required ' + name);
        }
      }
      report.checkedRetainedFields = [];
      for (const name of pixal3dGenerationFields(manifest)) {
        const row = n.rawOutputs[name];
        const file = path.join(native, 'raw', name + '.' + row.dtype);
        if (path.resolve(row.path) !== file) {
          throw new Error('effective retained field path mismatch: ' + name);
        }
        const bytes = await fs.readFile(file);
        if (bytes.length !== row.byteLength || hash(bytes) !== row.sha256) {
          throw new Error('complete unchanged retained field bytes required ' + name);
        }
        report.checkedRetainedFields.push({
          name,
          path: file,
          sha256: row.sha256,
          byteLength: row.byteLength,
        });
      }
    }
    report.nativeSessionId = n.nativeSessionId;
    report.fixtureSha256 = n.fixtureSha256;
    report.native = {
      ...admission,
      reportSha256: hash(rawReport),
      commit: n.commit,
      sessionId: n.nativeSessionId,
      inputManifestSha256: n.fixtureSha256,
      backend: n.result.backend,
      comparison: n.result.comparison,
    };

    const fields = {};
    for (const [key, Type, dtype] of [
      ['geometry.features', Float32Array, 'f32'],
      ['geometry.coordinates', Int32Array, 'i32'],
      ['material.features', Float32Array, 'f32'],
      ['material.coordinates', Int32Array, 'i32'],
    ]) {
      const row = n.rawOutputs?.[key];
      const observed = n.result.outputs[key];
      if (!row) throw new Error('complete retained field required: ' + key);
      if (
        row.sha256 !== observed.sha256 ||
        row.byteLength !== observed.byteLength ||
        row.dtype !== observed.dtype
      ) {
        throw new Error('conflicting retained field receipt: ' + key);
      }
      const file = path.join(native, 'raw', key + '.' + dtype);
      if (path.resolve(row.path) !== file) {
        throw new Error('effective retained field path mismatch: ' + key);
      }
      fields[key] = await readTyped(file, row, Type, dtype);
    }

    const rows = fields['geometry.coordinates'].length / 3;
    if (
      !Number.isSafeInteger(rows) ||
      rows < 1 ||
      fields['geometry.features'].length !== rows * 7 ||
      fields['material.features'].length !== rows * 6 ||
      fields['material.coordinates'].length !== rows * 3 ||
      n.result.composition?.geometryResolution !== n.result.composition?.materialResolution
    ) {
      throw new Error('complete guided geometry/material dimensions required');
    }
    report.fields = Object.fromEntries(Object.keys(fields).map(key => [key, n.rawOutputs[key]]));

    await enter('retained-mesh-extraction');
    const mesh = extractPixal3dDualGridMesh({
      features: fields['geometry.features'],
      coordinates: fields['geometry.coordinates'],
      resolution: n.result.composition.geometryResolution,
    });
    if (mesh.status !== 'surface') throw new Error('retained geometry has no surface');
    report.rawMesh = {
      vertices: mesh.vertices.length / 3,
      faces: mesh.triangles.length / 3,
      metadata: mesh.metadata,
    };

    const inputDir = path.join(out, 'raw-mesh');
    await fs.mkdir(inputDir, { recursive: true });
    const writeRow = async (name, vals, dtype) => {
      const data = new Uint8Array(vals.buffer, vals.byteOffset, vals.byteLength);
      await fs.writeFile(path.join(inputDir, name), data);
      return {
        file: name,
        dtype,
        shape: [vals.length / 3, 3],
        byteLength: data.length,
        sha256: hash(data),
      };
    };
    const inputManifest = {
      schema: 'pixal3d.raw-mesh-input.v0',
      native: report.native,
      vertices: await writeRow('vertices.f32', mesh.vertices, 'float32'),
      triangles: await writeRow('triangles.u32', mesh.triangles, 'uint32'),
    };
    const inputBytes = JSON.stringify(inputManifest, null, 2) + '\n';
    await fs.writeFile(path.join(inputDir, 'manifest.json'), inputBytes);
    report.rawMesh.inputManifestSha256 = hash(inputBytes);

    if (cleanupMode === 'source-metal-remesh') {
      const textureSize = Number(values['texture-size']);
      if (!Number.isSafeInteger(textureSize) || textureSize < 1) {
        throw new Error('positive Metal texture size required');
      }
      await enter('source-metal-remesh');
      const original = await finishWithSourceMetal({
        root,
        sourceRoot: path.resolve(values['source-root']),
        sourceCommit: values['expected-source-commit'],
        python: path.resolve(values.python),
        backendManifest: values['metal-backend-manifest'],
        pythonPath: JSON.parse(values['metal-python-path'] ?? 'null'),
        band: Number(values['remesh-band']),
        projectBack: Number(values['remesh-project-back']),
        meshInput: path.join(inputDir, 'manifest.json'),
        materialInput: {
          root: path.join(native, 'raw'),
          resolution: n.result.composition.materialResolution,
          features: { ...n.rawOutputs['material.features'], file: 'material.features.f32' },
          coordinates: { ...n.rawOutputs['material.coordinates'], file: 'material.coordinates.i32' },
        },
        gridSize: n.result.composition.geometryResolution,
        targetFaces,
        textureSize,
        outputDir: path.join(out, 'source-metal-remesh'),
        provenance: {
          nativeCommit: n.commit,
          sessionId: n.nativeSessionId,
          inputManifestSha256: n.fixtureSha256,
          route: PIXAL3D_GENERATION_ROUTE,
          finishingRoute: METAL_REMESH_ROUTE,
          sourceCommit: values['expected-source-commit'],
        },
        record: report,
        persist,
      });
      report.meshPostprocess = {
        effectiveRoute: METAL_REMESH_ROUTE,
        source: original.receipt.source,
        inputFaces: report.rawMesh.faces,
        outputFaces: original.receipt.finishing.output.faces,
      };
      report.uv = {
        backend: 'source-Metal-xatlas',
        reportPath: path.join(out, 'source-metal-remesh', 'finishing', 'report.json'),
      };
      report.texture = {
        width: textureSize,
        height: textureSize,
        route: 'source-Metal-original-surface-bake',
      };
      await enter('finished-asset-admission');
      await persistPixal3dGenerationAsset({
        report,
        bytes: original.bytes,
        outputPath,
        write: (file, data) => fs.writeFile(file, data),
        persist,
      });
    } else {
      const cleanupDir = path.join(out, 'mesh-postprocess');
      await fs.mkdir(cleanupDir, { recursive: true });
      const browserPostprocess =
        cleanupMode === 'browser-mlx-surface-preserving'
          ? createBrowserMeshPostprocess({
              targetFaces,
              keepLargest: Boolean(values['keep-largest']),
            })
          : null;
      const postprocessMesh = browserPostprocess
        ? async input => {
            const processed = await browserPostprocess(input);
            const r = processed.metadata.postprocess;
            if (
              r.effectiveRoute !== cleanupRoutes[cleanupMode] ||
              r.inputManifestSha256 !== undefined
            ) {
              throw new Error('unexpected browser finisher receipt');
            }
            const writeCleanRow = async (name, vals, dtype) => {
              const data = new Uint8Array(vals.buffer, vals.byteOffset, vals.byteLength);
              await fs.writeFile(path.join(cleanupDir, name), data);
              return {
                file: name,
                dtype,
                shape: [vals.length / 3, 3],
                byteLength: data.length,
                sha256: hash(data),
              };
            };
            report.meshPostprocess = {
              ...r,
              inputManifestSha256: hash(inputBytes),
              arrays: {
                vertices: await writeCleanRow('vertices.f32', processed.vertices, 'float32'),
                triangles: await writeCleanRow('triangles.u32', processed.triangles, 'uint32'),
              },
            };
            await fs.writeFile(
              path.join(cleanupDir, 'report.json'),
              JSON.stringify(report.meshPostprocess, null, 2) + '\n',
            );
            await persist();
            return processed;
          }
        : async input => {
            const command = [
              '-B',
              '-c',
              PYTHON_POSTPROCESS_SNIPPET,
              '--repo-root',
              root,
              '--source-root',
              path.resolve(values['source-root']),
              '--expected-source-commit',
              values['expected-source-commit'],
              '--input',
              path.join(inputDir, 'manifest.json'),
              '--output',
              cleanupDir,
              '--target-faces',
              String(targetFaces),
              '--cleanup-mode',
              cleanupMode,
            ];
            if (values['keep-largest']) command.push('--keep-largest');
            report.postprocessCommand = {
              python: path.resolve(values.python),
              argv: command,
            };
            await persist();
            const stdout = await fs.open(path.join(cleanupDir, 'stdout.log'), 'w');
            const stderr = await fs.open(path.join(cleanupDir, 'stderr.log'), 'w');
            try {
              const child = spawn(report.postprocessCommand.python, command, {
                cwd: root,
                env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
                stdio: ['ignore', stdout.fd, stderr.fd],
              });
              const code = await new Promise((resolve, reject) => {
                child.once('error', reject);
                child.once('exit', (code, signal) => {
                  report.postprocessExit = { code, signal, pid: child.pid };
                  resolve(code);
                });
              });
              const stderrText = (
                await fs.readFile(path.join(cleanupDir, 'stderr.log'), 'utf8').catch(() => '')
              ).trim();
              if (stderrText) report.postprocessStderr = stderrText;
              let raw;
              try {
                raw = await fs.readFile(path.join(cleanupDir, 'report.json'));
              } catch (error) {
                throw new Error(
                  `requested source finishing exited before writing report.json (code=${code}): ${stderrText || error.message}`,
                );
              }
              const r = JSON.parse(raw);
              report.postprocessReport = {
                path: path.join(cleanupDir, 'report.json'),
                sha256: hash(raw),
                status: r.status,
                phase: r.phase,
              };
              if (
                code !== 0 ||
                r.status !== 'succeeded' ||
                r.modelCalls !== 0 ||
                r.requestedMode !== cleanupMode ||
                r.effectiveRoute !== cleanupRoutes[cleanupMode] ||
                r.source?.commit !== values['expected-source-commit'] ||
                r.source.dirty ||
                r.inputManifestSha256 !== hash(inputBytes) ||
                r.targetFaces !== targetFaces
              ) {
                throw new Error(
                  'requested source finishing failed: ' +
                    (r.error?.message ?? (stderrText || r.status)),
                );
              }
              const vertices = await readTyped(
                path.join(cleanupDir, r.arrays.vertices.file),
                r.arrays.vertices,
                Float32Array,
                'float32',
              );
              const triangles = await readTyped(
                path.join(cleanupDir, r.arrays.triangles.file),
                r.arrays.triangles,
                Uint32Array,
                'uint32',
              );
              report.meshPostprocess = r;
              await persist();
              return {
                ...input,
                vertices,
                triangles,
                metadata: { ...input.metadata, postprocess: r },
              };
            } finally {
              await stdout.close();
              await stderr.close();
            }
          };

      const unwrapMesh =
        uvBackend === 'browser-xatlas'
          ? createWasmXatlasUnwrapper()
          : uvBackend === 'source-xatlas'
            ? createPixal3dSourceAtlasUnwrapper({
                python: path.resolve(values.python),
                repoRoot: root,
                sourceRoot: path.resolve(values['source-root']),
                expectedSourceCommit: values['expected-source-commit'],
                cleanRoot: cleanupDir,
                out: path.join(out, 'source-atlas'),
              })
            : undefined;

      const finished = await finishPixal3dMesh(mesh, {
        postprocessMesh,
        WorkerClass: NodeTrellisUVWorker,
        unwrapMesh,
        textureSize: 1024,
        materialFields: {
          features: fields['material.features'],
          coordinates: fields['material.coordinates'],
          resolution: n.result.composition.materialResolution,
        },
        provenance: {
          nativeCommit: n.commit,
          sessionId: n.nativeSessionId,
          nativeReportSha256: report.native.reportSha256,
          inputManifestSha256: n.fixtureSha256,
          postprocessCommit: report.commit,
          comparison: n.result.comparison,
          route: PIXAL3D_GENERATION_ROUTE,
          input: 'retained complete WebGPU fields / explicit CPU finalizer; no inference',
        },
        onPhase: e => enter(e.phase),
      });
      report.uv = finished.mesh.uvMetadata;
      report.texture = {
        width: finished.textures.width,
        height: finished.textures.height,
        coveredPixels: finished.textures.coveredPixels,
        metadata: finished.textures.metadata,
      };
      await enter('finished-asset-admission');
      const bytes = new Uint8Array(finished.glb);
      await persistPixal3dGenerationAsset({
        report,
        bytes,
        outputPath,
        write: (file, data) => fs.writeFile(file, data),
        persist,
      });
      for (const [name, pixels] of [
        ['base-color', finished.textures.baseColor],
        ['metallic-roughness', finished.textures.metallicRoughness],
      ]) {
        await fs.writeFile(
          path.join(out, name + '.png'),
          new Uint8Array(await encodePixal3dTexturePNG({ pixels, width: 1024, height: 1024 })),
        );
      }
    }
    report.status = 'succeeded';
    report.phase = null;
  } catch (error) {
    report.status = 'failed';
    report.error = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await persist();
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await finalizePixal3dRetainedGeneration(process.argv.slice(2));
  console.log(
    JSON.stringify({
      status: report.status,
      phase: report.phase,
      error: report.error,
      rawMesh: report.rawMesh,
      cleanedFaces: report.meshPostprocess?.outputFaces,
      asset: report.assetArtifact,
      report: path.join(path.dirname(path.resolve(process.argv[process.argv.indexOf('--output') + 1])), 'report.json'),
    }),
  );
}
