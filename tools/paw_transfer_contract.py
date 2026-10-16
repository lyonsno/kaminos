"""Replayable actual-source contract, before and after the paw transfer adapter."""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--builder',required=True)
    parser.add_argument('--inputs',required=True)
    parser.add_argument('--out',required=True)
    args=parser.parse_args()
    state=json.loads(Path(args.inputs).read_text())
    result=subprocess.run([sys.executable,args.builder,*sum((["--"+k,str(v)] for k,v in state.items()),[]),
                           '--out',args.out],capture_output=True,text=True)
    assert result.returncode==0,result.stderr
    manifest=json.loads((Path(args.out)/'manifest.json').read_text())
    assert len(manifest['bones'])==32
    assert len(manifest['channels'])==33
    assert all(n+'-end' in manifest['channels'] for n in ['forelimb-left-toe','forelimb-right-toe','hindlimb-left-toe','hindlimb-right-toe'])
    print(json.dumps({'status':'passed','manifest':str(Path(args.out)/'manifest.json')}))


if __name__=='__main__':main()
