#!/usr/bin/env python3
"""Submit a saved experiment operation through the same API as Assets Browse."""
import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin',required=True,help='Running Kaminos server')
    parser.add_argument('--manifest',type=Path,required=True,help='JSON create/update/add operation')
    parser.add_argument('--out',type=Path,required=True,help='Retained API result or error')
    args=parser.parse_args();payload=json.loads(args.manifest.read_text())
    request=Request(args.origin.rstrip('/')+'/api/image-experiments',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    try:
        with urlopen(request) as response:result=json.load(response);status=response.status
    except HTTPError as error:result=json.load(error);status=error.code
    args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':status,'id':result.get('id'),'out':str(args.out)}))
    return 0 if status==200 else 1

if __name__=='__main__':raise SystemExit(main())
