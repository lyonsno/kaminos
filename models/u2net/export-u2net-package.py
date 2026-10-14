"""Convert rembg's u2net.onnx into a browser package: a flat op list with
static shapes (the ONNX Shape/Gather/Slice size machinery folds away at the
fixed 1x3x320x320 input) and one little-endian F32 weight file.

python models/u2net/export-u2net-package.py --onnx ~/.u2net/u2net.onnx --out <dir>
    [--reference-input <f32 NCHW file> --reference-out <dir>]

Shapes are taken from an actual onnxruntime CPU run with every intermediate
exposed, so the package records what the model computes, not inferred guesses.
"""
import argparse, hashlib, json, os
import numpy as np, onnx, onnxruntime as ort
from onnx import numpy_helper, helper

ap = argparse.ArgumentParser()
ap.add_argument('--onnx', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--reference-input'); ap.add_argument('--reference-out')
a = ap.parse_args()
raw = open(os.path.expanduser(a.onnx), 'rb').read()
model = onnx.load_from_string(raw); g = model.graph
inits = {t.name: numpy_helper.to_array(t) for t in g.initializer}
consts = {}
for n in g.node:
    if n.op_type == 'Constant':
        consts[n.output[0]] = numpy_helper.to_array(n.attribute[0].t)

# Expose every intermediate and run once to learn concrete shapes.
probe = onnx.shape_inference.infer_shapes(onnx.load_from_string(raw))
types = {v.name: v.type.tensor_type.elem_type for v in probe.graph.value_info}
known = {o.name for o in probe.graph.output}
for n in probe.graph.node:
    for o in n.output:
        if o and o not in known:
            probe.graph.output.append(helper.make_tensor_value_info(o, types.get(o) or onnx.TensorProto.FLOAT, None)); known.add(o)
sess = ort.InferenceSession(probe.SerializeToString(), providers=['CPUExecutionProvider'])
x = (np.fromfile(a.reference_input, '<f4').reshape(1, 3, 320, 320) if a.reference_input
     else np.random.default_rng(0).standard_normal((1, 3, 320, 320)).astype(np.float32))
names = [o.name for o in sess.get_outputs()]
values = dict(zip(names, sess.run(names, {g.input[0].name: x})))
values[g.input[0].name] = x
shape = lambda name: list(values[name].shape)

attrs = lambda n: {t.name: helper.get_attribute_value(t) for t in n.attribute}
consumers = {}
for n in g.node:
    for i in n.input: consumers.setdefault(i, []).append(n)
weights = bytearray(); ops = []
def put(arr):
    off = len(weights) // 4; weights.extend(np.ascontiguousarray(arr, '<f4').tobytes()); return off
fused = set()
for n in g.node:
    t = n.op_type
    if t in ('Constant', 'Shape', 'Gather', 'Unsqueeze', 'Slice', 'Cast') or n.output[0] in fused:
        continue
    if t == 'Concat' and len(values.get(n.output[0], np.zeros(0)).shape) != 4:
        continue  # size-vector concat feeding Resize
    if t == 'Conv':
        w = inits[n.input[1]]; b = inits[n.input[2]]; at = attrs(n); out = n.output[0]
        relu = [c for c in consumers.get(out, []) if c.op_type == 'Relu']
        if len(consumers.get(out, [])) == 1 and relu:
            fused.add(relu[0].output[0]); out = relu[0].output[0]
        assert at.get('group', 1) == 1 and list(at['strides']) == [1, 1]
        ops.append({'op': 'conv', 'input': n.input[0], 'output': out, 'outShape': shape(out), 'inShape': shape(n.input[0]),
                    'kernel': int(w.shape[2]), 'dilation': int(at['dilations'][0]), 'pad': int(at['pads'][0]),
                    'relu': bool(relu and len(consumers[n.output[0]]) == 1), 'weight': put(w), 'bias': put(b)})
    elif t == 'Relu':
        ops.append({'op': 'relu', 'input': n.input[0], 'output': n.output[0], 'outShape': shape(n.output[0])})
    elif t == 'MaxPool':
        at = attrs(n); assert list(at['kernel_shape']) == [2, 2] and at.get('ceil_mode') == 1
        ops.append({'op': 'maxpool', 'input': n.input[0], 'output': n.output[0], 'inShape': shape(n.input[0]), 'outShape': shape(n.output[0])})
    elif t == 'Resize':
        at = attrs(n); assert at['mode'] == b'linear' and at['coordinate_transformation_mode'] == b'pytorch_half_pixel'
        ops.append({'op': 'resize', 'input': n.input[0], 'output': n.output[0], 'inShape': shape(n.input[0]), 'outShape': shape(n.output[0])})
    elif t == 'Concat':
        assert attrs(n)['axis'] == 1
        ops.append({'op': 'concat', 'inputs': list(n.input), 'output': n.output[0], 'outShape': shape(n.output[0])})
    elif t in ('Add', 'Sigmoid'):
        ops.append({'op': t.lower(), 'inputs': list(n.input), 'output': n.output[0], 'outShape': shape(n.output[0])})
    else:
        raise SystemExit('unsupported op ' + t)

os.makedirs(a.out, exist_ok=True)
open(os.path.join(a.out, 'weights.f32'), 'wb').write(weights)
package = {'schema': 'kaminos.u2net-package.v0', 'source': {'file': os.path.basename(a.onnx), 'sha256': hashlib.sha256(raw).hexdigest(),
           'onnxruntime': ort.__version__, 'onnx': onnx.__version__},
           'input': {'name': g.input[0].name, 'shape': [1, 3, 320, 320]}, 'output': g.output[0].name,
           'weights': {'file': 'weights.f32', 'floats': len(weights) // 4, 'sha256': hashlib.sha256(weights).hexdigest()}, 'ops': ops}
json.dump(package, open(os.path.join(a.out, 'graph.json'), 'w'), indent=0)
if a.reference_out:
    os.makedirs(a.reference_out, exist_ok=True)
    x.astype('<f4').tofile(os.path.join(a.reference_out, 'input.f32'))
    for op in ops:
        np.ascontiguousarray(values[op['output']], '<f4').tofile(os.path.join(a.reference_out, op['output'] + '.f32'))
print(json.dumps({'ops': len(ops), 'counts': {k: sum(o['op'] == k for o in ops) for k in sorted({o['op'] for o in ops})},
                  'weightFloats': len(weights) // 4, 'output': package['output']}))
