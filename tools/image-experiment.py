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
    args=parser.parse_args()
    args.out.parent.mkdir(parents=True,exist_ok=True)
    phase='manifest';status=None
    result={'status':'running','phase':phase,'manifest':str(args.manifest),'origin':args.origin}
    args.out.write_text(json.dumps(result,indent=2)+'\n')
    try:
        payload=json.loads(args.manifest.read_text())
        phase='request'
        request=Request(args.origin.rstrip('/')+'/api/image-experiments',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
        phase='transport'
        try:
            response=urlopen(request)
        except HTTPError as error:
            response=error
        with response:
            status=response.status;phase='response'
            result=json.load(response)
            if not isinstance(result,dict):raise ValueError('Expected an experiment response object')
        if status!=200:
            result={'status':'failed','phase':'response','httpStatus':status,'error':result.get('error',f'HTTP {status}'),'response':result}
    except Exception as error:
        result={'status':'failed','phase':phase,'error':str(error),'manifest':str(args.manifest),'origin':args.origin}
    args.out.write_text(json.dumps(result,indent=2)+'\n')
    failed=result.get('status')=='failed'
    print(json.dumps({'status':status,'phase':phase,'id':result.get('id'),'out':str(args.out),'ok':not failed}))
    return 1 if failed else 0

if __name__=='__main__':raise SystemExit(main())
