// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qwen35-reference-')));
try {
  const range = spawnSync(process.env.KAMINOS_PYTHON ?? 'python3', ['-c', `
import hashlib,importlib.util,pathlib,struct,sys
spec=importlib.util.spec_from_file_location("qwen_reference",sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
file=pathlib.Path(sys.argv[2])/"tensor.bin";payload=struct.pack("<56I",*range(56));file.write_bytes(b"header"+payload)
meta={"shape":[7,8],"dtype":"U32","data_offsets":[0,len(payload)]}
raw,selected,record=module.read_tensor_range(file,6,meta,2,3)
assert selected==[3,8],selected
assert record["sourceShape"]==[7,8],record
assert meta["shape"]==[7,8],meta
assert raw==payload[2*32:5*32]
assert record["rowStart"]==2 and record["rowCount"]==3
assert record["sha256"]==hashlib.sha256(raw).hexdigest()
source=module.reference_source(file.parent,b"{}",{}, {}, {"backend":"mlx-metal"})
assert "model" not in source and "revision" not in source,"caller-selected roots must not receive an asserted upstream identity"
assert source["localRoot"]==str(file.parent.resolve())
`, path.join(root, 'models/qwen3_5/export-kernel-reference.py'), temp], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(range.status, 0, range.stderr);
  for (const mode of ['missing', 'wrong-model', 'wrong-quantization']) {
    const model = path.join(temp, mode), report = path.join(temp, `${mode}.report.json`), output = path.join(temp, `${mode}.out`);
    if (mode !== 'missing') {
      fs.mkdirSync(model);
      fs.writeFileSync(path.join(model, 'config.json'), JSON.stringify({ model_type: mode === 'wrong-model' ? 'llama' : 'qwen3_5',
        quantization: { bits: mode === 'wrong-quantization' ? 8 : 4, group_size: 64, mode: 'affine' } }));
    }
    const result = spawnSync(process.env.KAMINOS_PYTHON ?? 'python3', [path.join(root, 'models/qwen3_5/export-kernel-reference.py'),
      '--model-dir', model, '--out', output, '--report', report], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const saved = JSON.parse(fs.readFileSync(report));
    assert.equal(saved.status, 'failed'); assert.equal(saved.phase, 'source-config');
    assert.equal(saved.requested.modelRoot, model);
    assert.ok(saved.error.includes(mode === 'missing' ? 'model root does not exist' : 'expected dense Qwen3.5'));
    assert.equal(fs.existsSync(path.join(output, 'meta.json')), false);
  }
  console.log('source rejection preserves a durable report before native import or primary output');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
