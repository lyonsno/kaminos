import json,sys,runpy,traceback
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:];out=Path(args[1]);out.mkdir(parents=True,exist_ok=True);report={'phase':'registration-and-views','ok':False,'argv':sys.argv,'sourceScript':str(Path(__file__).with_name('register.py'))}
try:
 runpy.run_path(report['sourceScript'],run_name='__main__')
 primary=out/(args[2]+'-registration.json');d=json.loads(primary.read_text());assert len(d['candidates'])==4
 for c in d['candidates']:
  for suffix in ['.glb','-view0.png','-view1.png','-rig.png']:assert (out/f'{args[2]}-candidate{c["index"]}{suffix}').stat().st_size>0
 report['ok']=True;report['phase']='done';report['primary']=str(primary)
except Exception:report['failurePhase']=report['phase'];report['error']=traceback.format_exc()
finally:
 (out/'execution.json').write_text(json.dumps(report,indent=2)+'\n')
 if not report['ok']:(out/'failure.json').write_text(json.dumps(report,indent=2)+'\n')
if not report['ok']:raise SystemExit(1)
