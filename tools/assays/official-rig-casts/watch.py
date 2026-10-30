from pathlib import Path
import sys,json,traceback
sys.path.insert(0,sys.argv[2])
from greenroom_job_watch import watch
out=Path(sys.argv[1]);sub=json.loads((out/'submission.json').read_text());r={'receiver':sys.argv[3],'queueJob':sub['job_id'],'queue':sub['effective_queue_dir'],'ok':False}
try:
 r['queueTerminal']=watch(Path(sub['effective_queue_dir']),sub['job_id'],timeout=float('inf'),poll=5)
 r['reportPath']=str(out/'report.json');r['ok']=r['queueTerminal']['succeeded'] and json.loads((out/'report.json').read_text())['ok']
except Exception:r['error']=traceback.format_exc()
finally:
 (out/'terminal.json').write_text(json.dumps(r,indent=2)+'\n')
 if not r['ok']:(out/'terminal-failure.json').write_text(json.dumps(r,indent=2)+'\n')
raise SystemExit(0 if r['ok'] else 1)
