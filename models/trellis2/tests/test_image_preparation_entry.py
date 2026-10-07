import hashlib,json,subprocess,sys
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[3];source=Path(sys.argv[1]);base=Path(sys.argv[2]);out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
source_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
image=Image.new('RGBA',(16,16),(0,0,0,0))
for y in range(3,13):
    for x in range(3,13):image.putpixel((x,y),(180,50,30,255))
image_path=out/'input.png';image.save(image_path);package=out/'package'
command=[sys.executable,'-B',str(root/'models/trellis2/pack-prepared-generation.py'),'--repo-root',str(root),'--expected-commit',commit,
    '--base',str(base),'--image',str(image_path),'--expected-image-sha256',hashlib.sha256(image_path.read_bytes()).hexdigest(),
    '--preprocess-source-root',str(source),'--expected-preprocess-source-commit',source_commit,'--out',str(package),'--pipeline-type','512','--steps','8']
result=subprocess.run(command,capture_output=True,text=True)
assert result.returncode==0,'ordinary image must reach source foreground preparation and packaging in one invocation: '+result.stdout+result.stderr
m=json.loads((package/'manifest.json').read_text());report=json.loads((package/'package-report.json').read_text())
assert m['status']=='succeeded' and m['image']['preparation']['provenance']['route']=='input-alpha'
assert report['imagePreparation']['status']=='succeeded' and report['foregroundModelCalls']==0
assert report['imagePreparation']['peakChildRssBytes']>0 and report['imagePreparation']['rssUnit']=='bytes'
old=(package/'manifest.json').read_bytes()
Image.new('RGBA',(16,16),(255,0,0,0)).save(image_path)
command[command.index('--expected-image-sha256')+1]=hashlib.sha256(image_path.read_bytes()).hexdigest()
failed=subprocess.run(command,capture_output=True,text=True);r=json.loads((package/'package-report.json').read_text())
assert failed.returncode!=0 and r['status']=='failed' and json.loads((package/'manifest.json').read_text())['status']=='failed'
assert (package/r['previousManifest']['file']).read_bytes()==old
assert r['phase']=='automatic-foreground-preparation'
print('One ordinary-image invocation uses actual source alpha/crop and reports child RSS; blank preparation fails without admitting a previous image package.')
