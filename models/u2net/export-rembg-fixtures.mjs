// Record what Pillow 12.3 and rembg 2.0.76 compute from the deterministic
// fixture bytes in fixtures/rembg-fixture.js. rembg's own normalize(), predict()
// post-processing (inference stubbed to return the fixture prediction) and
// naive_cutout run; only the U2Net inference itself is not exercised here.
//
// node models/u2net/export-rembg-fixtures.mjs --python <python with rembg 2.0.76, Pillow 12.3> --work <dir> [--out <json>]
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixtureImage,fixturePrediction,RESAMPLE_CASES,PIPELINE_CASES} from './fixtures/rembg-fixture.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
for(const key of ['--python','--work'])if(!args.get(key))throw Error(key+' required');
const out=args.get('--out')??path.join(here,'fixtures/rembg-source.json'),work=path.resolve(args.get('--work'));
await fs.mkdir(work,{recursive:true});
const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const jobs=[];
for(const [i,c] of RESAMPLE_CASES.entries()){
  const px=fixtureImage(c.w,c.h,c.seed,c.channels);await fs.writeFile(path.join(work,`resample-${i}.u8`),px);
  jobs.push({kind:'resample',file:`resample-${i}.u8`,...c,inputSha256:sha(px)});
}
for(const [i,c] of PIPELINE_CASES.entries()){
  const px=fixtureImage(c.w,c.h,c.seed),pred=fixturePrediction(c.predSeed);
  await fs.writeFile(path.join(work,`pipeline-${i}.u8`),px);await fs.writeFile(path.join(work,`pred-${i}.f32`),new Uint8Array(pred.buffer));
  jobs.push({kind:'pipeline',file:`pipeline-${i}.u8`,pred:`pred-${i}.f32`,...c,inputSha256:sha(px),predSha256:sha(pred)});
}
await fs.writeFile(path.join(work,'jobs.json'),JSON.stringify(jobs));
const result=JSON.parse(execFileSync(args.get('--python'),['-c',`
import sys, json, hashlib, numpy as np, PIL, rembg
from importlib import metadata
from PIL import Image
from rembg.sessions.base import BaseSession
from rembg.sessions.u2net import U2netSession
from rembg.bg import naive_cutout
w = sys.argv[1]; jobs = json.load(open(w + '/jobs.json')); h = lambda a: hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()
class Inputs:
    name = 'input.1'
class Inner:
    def __init__(s, pred): s.pred = pred
    def get_inputs(s): return [Inputs()]
    def run(s, names, feeds): s.feeds = feeds; return [s.pred.reshape(1, 1, 320, 320)]
class Stub:
    normalize = BaseSession.normalize
    def __init__(s, pred): s.inner_session = Inner(pred)
out = []
for j in jobs:
    raw = np.fromfile(w + '/' + j['file'], np.uint8)
    if j['kind'] == 'resample':
        mode = {1: 'L', 3: 'RGB', 4: 'RGBA'}[j['channels']]
        shape = (j['h'], j['w']) if j['channels'] == 1 else (j['h'], j['w'], j['channels'])
        img = Image.fromarray(raw.reshape(shape), mode)
        # RGBA/LA resize premultiplies in Pillow; the contract covers the opaque 4-channel case.
        r = np.array(img.resize((j['ow'], j['oh']), Image.Resampling.LANCZOS))
        out.append({**j, 'outputSha256': h(r)})
    else:
        img = Image.fromarray(raw.reshape(j['h'], j['w'], 3), 'RGB')
        scale = min(1, 1024 / max(img.size))
        if scale < 1: img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
        img = img.convert('RGB')
        stub = Stub(np.fromfile(w + '/' + j['pred'], '<f4'))
        mask = U2netSession.predict(stub, img)[0]
        x = list(stub.inner_session.feeds.values())[0]
        cut = naive_cutout(img, mask)
        out.append({**j, 'size': [img.width, img.height], 'preSha256': h(np.array(img)), 'inputTensorSha256': h(x.astype('<f4')),
                    'maskSha256': h(np.array(mask)), 'cutoutSha256': h(np.array(cut))})
print(json.dumps({'versions': {'rembg': metadata.version('rembg'), 'pillow': PIL.__version__, 'numpy': np.__version__}, 'cases': out}))
`,work],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
await fs.writeFile(out,JSON.stringify({schema:'kaminos.rembg-source-fixture.v0',
  source:'rembg BaseSession.normalize, U2netSession.predict (inference stubbed), bg.naive_cutout; Pillow Image.resize LANCZOS',...result},null,1)+'\n');
console.log(JSON.stringify(result.versions),result.cases.length+' cases');
