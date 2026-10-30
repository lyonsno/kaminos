from pathlib import Path
import os,json,subprocess,sys,time,urllib.request,socket,traceback
planpath=Path(sys.argv[1]);plan=json.loads(planpath.read_text());mode=sys.argv[2];cast=sys.argv[3:]
out=Path(plan.get('preparedDir',str(planpath.parent/'prepared'))) if mode=='prep' else planpath.parent/('startup-probe' if mode=='probe' else cast[0]);out.mkdir(parents=True,exist_ok=True)
receipt={'receiver':plan['receiver'],'phase':'setup','ok':False,'plan':str(planpath),'argv':sys.argv,'repoRoot':plan['repoRoot']};server=None;log=None
try:
 port=int(plan['origin'].rsplit(':',1)[1])
 with socket.socket() as sock:sock.bind(('127.0.0.1',port))
 env=os.environ.copy();env['KAMINOS_BIND_HOST']='127.0.0.1';env['KAMINOS_SCENES_DIR']=str(out/'scenes');(out/'scenes').mkdir(exist_ok=True)
 command=['/usr/bin/python3',str(Path(plan['repoRoot'])/'serve.py'),str(port),'--volume-settings-store',str(out/'volume-settings.json'),'--volume-basin-session-store',str(out/'basin-session.json'),'--volume-cockpit-layout-store',str(out/'layout.json')]
 receipt['serverCommand']=command;receipt['phase']='server-start';log=(out/'server.log').open('w');server=subprocess.Popen(command,cwd=plan['repoRoot'],env=env,stdout=log,stderr=subprocess.STDOUT);receipt['ownedServerPid']=server.pid
 (out/'execution.json').write_text(json.dumps(receipt,indent=2))
 while True:
  if server.poll() is not None:raise RuntimeError('Owned server exited during startup')
  try:
   with urllib.request.urlopen(plan['origin']+'/api/runtime-config') as r:receipt['runtime']=json.load(r)
   break
  except OSError:time.sleep(.25)
 receipt['phase']='assay';(out/'execution.json').write_text(json.dumps(receipt,indent=2))
 with (out/'run.log').open('w') as f:r=subprocess.run(['/opt/homebrew/bin/node',str(Path(__file__).with_name('run.mjs')),str(planpath),mode,*cast],cwd=plan['repoRoot'],stdout=f,stderr=subprocess.STDOUT)
 receipt['exitCode']=r.returncode
 if r.returncode:raise RuntimeError('Assay failed; report.json and run.log preserve the phase')
 assert json.loads((out/'report.json').read_text())['ok'];receipt['phase']='done';receipt['ok']=True
except Exception:receipt['failurePhase']=receipt['phase'];receipt['error']=traceback.format_exc()
finally:
 if server is not None:
  if server.poll() is None:server.terminate()
  receipt['serverExitCode']=server.wait()
 if log:log.close()
 (out/'execution.json').write_text(json.dumps(receipt,indent=2))
 if not receipt['ok']:(out/'execution-failure.json').write_text(json.dumps(receipt,indent=2))
raise SystemExit(0 if receipt['ok'] else 1)
