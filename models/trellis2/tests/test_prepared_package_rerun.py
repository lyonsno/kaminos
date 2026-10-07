"""Replay actual-package success then a refused rerun; no neural model calls."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root=Path(__file__).resolve().parents[3]
base=Path(sys.argv[1]).resolve();good=Path(sys.argv[2]).resolve();bad=Path(sys.argv[3]).resolve()
out=Path(sys.argv[4]).resolve();out.mkdir(parents=True,exist_ok=True)
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
runner=root/'models/trellis2/pack-prepared-generation.py';target=out/'package'
def sha(data):return hashlib.sha256(data).hexdigest()
def run(foreground,steps=8,revision=commit):
    command=[sys.executable,'-B',str(runner),'--repo-root',str(root),'--expected-commit',revision,
        '--base',str(base),'--foreground',str(foreground),'--out',str(target),'--pipeline-type','512','--steps',str(steps)]
    result=subprocess.run(command,capture_output=True,text=True)
    return result,json.loads((target/'package-report.json').read_text())
def admits():
    script='import fs from "node:fs";import {validateGenerationInputs} from '+json.dumps((root/'models/trellis2/generation-inputs.js').as_uri())+';validateGenerationInputs(JSON.parse(fs.readFileSync(process.argv[1])));'
    return subprocess.run(['/opt/homebrew/bin/node','--input-type=module','-e',script,str(target/'manifest.json')],capture_output=True,text=True)
result,report=run(good)
assert result.returncode==0,result.stdout+result.stderr
assert report['modelCalls']==0 and admits().returncode==0
accepted=(target/'manifest.json').read_bytes();m=json.loads(accepted)
pixel=target/m['tensors'][m['image']['pixelTensor']]['file'];pixel_bytes=pixel.read_bytes()
result,report=run(bad,steps=6)
assert result.returncode!=0 and report['status']=='failed'
assert 'successful real foreground preparation required' in report['error']['message']
assert admits().returncode!=0,'refused foreground rerun must not leave its old successful manifest admitted as current output'
previous=target/report['previousManifest']['file']
assert previous.read_bytes()==accepted and report['previousManifest']['sha256']==sha(accepted)
assert pixel.read_bytes()==pixel_bytes,'refused attempt must preserve the previous accepted pixel bytes'
assert json.loads((target/'manifest.json').read_text())['status']=='failed'
result,report=run(good,steps=0)
assert result.returncode!=0 and admits().returncode!=0
result,report=run(good,revision='0'*40)
assert result.returncode!=0 and admits().returncode!=0
result,report=run(good,steps=6)
assert result.returncode==0,result.stdout+result.stderr
assert report['status']=='succeeded' and admits().returncode==0
current=json.loads((target/'manifest.json').read_text())
assert current['samplingSteps']==6 and current['models']['lowResolutionShape']['config']['steps']==6
assert previous.read_bytes()==accepted and pixel.read_bytes()==pixel_bytes
(out/'test-report.json').write_text(json.dumps({'status':'succeeded','sourceCommit':commit,'modelCalls':0,
    'base':str(base),'foreground':str(good),'refusedForeground':str(bad),
    'previousManifestSha256':sha(accepted),'previousPixelSha256':sha(pixel_bytes),
    'currentManifestSha256':sha((target/'manifest.json').read_bytes()),'currentSteps':6},indent=2)+'\n')
print('Existing successful package is preserved explicitly; failed foreground/settings/source reruns cannot admit it as current; a successful six-step retry admits its actual settings.')
