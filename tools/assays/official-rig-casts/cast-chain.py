from pathlib import Path
import sys,json,subprocess,traceback
planpath=Path(sys.argv[1]);plan=json.loads(planpath.read_text());cast_id=sys.argv[2];cast=next(x for x in plan['casts'] if x['cell']+'-seed'+str(x['seed'])==cast_id);out=planpath.parent/cast_id;out.mkdir(parents=True,exist_ok=True)
r={'phase':'generation','ok':False,'receiver':plan['receiver'],'cast':cast};repo=Path(plan['repoRoot'])
try:
 subprocess.run(['/usr/bin/python3',str(Path(__file__).with_name('with-server.py')),str(planpath),'cast',cast_id],check=True)
 r['generationOk']=json.loads((out/'report.json').read_text())['ok'];assert r['generationOk'];r['phase']='registration';(out/'chain-report.json').write_text(json.dumps(r,indent=2))
 reg=out/'registration';rig='cat' if cast['cell'].startswith('cat') else 'dog';r['registrationCommand']=['/Applications/Blender.app/Contents/MacOS/Blender','--background','--python',str(repo/'tools/assays/official-rig-registration/with-receipt.py'),'--',str(out/'creature.glb'),str(reg),cast_id,rig,str(planpath.parent.parent/'sources/rest-data.json'),str(planpath.parent.parent/'sources/role-radius-fractions.json')]
 with (out/'registration.log').open('w') as f:subprocess.run(r['registrationCommand'],stdout=f,stderr=subprocess.STDOUT,check=True)
 r['registrationOk']=json.loads((reg/'execution.json').read_text())['ok'];assert r['registrationOk'];r['ok']=True;r['phase']='done'
except Exception:r['failurePhase']=r['phase'];r['error']=traceback.format_exc()
finally:
 (out/'chain-report.json').write_text(json.dumps(r,indent=2)+'\n')
 if not r['ok']:(out/'chain-failure.json').write_text(json.dumps(r,indent=2)+'\n')
raise SystemExit(0 if r['ok'] else 1)
