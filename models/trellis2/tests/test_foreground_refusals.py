import hashlib
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image

source=Path(sys.argv[1]).resolve();expected=sys.argv[2];out=Path(sys.argv[3]).resolve();out.mkdir(parents=True,exist_ok=True)
runner=Path(__file__).resolve().parents[1]/'prepare-foreground.py'
def run(name,image,commit=expected):
    file=out/(name+'.png');image.save(file);target=out/name
    command=[sys.executable,'-B',str(runner),'--source-root',str(source),'--expected-source-commit',commit,
        '--image',str(file),'--expected-image-sha256',hashlib.sha256(file.read_bytes()).hexdigest(),'--out',str(target)]
    result=subprocess.run(command,capture_output=True,text=True)
    return result,json.loads((target/'report.json').read_text()),target
blank=Image.new('RGBA',(16,16),(255,0,0,0))
result,report,target=run('blank-alpha',blank)
assert result.returncode!=0 and report['status']=='failed'
assert 'raw-input fallback' in report['error']['message']
assert report['modelCalls']==0 and not (target/'prepared-shoe.png').exists()
visible=Image.new('RGBA',(16,16),(0,0,0,0))
for y in range(3,13):
    for x in range(3,13):visible.putpixel((x,y),(180,50,30,255))
result,report,target=run('actual-source-alpha',visible)
assert result.returncode==0, result.stdout+result.stderr
assert report['status']=='succeeded' and report['modelCalls']==0
assert report['preparation']['route']=='input-alpha' and report['preparation']['foreground_pixels']==100
assert report['files']['prepared-shoe.png']['sha256']==hashlib.sha256((target/'prepared-shoe.png').read_bytes()).hexdigest()
result,report,target=run('wrong-source',visible,'0'*40)
assert result.returncode!=0 and report['phase']=='source-input-admission'
assert not (target/'prepared-shoe.png').exists()
print('Actual source alpha/crop path succeeds without model loading; blank foreground and wrong source fail with durable reports and no admitted image.')
